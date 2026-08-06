import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Community } from '../entities/community.entity';
import { CommunityMember } from '../entities/community-member.entity';
import { CommunityRequest } from '../entities/community-request.entity';
import { CommunityInvitation } from '../entities/community-invitation.entity';
import { CommunityResource } from '../entities/community-resource.entity';
import { Post } from '../entities/post.entity';
import { CommunityPrivacy, CommunityRole, ResourceType } from '../common/enums';
import { toUserBrief, UserBrief } from '../common/mappers/user-brief.mapper';

/** API shape for a community resource (docs/community.md §3.6). */
export interface ApiResource {
  id: string;
  type: ResourceType;
  label: string;
  url: string;
}

/** API Community shape (docs/community.md §3.6). */
export interface ApiCommunity {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  about: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  privacy: CommunityPrivacy;
  memberCount: number;
  isJoined: boolean;
  isPending: boolean;
  role: CommunityRole | null;
  topics: string[];
  resources: ApiResource[];
  pinnedPostIds: string[];
  createdAt: Date;
}

/** API Member shape (docs/community.md §3.7). */
export interface ApiMember extends UserBrief {
  role: CommunityRole;
  expert: boolean;
}

/** API JoinRequest shape (docs/community.md §3.7). */
export interface ApiJoinRequest extends UserBrief {
  requestedAt: Date;
}

/** A pending invitation, as the community admin sees it. */
export interface ApiInvitation extends UserBrief {
  invitedAt: Date;
  invitedById: string;
}

/** A pending invitation, as the invitee sees it. */
export interface ApiMyInvitation {
  communityId: string;
  communityName: string;
  privacy: string | null;
  invitedBy: UserBrief | null;
  invitedAt: Date;
}

/**
 * Assembles the caller-relative API Community shape. Batches all per-request
 * lookups (membership, requests, counts, pinned posts, resources) so listing
 * the directory stays a fixed number of queries regardless of result size.
 */
@Injectable()
export class CommunityMapper {
  constructor(
    @InjectRepository(CommunityMember)
    private readonly memberRepo: Repository<CommunityMember>,
    @InjectRepository(CommunityRequest)
    private readonly requestRepo: Repository<CommunityRequest>,
    @InjectRepository(CommunityResource)
    private readonly resourceRepo: Repository<CommunityResource>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
  ) {}

  async mapOne(community: Community, userId: string): Promise<ApiCommunity> {
    const [mapped] = await this.mapMany([community], userId);
    return mapped;
  }

  async mapMany(
    communities: Community[],
    userId: string,
  ): Promise<ApiCommunity[]> {
    const ids = communities.map((c) => c.id);
    if (ids.length === 0) return [];

    const [myMemberships, myRequests, counts, pinned, resources] =
      await Promise.all([
        this.memberRepo.find({ where: { userId, communityId: In(ids) } }),
        this.requestRepo.find({ where: { userId, communityId: In(ids) } }),
        this.memberRepo
          .createQueryBuilder('m')
          .select('m.communityId', 'communityId')
          .addSelect('COUNT(*)', 'count')
          .where('m.communityId IN (:...ids)', { ids })
          .groupBy('m.communityId')
          .getRawMany<{ communityId: string; count: string }>(),
        this.postRepo.find({
          where: { communityId: In(ids), pinned: true },
          select: { id: true, communityId: true },
          order: { createdAt: 'DESC' },
        }),
        this.resourceRepo.find({
          where: { communityId: In(ids) },
          order: { sortOrder: 'ASC' },
        }),
      ]);

    const membershipByCommunity = new Map(
      myMemberships.map((m) => [m.communityId, m]),
    );
    const pendingCommunityIds = new Set(myRequests.map((r) => r.communityId));
    const countByCommunity = new Map(
      counts.map((c) => [c.communityId, Number(c.count)]),
    );
    const pinnedByCommunity = new Map<string, string[]>();
    for (const p of pinned) {
      const list = pinnedByCommunity.get(p.communityId) ?? [];
      list.push(p.id);
      pinnedByCommunity.set(p.communityId, list);
    }
    const resourcesByCommunity = new Map<string, ApiResource[]>();
    for (const r of resources) {
      const list = resourcesByCommunity.get(r.communityId) ?? [];
      list.push({ id: r.id, type: r.type, label: r.label, url: r.url });
      resourcesByCommunity.set(r.communityId, list);
    }

    return communities.map((c) => {
      const membership = membershipByCommunity.get(c.id);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        about: c.about,
        avatarUrl: c.avatarUrl,
        coverUrl: c.coverUrl,
        privacy: c.privacy,
        memberCount: countByCommunity.get(c.id) ?? 0,
        isJoined: !!membership,
        isPending: pendingCommunityIds.has(c.id),
        role: membership?.role ?? null,
        topics: c.topics ?? [],
        resources: resourcesByCommunity.get(c.id) ?? [],
        pinnedPostIds: pinnedByCommunity.get(c.id) ?? [],
        createdAt: c.createdAt,
      };
    });
  }

  /** Map a membership row (its `user` relation must be loaded) to ApiMember. */
  mapMember(member: CommunityMember): ApiMember {
    return {
      ...toUserBrief(member.user),
      role: member.role,
      expert: member.expert,
    };
  }

  /** Map a join-request row (its `user` relation must be loaded) to ApiJoinRequest. */
  mapJoinRequest(request: CommunityRequest): ApiJoinRequest {
    return { ...toUserBrief(request.user), requestedAt: request.requestedAt };
  }

  /**
   * Map an invitation to the admin-facing shape: who was invited, and when.
   * Its `user` relation must be loaded.
   */
  mapInvitation(invitation: CommunityInvitation): ApiInvitation {
    return {
      ...toUserBrief(invitation.user),
      invitedAt: invitation.invitedAt,
      invitedById: invitation.invitedById,
    };
  }

  /**
   * Map an invitation to the invitee-facing shape — they care which community it
   * is and who asked, not about themselves. Needs `community` and `invitedBy`.
   */
  mapMyInvitation(invitation: CommunityInvitation): ApiMyInvitation {
    return {
      communityId: invitation.communityId,
      communityName: invitation.community?.name ?? invitation.communityId,
      privacy: invitation.community?.privacy ?? null,
      invitedBy: invitation.invitedBy
        ? toUserBrief(invitation.invitedBy)
        : null,
      invitedAt: invitation.invitedAt,
    };
  }
}
