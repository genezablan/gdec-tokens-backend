import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CommunityMember } from '../entities/community-member.entity';
import { Community } from '../entities/community.entity';
import { User } from '../entities/user.entity';
import { CommunityRole, UserRole } from '../common/enums';
import { NotificationType } from '../entities/notification.entity';
import {
  NotificationsService,
  CreateNotificationDto,
} from '../notifications/notifications.service';

/**
 * Bridges Community domain events to the platform notifications system
 * (docs/community.md §10):
 *  - Mentions, praise, replies and join-request decisions create persistent
 *    bell entries (and fan out over SSE via NotificationsService.create).
 *  - New posts / comments / reactions are pushed as ephemeral live events to
 *    the relevant members so feeds can update in place.
 *
 * All methods are best-effort: failures are logged, never thrown, so a
 * notification hiccup can't fail the originating request.
 */
@Injectable()
export class CommunityNotifier {
  private readonly logger = new Logger(CommunityNotifier.name);

  constructor(
    @InjectRepository(CommunityMember)
    private readonly memberRepo: Repository<CommunityMember>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Moderation events ────────────────────────────────────────────────────

  /**
   * A post was created and is awaiting approval. Tell the author it's pending
   * and notify platform admins that there's something to review. No members /
   * mentions / praise are notified yet — that happens on approval (postCreated).
   */
  async postSubmittedForApproval(params: {
    postId: string;
    community: Community;
    authorId: string;
    authorName: string;
  }): Promise<void> {
    const { postId, community, authorId, authorName } = params;
    try {
      await this.persist(authorId, {
        title: 'Post pending approval',
        message: `Your post in ${community.name} was submitted and is awaiting admin approval.`,
        type: NotificationType.INFO,
        metadata: { deeplink: `/community/${postId}`, postId, communityId: community.id },
      });

      const adminIds = (await this.platformAdminIds()).filter((id) => id !== authorId);
      await Promise.all(
        adminIds.map((userId) =>
          this.persist(userId, {
            title: 'Post awaiting approval',
            message: `${authorName} submitted a post in ${community.name} for approval.`,
            type: NotificationType.INFO,
            metadata: { deeplink: '/message-approval', postId, communityId: community.id },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`postSubmittedForApproval notify failed: ${asMessage(err)}`);
    }
  }

  /** An admin approved a pending post → tell the author it's now live. */
  async postApproved(params: {
    postId: string;
    community: Community;
    authorId: string;
  }): Promise<void> {
    const { postId, community, authorId } = params;
    try {
      await this.persist(authorId, {
        title: 'Post approved 🎉',
        message: `Your post in ${community.name} was approved and is now live.`,
        type: NotificationType.SUCCESS,
        metadata: { deeplink: `/community/${postId}`, postId, communityId: community.id },
      });
    } catch (err) {
      this.logger.warn(`postApproved notify failed: ${asMessage(err)}`);
    }
  }

  /** An admin rejected a post → tell the author. */
  async postRejected(params: {
    postId: string;
    community: Community;
    authorId: string;
  }): Promise<void> {
    const { postId, community, authorId } = params;
    try {
      await this.persist(authorId, {
        title: 'Post not approved',
        message: `Your post in ${community.name} was not approved and won't be published.`,
        type: NotificationType.WARNING,
        metadata: { deeplink: `/community/${postId}`, postId, communityId: community.id },
      });
    } catch (err) {
      this.logger.warn(`postRejected notify failed: ${asMessage(err)}`);
    }
  }

  // ─── Feed events ──────────────────────────────────────────────────────────

  async postCreated(params: {
    postId: string;
    community: Community;
    authorId: string;
    authorName: string;
    mentionedUserIds: string[];
    praisedUserIds: string[];
  }): Promise<void> {
    const { postId, community, authorId, authorName } = params;
    const deeplink = `/community/${postId}`;
    try {
      // Persistent notifications for mentions & praise (exclude self).
      const mentioned = unique(params.mentionedUserIds).filter((u) => u !== authorId);
      const praised = unique(params.praisedUserIds).filter((u) => u !== authorId);

      await Promise.all([
        ...mentioned.map((userId) =>
          this.persist(userId, {
            title: 'You were mentioned',
            message: `${authorName} mentioned you in ${community.name}`,
            metadata: { deeplink, postId, communityId: community.id },
          }),
        ),
        ...praised.map((userId) =>
          this.persist(userId, {
            title: 'You were praised 🎉',
            message: `${authorName} praised you in ${community.name}`,
            type: NotificationType.SUCCESS,
            metadata: { deeplink, postId, communityId: community.id },
          }),
        ),
      ]);

      // Ephemeral live update to other members.
      const members = await this.memberIds(community.id, authorId);
      this.notifications.pushEventToMany(members, {
        type: 'community.post.created',
        postId,
        communityId: community.id,
      });
    } catch (err) {
      this.logger.warn(`postCreated notify failed: ${asMessage(err)}`);
    }
  }

  async commentAdded(params: {
    postId: string;
    communityId: string;
    postAuthorId: string;
    commenterId: string;
    commenterName: string;
    mentionedUserIds?: string[];
  }): Promise<void> {
    const { postId, communityId, postAuthorId, commenterId, commenterName } = params;
    const deeplink = `/community/${postId}`;
    try {
      // Reply notification to the post author (not for self-comments).
      if (postAuthorId !== commenterId) {
        await this.persist(postAuthorId, {
          title: 'New comment on your post',
          message: `${commenterName} commented on your post`,
          metadata: { deeplink, postId, communityId },
        });
      }
      // Mention notifications — exclude the commenter and the post author
      // (who already got the reply notification above) to avoid duplicates.
      const mentioned = unique(params.mentionedUserIds ?? []).filter(
        (u) => u !== commenterId && u !== postAuthorId,
      );
      await Promise.all(
        mentioned.map((userId) =>
          this.persist(userId, {
            title: 'You were mentioned',
            message: `${commenterName} mentioned you in a comment`,
            metadata: { deeplink, postId, communityId },
          }),
        ),
      );
      const members = await this.memberIds(communityId, commenterId);
      this.notifications.pushEventToMany(members, {
        type: 'community.comment.added',
        postId,
        communityId,
      });
    } catch (err) {
      this.logger.warn(`commentAdded notify failed: ${asMessage(err)}`);
    }
  }

  async reactionChanged(params: {
    postId: string;
    communityId: string;
    actorId: string;
  }): Promise<void> {
    // Reactions are noisy → ephemeral broadcast only, no bell entry.
    try {
      const members = await this.memberIds(params.communityId, params.actorId);
      this.notifications.pushEventToMany(members, {
        type: 'community.reaction.changed',
        postId: params.postId,
        communityId: params.communityId,
      });
    } catch (err) {
      this.logger.warn(`reactionChanged notify failed: ${asMessage(err)}`);
    }
  }

  // ─── Membership events ──────────────────────────────────────────────────────

  /** A user asked to join a private community → notify its admins. */
  async joinRequested(community: Community, requesterName: string): Promise<void> {
    try {
      const admins = await this.memberRepo.find({
        where: { communityId: community.id, role: CommunityRole.ADMIN },
        select: { userId: true },
      });
      await Promise.all(
        admins.map((a) =>
          this.persist(a.userId, {
            title: 'New join request',
            message: `${requesterName} requested to join ${community.name}`,
            metadata: { deeplink: `/communities/${community.id}`, communityId: community.id },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`joinRequested notify failed: ${asMessage(err)}`);
    }
  }

  /** An admin approved/declined a pending join request → notify the requester. */
  async requestDecision(
    community: Community,
    targetUserId: string,
    approved: boolean,
  ): Promise<void> {
    try {
      await this.persist(targetUserId, {
        title: approved ? 'Join request approved' : 'Join request declined',
        message: approved
          ? `You're now a member of ${community.name}`
          : `Your request to join ${community.name} was declined`,
        type: approved ? NotificationType.SUCCESS : NotificationType.INFO,
        metadata: { deeplink: `/communities/${community.id}`, communityId: community.id },
      });
    } catch (err) {
      this.logger.warn(`requestDecision notify failed: ${asMessage(err)}`);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private persist(userId: string, dto: CreateNotificationDto) {
    return this.notifications.create(userId, dto);
  }

  /** Member user IDs for a community, optionally excluding one user. */
  private async memberIds(communityId: string, exclude?: string): Promise<string[]> {
    const rows = await this.memberRepo.find({
      where: exclude
        ? { communityId, userId: Not(exclude) }
        : { communityId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** User IDs of all platform admins (roles array contains 'admin'). */
  private async platformAdminIds(): Promise<string[]> {
    const rows = await this.userRepo
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .where(':role = ANY(u.roles)', { role: UserRole.ADMIN })
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
