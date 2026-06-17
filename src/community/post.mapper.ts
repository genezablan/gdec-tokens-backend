import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Post } from '../entities/post.entity';
import { Comment } from '../entities/comment.entity';
import { Reaction } from '../entities/reaction.entity';
import { PollVote } from '../entities/poll-vote.entity';
import { PostView } from '../entities/post-view.entity';
import { PostMention } from '../entities/post-mention.entity';
import { PostPraised } from '../entities/post-praised.entity';
import {
  AttachmentType,
  CommunityPrivacy,
  PostType,
  PraiseBadge,
  ReactionType,
} from '../common/enums';
import { toUserBrief, UserBrief } from '../common/mappers/user-brief.mapper';
import { S3Service } from '../common/services/s3.service';

/** Denormalized community brief embedded in every post (docs/community.md §3.5). */
export interface ApiCommunityBrief {
  id: string;
  name: string;
  avatarUrl: string | null;
  privacy: CommunityPrivacy;
}

export interface ApiAttachment {
  id: string;
  type: AttachmentType;
  url: string;
  name: string | null;
}

export interface ApiComment {
  id: string;
  author: UserBrief;
  createdAt: Date;
  text: string;
}

export interface ApiPoll {
  options: { id: string; label: string; votes: number }[];
  myVote: string | null;
}

/** Canonical Post shape returned by every post endpoint (docs/community.md §3.5). */
export interface ApiPost {
  id: string;
  type: PostType;
  communityId: string;
  community: ApiCommunityBrief;
  author: UserBrief;
  createdAt: Date;
  title: string | null;
  body: string | null;
  bodyHtml: string | null;
  mentions: UserBrief[];
  topics: string[];
  attachments: ApiAttachment[];
  badge?: PraiseBadge | null;
  praisedPeople?: UserBrief[];
  poll: ApiPoll | null;
  seenBy: number;
  reactionCounts: Partial<Record<ReactionType, number>>;
  myReaction: ReactionType | null;
  pinned: boolean;
  comments: ApiComment[];
  commentsCount: number;
}

export interface MapPostsOptions {
  /** true → include every comment (detail view); false → latest N only (feed). */
  fullComments?: boolean;
  /** Number of comments to include in feed mode (default 2 — matches the feed card). */
  commentLimit?: number;
}

/**
 * Assembles the canonical API Post. Per-user fields (`myReaction`, `poll.myVote`,
 * `seenByMe`-derived `seenBy`) are computed server-side from the caller's id
 * (docs/community.md §1). All cross-cutting data is batched by postId so mapping
 * a feed page is a fixed number of queries.
 *
 * Posts passed in MUST have `community`, `author`, `attachments` and
 * `pollOptions` relations loaded.
 */
@Injectable()
export class PostMapper {
  constructor(
    @InjectRepository(PostMention)
    private readonly mentionRepo: Repository<PostMention>,
    @InjectRepository(PostPraised)
    private readonly praisedRepo: Repository<PostPraised>,
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>,
    @InjectRepository(PollVote)
    private readonly voteRepo: Repository<PollVote>,
    @InjectRepository(PostView)
    private readonly viewRepo: Repository<PostView>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    private readonly s3Service: S3Service,
  ) {}

  async mapOne(
    post: Post,
    userId: string,
    options: MapPostsOptions = {},
  ): Promise<ApiPost> {
    const [mapped] = await this.mapMany([post], userId, options);
    return mapped;
  }

  async mapMany(
    posts: Post[],
    userId: string,
    options: MapPostsOptions = {},
  ): Promise<ApiPost[]> {
    const ids = posts.map((p) => p.id);
    if (ids.length === 0) return [];

    const commentLimit = options.commentLimit ?? 2;

    const [
      mentions,
      praised,
      reactionAgg,
      myReactions,
      voteAgg,
      myVotes,
      viewAgg,
      commentCountAgg,
      comments,
    ] = await Promise.all([
      this.mentionRepo.find({
        where: { postId: In(ids) },
        relations: { user: true },
      }),
      this.praisedRepo.find({
        where: { postId: In(ids) },
        relations: { user: true },
      }),
      this.reactionRepo
        .createQueryBuilder('r')
        .select('r.postId', 'postId')
        .addSelect('r.type', 'type')
        .addSelect('COUNT(*)', 'count')
        .where('r.postId IN (:...ids)', { ids })
        .groupBy('r.postId')
        .addGroupBy('r.type')
        .getRawMany<{ postId: string; type: ReactionType; count: string }>(),
      this.reactionRepo.find({ where: { postId: In(ids), userId } }),
      this.voteRepo
        .createQueryBuilder('v')
        .select('v.optionId', 'optionId')
        .addSelect('COUNT(*)', 'count')
        .where('v.postId IN (:...ids)', { ids })
        .groupBy('v.optionId')
        .getRawMany<{ optionId: string; count: string }>(),
      this.voteRepo.find({ where: { postId: In(ids), userId } }),
      this.viewRepo
        .createQueryBuilder('pv')
        .select('pv.postId', 'postId')
        .addSelect('COUNT(*)', 'count')
        .where('pv.postId IN (:...ids)', { ids })
        .groupBy('pv.postId')
        .getRawMany<{ postId: string; count: string }>(),
      this.commentRepo
        .createQueryBuilder('c')
        .select('c.postId', 'postId')
        .addSelect('COUNT(*)', 'count')
        .where('c.postId IN (:...ids)', { ids })
        .groupBy('c.postId')
        .getRawMany<{ postId: string; count: string }>(),
      // Comments themselves: newest-first so feed mode can take the latest N.
      this.commentRepo.find({
        where: { postId: In(ids) },
        relations: { author: true },
        order: { createdAt: 'DESC' },
      }),
    ]);

    // ─── Build lookup maps ─────────────────────────────────────────────────
    const mentionsByPost = this.groupBriefs(mentions);
    const praisedByPost = this.groupBriefs(praised);

    const reactionCountsByPost = new Map<
      string,
      Partial<Record<ReactionType, number>>
    >();
    for (const row of reactionAgg) {
      const counts = reactionCountsByPost.get(row.postId) ?? {};
      counts[row.type] = Number(row.count);
      reactionCountsByPost.set(row.postId, counts);
    }
    const myReactionByPost = new Map(myReactions.map((r) => [r.postId, r.type]));

    const voteCountByOption = new Map(
      voteAgg.map((v) => [v.optionId, Number(v.count)]),
    );
    const myVoteByPost = new Map(myVotes.map((v) => [v.postId, v.optionId]));

    const seenByPost = new Map(viewAgg.map((v) => [v.postId, Number(v.count)]));
    const commentCountByPost = new Map(
      commentCountAgg.map((c) => [c.postId, Number(c.count)]),
    );

    const commentsByPost = new Map<string, ApiComment[]>();
    for (const c of comments) {
      const list = commentsByPost.get(c.postId) ?? [];
      list.push({
        id: c.id,
        author: toUserBrief(c.author),
        createdAt: c.createdAt,
        text: c.text,
      });
      commentsByPost.set(c.postId, list);
    }

    // ─── Assemble ──────────────────────────────────────────────────────────
    const mapped = posts.map((post) => {
      // comments collected newest-first; present oldest-first for the UI.
      const allComments = (commentsByPost.get(post.id) ?? [])
        .slice()
        .reverse();
      const comments = options.fullComments
        ? allComments
        : allComments.slice(-commentLimit);

      const base: ApiPost = {
        id: post.id,
        type: post.type,
        communityId: post.communityId,
        community: {
          id: post.community.id,
          name: post.community.name,
          avatarUrl: post.community.avatarUrl,
          privacy: post.community.privacy,
        },
        author: toUserBrief(post.author),
        createdAt: post.createdAt,
        title: post.title,
        body: post.body,
        bodyHtml: post.bodyHtml,
        mentions: mentionsByPost.get(post.id) ?? [],
        topics: post.topics ?? [],
        attachments: (post.attachments ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((a) => ({ id: a.id, type: a.type, url: a.url, name: a.name })),
        poll: null,
        seenBy: seenByPost.get(post.id) ?? 0,
        reactionCounts: reactionCountsByPost.get(post.id) ?? {},
        myReaction: myReactionByPost.get(post.id) ?? null,
        pinned: post.pinned,
        comments,
        commentsCount: commentCountByPost.get(post.id) ?? 0,
      };

      if (post.type === PostType.PRAISE) {
        base.badge = post.badge ?? null;
        base.praisedPeople = praisedByPost.get(post.id) ?? [];
      }

      if (post.type === PostType.POLL) {
        const options = (post.pollOptions ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((o) => ({
            id: o.id,
            label: o.label,
            votes: voteCountByOption.get(o.id) ?? 0,
          }));
        base.poll = { options, myVote: myVoteByPost.get(post.id) ?? null };
      }

      return base;
    });

    await this.resolveAvatarUrls(mapped);
    return mapped;
  }

  /**
   * Stored avatar fields hold S3 *keys* (see auth.service `resolveProfilePicture`).
   * Replace each key with a short-lived (15 min) presigned GET URL so the UI can
   * render it directly. Null/empty and already-resolved (`http…`) values are left
   * as-is. Keys are deduped so a feed page signs each key only once.
   */
  private async resolveAvatarUrls(posts: ApiPost[]): Promise<void> {
    const briefs: { avatarUrl: string | null }[] = [];
    for (const post of posts) {
      briefs.push(post.author, post.community);
      for (const c of post.comments) briefs.push(c.author);
      for (const m of post.mentions) briefs.push(m);
      for (const p of post.praisedPeople ?? []) briefs.push(p);
    }

    const needsResolving = (url: string | null): url is string =>
      !!url && !url.startsWith('http');

    const keys = [
      ...new Set(briefs.map((b) => b.avatarUrl).filter(needsResolving)),
    ];
    if (keys.length === 0) return;

    const signed = await Promise.all(
      keys.map((key) => this.s3Service.getPresignedDownloadUrl(key, 900)),
    );
    const urlByKey = new Map(keys.map((key, i) => [key, signed[i]]));

    for (const brief of briefs) {
      if (needsResolving(brief.avatarUrl)) {
        brief.avatarUrl = urlByKey.get(brief.avatarUrl) ?? brief.avatarUrl;
      }
    }
  }

  /** Group rows carrying a loaded `user` relation into UserBrief[] keyed by postId. */
  private groupBriefs(
    rows: (PostMention | PostPraised)[],
  ): Map<string, UserBrief[]> {
    const map = new Map<string, UserBrief[]>();
    for (const row of rows) {
      const list = map.get(row.postId) ?? [];
      list.push(toUserBrief(row.user));
      map.set(row.postId, list);
    }
    return map;
  }
}
