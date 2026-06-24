import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { Post } from '../entities/post.entity';
import { Comment } from '../entities/comment.entity';
import { CommentReaction } from '../entities/comment-reaction.entity';
import { Reaction } from '../entities/reaction.entity';
import { PollOption } from '../entities/poll-option.entity';
import { PollVote } from '../entities/poll-vote.entity';
import { PostView } from '../entities/post-view.entity';
import { PostMention } from '../entities/post-mention.entity';
import { CommentMention } from '../entities/comment-mention.entity';
import { PostPraised } from '../entities/post-praised.entity';
import { PostAttachment } from '../entities/post-attachment.entity';
import { User } from '../entities/user.entity';
import { CommunityPrivacy, PostStatus, PostType } from '../common/enums';
import { CommunitySanitizerService } from '../common/services/community-sanitizer.service';
import { S3Service } from '../common/services/s3.service';
import { CommunityAccessService } from '../communities/community-access.service';
import { CommunityNotifier } from '../communities/community-notifier.service';
import { ApiPost, ApiReactor, PostMapper } from './post.mapper';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ReactDto, CreateCommentDto, VoteDto } from './dto/interaction.dto';
import { FeedQueryDto, FeedScope, FeedSort } from './dto/feed-query.dto';
import { ModerationQueryDto } from './dto/moderation-query.dto';

interface FeedCursor {
  /** ISO createdAt of the last item (recent sort). */
  c?: string;
  /** reaction total of the last item (popular sort). */
  r?: number;
  /** id of the last item (tiebreaker). */
  id: string;
}

export interface FeedResponse {
  posts: ApiPost[];
  pinned: ApiPost[];
  nextCursor: string | null;
}

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(CommentReaction)
    private readonly commentReactionRepo: Repository<CommentReaction>,
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>,
    @InjectRepository(PollOption)
    private readonly pollOptionRepo: Repository<PollOption>,
    @InjectRepository(PollVote)
    private readonly voteRepo: Repository<PollVote>,
    @InjectRepository(PostView)
    private readonly viewRepo: Repository<PostView>,
    @InjectRepository(PostMention)
    private readonly mentionRepo: Repository<PostMention>,
    @InjectRepository(CommentMention)
    private readonly commentMentionRepo: Repository<CommentMention>,
    @InjectRepository(PostPraised)
    private readonly praisedRepo: Repository<PostPraised>,
    @InjectRepository(PostAttachment)
    private readonly attachmentRepo: Repository<PostAttachment>,
    private readonly access: CommunityAccessService,
    private readonly sanitizer: CommunitySanitizerService,
    private readonly mapper: PostMapper,
    private readonly notifier: CommunityNotifier,
    private readonly s3Service: S3Service,
  ) {}

  // ─── Feed ───────────────────────────────────────────────────────────────

  async getFeed(user: User, query: FeedQueryDto): Promise<FeedResponse> {
    // A specific community page overrides scope and is access-gated.
    if (query.communityId) {
      const community = await this.access.getCommunityOrThrow(query.communityId);
      await this.access.assertCanViewContent(community, user); // 403 if private & non-member
    }

    const cursor = this.decodeCursor(query.cursor);
    const ordered = await this.selectPostIds(user, query, cursor, false);

    // limit + 1 sentinel determines whether there's a next page.
    const hasMore = ordered.length > query.limit;
    const pageRows = hasMore ? ordered.slice(0, query.limit) : ordered;

    const posts = await this.loadAndMap(
      pageRows.map((r) => r.id),
      user,
    );

    const nextCursor =
      hasMore && pageRows.length > 0
        ? this.encodeCursor(pageRows[pageRows.length - 1], query.sort)
        : null;

    // Pinned posts in scope — no pagination.
    const pinnedRows = await this.selectPostIds(user, query, undefined, true);
    const pinned = await this.loadAndMap(
      pinnedRows.map((r) => r.id),
      user,
    );

    return { posts, pinned, nextCursor };
  }

  /**
   * Admin moderation queue. Returns posts across ALL communities (no membership/
   * privacy gating — admin-only at the controller), optionally filtered by status,
   * newest first with keyset pagination. Mirrors the public feed response shape so
   * the client can reuse its infinite-query plumbing.
   */
  async getModerationFeed(
    user: User,
    query: ModerationQueryDto,
  ): Promise<FeedResponse> {
    const qb = this.postRepo
      .createQueryBuilder('p')
      .select('p.id', 'id')
      .addSelect('p.createdAt', 'createdAt')
      .addSelect('0', 'reactionTotal')
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'DESC');

    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }

    const cursor = this.decodeCursor(query.cursor);
    if (cursor?.c) {
      qb.andWhere(`(p.createdAt < :cc OR (p.createdAt = :cc AND p.id < :cid))`, {
        cc: cursor.c,
        cid: cursor.id,
      });
    }
    qb.limit(query.limit + 1);

    const ordered = (await qb.getRawMany()).map(this.normalizeRow);
    const hasMore = ordered.length > query.limit;
    const pageRows = hasMore ? ordered.slice(0, query.limit) : ordered;

    const posts = await this.loadAndMap(
      pageRows.map((r) => r.id),
      user,
    );
    const nextCursor =
      hasMore && pageRows.length > 0
        ? this.encodeCursor(pageRows[pageRows.length - 1], FeedSort.RECENT)
        : null;

    return { posts, pinned: [], nextCursor };
  }

  /** Admin-only: set a post's moderation status (approve / reject / re-pend). */
  async setPostStatus(
    user: User,
    id: string,
    status: PostStatus,
  ): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');

    const prevStatus = post.status;
    post.status = status;
    await this.postRepo.save(post);

    if (status !== prevStatus) {
      const community =
        post.community ??
        (await this.access.getCommunityOrThrow(post.communityId));

      if (status === PostStatus.APPROVED) {
        // First time the post becomes public: now fire the normal "new post"
        // notifications (members live-update, mentions, praise).
        const [mentions, praised] = await Promise.all([
          this.mentionRepo.find({ where: { postId: id } }),
          this.praisedRepo.find({ where: { postId: id } }),
        ]);
        void this.notifier.postCreated({
          postId: id,
          community,
          authorId: post.authorId,
          authorName: post.author?.fullName ?? '',
          mentionedUserIds: mentions.map((m) => m.userId),
          praisedUserIds:
            post.type === PostType.PRAISE ? praised.map((p) => p.userId) : [],
        });
        void this.notifier.postApproved({ postId: id, community, authorId: post.authorId });
      } else if (status === PostStatus.REJECTED) {
        void this.notifier.postRejected({ postId: id, community, authorId: post.authorId });
      }
    }

    return this.mapper.mapOne(post, user.id);
  }

  async getPost(user: User, id: string): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostVisible(post, user); // throws 404 if not visible
    return this.mapper.mapOne(post, user.id, { fullComments: true });
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  async createPost(user: User, dto: CreatePostDto): Promise<ApiPost> {
    const community = await this.access.getCommunityOrThrow(dto.communityId);
    if (!(await this.access.isMember(community.id, user.id))) {
      throw new ForbiddenException('You must join this community to post');
    }

    this.validatePostByType(dto);

    const bodyHtml = this.sanitizer.sanitize(dto.bodyHtml);
    const body = dto.body?.trim() || this.sanitizer.toPlainText(bodyHtml);

    const post = await this.postRepo.save(
      this.postRepo.create({
        communityId: community.id,
        authorId: user.id, // author is ALWAYS the authenticated user
        type: dto.type,
        status: PostStatus.PENDING, // awaits admin approval before going public
        title: dto.title?.trim() || null,
        body: body || null,
        bodyHtml: bodyHtml || null,
        topics: dto.topics ?? [],
        badge: dto.type === PostType.PRAISE ? dto.badge ?? null : null,
        pinned: false,
      }),
    );

    await this.persistPostChildren(post.id, dto);

    // The post is PENDING — don't broadcast to members/mentions/praise yet. Tell
    // the author it's pending and notify admins. The broadcast happens on approval.
    void this.notifier.postSubmittedForApproval({
      postId: post.id,
      community,
      authorId: user.id,
      authorName: user.fullName,
    });

    const reloaded = await this.loadPost(post.id);
    return this.mapper.mapOne(reloaded!, user.id, { fullComments: true });
  }

  /**
   * PATCH /community/:id — edit a post. Author only. Type/community/poll options
   * are immutable; provided text fields are merged, and attachments/mentions/
   * praisedPeople (when provided) replace the existing sets wholesale.
   */
  async updatePost(
    user: User,
    id: string,
    dto: UpdatePostDto,
  ): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== user.id) {
      throw new ForbiddenException('You can only edit your own posts');
    }

    if (dto.title !== undefined) post.title = dto.title?.trim() || null;
    if (dto.bodyHtml !== undefined) {
      const bodyHtml = this.sanitizer.sanitize(dto.bodyHtml);
      post.bodyHtml = bodyHtml || null;
      post.body = (dto.body?.trim() || this.sanitizer.toPlainText(bodyHtml)) || null;
    } else if (dto.body !== undefined) {
      post.body = dto.body?.trim() || null;
    }
    if (dto.topics !== undefined) post.topics = dto.topics ?? [];
    if (post.type === PostType.PRAISE && dto.badge !== undefined) {
      post.badge = dto.badge ?? null;
    }
    if (
      post.type === PostType.PRAISE &&
      dto.praisedPeople !== undefined &&
      dto.praisedPeople.length === 0
    ) {
      throw new BadRequestException('Praise requires at least one praised person');
    }

    this.validateEditedPost(post);
    await this.postRepo.save(post);

    if (dto.attachments !== undefined) {
      await this.attachmentRepo.delete({ postId: id });
      if (dto.attachments.length) {
        await this.attachmentRepo.save(
          dto.attachments.map((a, i) =>
            this.attachmentRepo.create({
              postId: id,
              type: a.type,
              url: a.url,
              name: a.name ?? null,
              sortOrder: i,
            }),
          ),
        );
      }
    }

    if (dto.mentions !== undefined) {
      await this.mentionRepo.delete({ postId: id });
      const unique = [...new Set(dto.mentions)];
      if (unique.length) {
        await this.mentionRepo.save(
          unique.map((userId) => this.mentionRepo.create({ postId: id, userId })),
        );
      }
    }

    if (post.type === PostType.PRAISE && dto.praisedPeople !== undefined) {
      await this.praisedRepo.delete({ postId: id });
      const unique = [...new Set(dto.praisedPeople)];
      if (unique.length) {
        await this.praisedRepo.save(
          unique.map((userId) => this.praisedRepo.create({ postId: id, userId })),
        );
      }
    }

    const reloaded = await this.loadPost(id);
    return this.mapper.mapOne(reloaded!, user.id, { fullComments: true });
  }

  /**
   * DELETE /community/:id — remove a post. Allowed for the author or a community/
   * platform admin. Child rows (comments, reactions, attachments, etc.) cascade.
   */
  async deletePost(user: User, id: string): Promise<{ success: true }> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    const community = await this.access.getCommunityOrThrow(post.communityId);
    const isAuthor = post.authorId === user.id;
    const isAdmin = await this.access.isCommunityAdmin(community, user);
    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    await this.postRepo.delete(id);
    return { success: true };
  }

  // ─── Interactions ───────────────────────────────────────────────────────────

  async react(user: User, id: string, dto: ReactDto): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostVisible(post, user);

    const existing = await this.reactionRepo.findOne({
      where: { postId: id, userId: user.id },
    });
    if (!existing) {
      await this.reactionRepo.save(
        this.reactionRepo.create({ postId: id, userId: user.id, type: dto.type }),
      );
    } else if (existing.type === dto.type) {
      // Toggling the same reaction clears it.
      await this.reactionRepo.delete({ postId: id, userId: user.id });
    } else {
      existing.type = dto.type;
      await this.reactionRepo.save(existing);
    }

    void this.notifier.reactionChanged({
      postId: id,
      communityId: post.communityId,
      actorId: user.id,
    });

    return this.mapper.mapOne(post, user.id);
  }

  /**
   * GET /community/:id/reactions — everyone who reacted, with their reaction value
   * (emoji), name, job title and (presigned) avatar. Powers the "Reactions" dialog.
   */
  async listReactors(user: User, id: string): Promise<ApiReactor[]> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostVisible(post, user);

    const reactions = await this.reactionRepo.find({
      where: { postId: id },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    const reactors: ApiReactor[] = reactions
      .filter((r) => r.user)
      .map((r) => ({
        id: r.user.id,
        name: r.user.fullName,
        avatarUrl: r.user.profilePicture ?? null,
        jobTitle: r.user.position ?? null,
        value: r.type,
      }));
    await this.s3Service.presignAvatars(reactors);
    return reactors;
  }

  /**
   * GET /community/:id/comments/:commentId/reactions — everyone who reacted to a
   * comment, with their reaction value, name, job title and (presigned) avatar.
   */
  async listCommentReactors(
    user: User,
    postId: string,
    commentId: string,
  ): Promise<ApiReactor[]> {
    const post = await this.loadPost(postId);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostVisible(post, user);

    const comment = await this.commentRepo.findOne({
      where: { id: commentId, postId },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    const reactions = await this.commentReactionRepo.find({
      where: { commentId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    const reactors: ApiReactor[] = reactions
      .filter((r) => r.user)
      .map((r) => ({
        id: r.user.id,
        name: r.user.fullName,
        avatarUrl: r.user.profilePicture ?? null,
        jobTitle: r.user.position ?? null,
        value: r.value,
      }));
    await this.s3Service.presignAvatars(reactors);
    return reactors;
  }

  async addComment(
    user: User,
    id: string,
    dto: CreateCommentDto,
  ): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostVisible(post, user);

    const text = dto.text?.trim() || null;
    const gifUrl = dto.gifUrl?.trim() || null;
    if (!text && !gifUrl) {
      throw new BadRequestException('A comment needs text or a GIF');
    }

    const comment = await this.commentRepo.save(
      this.commentRepo.create({
        postId: id,
        authorId: user.id, // author from token
        text,
        gifUrl,
      }),
    );

    const mentionedUserIds = [...new Set(dto.mentions ?? [])];
    if (mentionedUserIds.length) {
      await this.commentMentionRepo.save(
        mentionedUserIds.map((userId) =>
          this.commentMentionRepo.create({ commentId: comment.id, userId }),
        ),
      );
    }

    void this.notifier.commentAdded({
      postId: id,
      communityId: post.communityId,
      postAuthorId: post.authorId,
      commenterId: user.id,
      commenterName: user.fullName,
      mentionedUserIds,
    });

    return this.mapper.mapOne(post, user.id, { fullComments: true });
  }

  /**
   * Toggle the caller's reaction on a comment. `value` is an emoji grapheme or a
   * "gif:<id>" reference. Reacting with the same value clears it; a different
   * value switches the reaction. Returns the updated post (with full comments)
   * so the client can patch its caches like it does for post reactions.
   */
  async reactToComment(
    user: User,
    postId: string,
    commentId: string,
    value: string,
  ): Promise<ApiPost> {
    const post = await this.loadPost(postId);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostVisible(post, user);

    const comment = await this.commentRepo.findOne({
      where: { id: commentId, postId },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    const existing = await this.commentReactionRepo.findOne({
      where: { commentId, userId: user.id },
    });
    if (!existing) {
      await this.commentReactionRepo.save(
        this.commentReactionRepo.create({ commentId, userId: user.id, value }),
      );
    } else if (existing.value === value) {
      // Reacting with the same value again clears it.
      await this.commentReactionRepo.delete({ commentId, userId: user.id });
    } else {
      existing.value = value;
      await this.commentReactionRepo.save(existing);
    }

    return this.mapper.mapOne(post, user.id, { fullComments: true });
  }

  async vote(user: User, id: string, dto: VoteDto): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    if (post.type !== PostType.POLL) {
      throw new NotFoundException('This post has no poll');
    }
    await this.assertPostVisible(post, user);

    const option = await this.pollOptionRepo.findOne({
      where: { id: dto.optionId, postId: id },
    });
    if (!option) throw new BadRequestException('Invalid poll option');

    const existing = await this.voteRepo.findOne({
      where: { postId: id, userId: user.id },
    });
    if (!existing) {
      await this.voteRepo.save(
        this.voteRepo.create({ postId: id, userId: user.id, optionId: dto.optionId }),
      );
    } else if (existing.optionId === dto.optionId) {
      // Voting the same option again un-votes.
      await this.voteRepo.delete({ postId: id, userId: user.id });
    } else {
      existing.optionId = dto.optionId;
      await this.voteRepo.save(existing);
    }

    return this.mapper.mapOne(post, user.id);
  }

  async togglePin(user: User, id: string): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    const community = await this.access.getCommunityOrThrow(post.communityId);
    await this.access.assertCommunityAdmin(community, user); // 403 otherwise

    post.pinned = !post.pinned;
    await this.postRepo.save(post);
    return this.mapper.mapOne(post, user.id);
  }

  async markSeen(user: User, id: string): Promise<ApiPost> {
    const post = await this.loadPost(id);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertPostVisible(post, user);

    // Idempotent per user — PK (postId, userId). Ignore conflicts.
    await this.viewRepo
      .createQueryBuilder()
      .insert()
      .values({ postId: id, userId: user.id })
      .orIgnore()
      .execute();

    return this.mapper.mapOne(post, user.id);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private loadPost(id: string): Promise<Post | null> {
    return this.postRepo.findOne({
      where: { id },
      relations: {
        community: true,
        author: true,
        attachments: true,
        pollOptions: true,
      },
    });
  }

  /** Reload posts by id (with relations) preserving the given order, then map. */
  private async loadAndMap(ids: string[], user: User): Promise<ApiPost[]> {
    if (ids.length === 0) return [];
    const posts = await this.postRepo.find({
      where: { id: In(ids) },
      relations: {
        community: true,
        author: true,
        attachments: true,
        pollOptions: true,
      },
    });
    const byId = new Map(posts.map((p) => [p.id, p]));
    const ordered = ids.map((id) => byId.get(id)).filter((p): p is Post => !!p);
    return this.mapper.mapMany(ordered, user.id, { commentLimit: 2 });
  }

  /**
   * GET /community/:id is 404 (not 403) for a private community the caller
   * can't see — avoids leaking existence (docs/community.md §5).
   */
  private async assertPostVisible(post: Post, user: User): Promise<void> {
    const community =
      post.community ?? (await this.access.getCommunityOrThrow(post.communityId));
    if (community.privacy === CommunityPrivacy.PUBLIC) return;
    if (this.access.isPlatformAdmin(user)) return;
    if (await this.access.isMember(community.id, user.id)) return;
    throw new NotFoundException('Post not found');
  }

  /**
   * Select ordered post-id rows applying scope/visibility/type/topic filters and
   * keyset pagination. Returns up to `limit + 1` rows so callers can detect a
   * next page. When `pinnedOnly`, returns all pinned posts in scope unpaginated.
   */
  private async selectPostIds(
    user: User,
    query: FeedQueryDto,
    cursor: FeedCursor | undefined,
    pinnedOnly: boolean,
  ): Promise<{ id: string; createdAt: string; reactionTotal: number }[]> {
    const qb = this.postRepo
      .createQueryBuilder('p')
      .leftJoin('p.community', 'community')
      .leftJoin(
        'community_members',
        'mem',
        'mem."communityId" = p."communityId" AND mem."userId" = :uid',
        { uid: user.id },
      )
      .select('p.id', 'id')
      .addSelect('p.createdAt', 'createdAt')
      .addSelect(
        '(SELECT COUNT(*) FROM reactions r WHERE r."postId" = p.id)',
        'reactionTotal',
      );

    this.applyScopeAndVisibility(qb, user, query);

    // Moderation gate: the public feed only shows approved posts. Authors still
    // see their own pending/rejected posts so a submission never silently
    // vanishes. The admin moderation queue uses getModerationFeed instead.
    qb.andWhere('(p.status = :approvedStatus OR p."authorId" = :selfId)', {
      approvedStatus: PostStatus.APPROVED,
      selfId: user.id,
    });

    if (query.authorId) {
      qb.andWhere('p."authorId" = :authorId', { authorId: query.authorId });
    }
    if (query.type && query.type !== 'all') {
      qb.andWhere('p.type = :type', { type: query.type });
    }
    if (query.topic?.trim()) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM unnest(p.topics) t WHERE LOWER(t) = LOWER(:topic))`,
        { topic: query.topic.trim() },
      );
    }

    if (pinnedOnly) {
      qb.andWhere('p.pinned = true').orderBy('p.createdAt', 'DESC').addOrderBy('p.id', 'DESC');
      const rows = await qb.getRawMany();
      return rows.map(this.normalizeRow);
    }

    // Exclude pinned from the main list — they're returned separately.
    qb.andWhere('p.pinned = false');
    this.applySortAndCursor(qb, query.sort, cursor);
    qb.limit(query.limit + 1);

    const rows = await qb.getRawMany();
    return rows.map(this.normalizeRow);
  }

  private applyScopeAndVisibility(
    qb: SelectQueryBuilder<Post>,
    user: User,
    query: FeedQueryDto,
  ): void {
    if (query.communityId) {
      qb.andWhere('p.communityId = :cid', { cid: query.communityId });
      return; // access already asserted in getFeed
    }
    // Aggregate feed: only public communities or ones the caller has joined.
    qb.andWhere(
      `(community.privacy = :public OR mem."userId" IS NOT NULL)`,
      { public: CommunityPrivacy.PUBLIC },
    );
    if (query.scope === FeedScope.HOME) {
      qb.andWhere('mem."userId" IS NOT NULL'); // joined communities only
    }
  }

  private applySortAndCursor(
    qb: SelectQueryBuilder<Post>,
    sort: FeedSort,
    cursor: FeedCursor | undefined,
  ): void {
    if (sort === FeedSort.POPULAR) {
      qb.orderBy('"reactionTotal"', 'DESC').addOrderBy('p.id', 'DESC');
      if (cursor && cursor.r !== undefined) {
        qb.andWhere(
          `((SELECT COUNT(*) FROM reactions r WHERE r."postId" = p.id) < :cr
            OR ((SELECT COUNT(*) FROM reactions r WHERE r."postId" = p.id) = :cr AND p.id < :cid))`,
          { cr: cursor.r, cid: cursor.id },
        );
      }
    } else {
      qb.orderBy('p.createdAt', 'DESC').addOrderBy('p.id', 'DESC');
      if (cursor && cursor.c) {
        qb.andWhere(
          `(p.createdAt < :cc OR (p.createdAt = :cc AND p.id < :cid))`,
          { cc: cursor.c, cid: cursor.id },
        );
      }
    }
  }

  private normalizeRow = (row: any) => ({
    id: row.id,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    reactionTotal: Number(row.reactionTotal ?? 0),
  });

  private encodeCursor(
    row: { id: string; createdAt: string; reactionTotal: number },
    sort: FeedSort,
  ): string {
    const cursor: FeedCursor =
      sort === FeedSort.POPULAR
        ? { r: row.reactionTotal, id: row.id }
        : { c: row.createdAt, id: row.id };
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeCursor(raw?: string): FeedCursor | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }

  /** Persist mentions / praised / attachments / poll options for a new post. */
  private async persistPostChildren(
    postId: string,
    dto: CreatePostDto,
  ): Promise<void> {
    if (dto.mentions?.length) {
      const unique = [...new Set(dto.mentions)];
      await this.mentionRepo.save(
        unique.map((userId) => this.mentionRepo.create({ postId, userId })),
      );
    }

    if (dto.type === PostType.PRAISE && dto.praisedPeople?.length) {
      const unique = [...new Set(dto.praisedPeople)];
      await this.praisedRepo.save(
        unique.map((userId) => this.praisedRepo.create({ postId, userId })),
      );
    }

    if (dto.attachments?.length) {
      await this.attachmentRepo.save(
        dto.attachments.map((a, i) =>
          this.attachmentRepo.create({
            postId,
            type: a.type,
            url: a.url,
            name: a.name ?? null,
            sortOrder: i,
          }),
        ),
      );
    }

    if (dto.type === PostType.POLL && dto.pollOptions?.length) {
      await this.pollOptionRepo.save(
        dto.pollOptions.map((label, i) =>
          this.pollOptionRepo.create({ postId, label: label.trim(), sortOrder: i }),
        ),
      );
    }
  }

  /** Post-edit invariants on the merged post (mirrors validatePostByType). */
  private validateEditedPost(post: Post): void {
    const hasBody = !!(post.bodyHtml?.trim() || post.body?.trim());
    const hasTitle = !!post.title?.trim();

    switch (post.type) {
      case PostType.DISCUSSION:
        if (!hasBody) throw new BadRequestException('Discussion requires a body');
        break;
      case PostType.QUESTION:
        if (!hasTitle) throw new BadRequestException('Question requires a title');
        break;
      case PostType.PRAISE:
        if (!hasBody) throw new BadRequestException('Praise requires a body');
        if (!post.badge) throw new BadRequestException('Praise requires a badge');
        break;
      case PostType.POLL:
        if (!hasTitle) throw new BadRequestException('Poll requires a title');
        break;
    }
  }

  /** Type-conditional requirements (docs/community.md §13). */
  private validatePostByType(dto: CreatePostDto): void {
    const hasBody = !!(dto.bodyHtml?.trim() || dto.body?.trim());
    const hasTitle = !!dto.title?.trim();

    switch (dto.type) {
      case PostType.DISCUSSION:
        if (!hasBody) throw new BadRequestException('Discussion requires a body');
        break;
      case PostType.QUESTION:
        if (!hasTitle) throw new BadRequestException('Question requires a title');
        if ((dto.title?.trim().length ?? 0) > 150) {
          throw new BadRequestException('Question title must be ≤ 150 characters');
        }
        break;
      case PostType.PRAISE:
        if (!dto.praisedPeople?.length) {
          throw new BadRequestException('Praise requires at least one praised person');
        }
        if (!hasBody) throw new BadRequestException('Praise requires a body');
        if (!dto.badge) throw new BadRequestException('Praise requires a badge');
        break;
      case PostType.POLL:
        if (!hasTitle) throw new BadRequestException('Poll requires a title');
        if (!dto.pollOptions || dto.pollOptions.length < 2) {
          throw new BadRequestException('Poll requires at least two options');
        }
        break;
    }
  }
}
