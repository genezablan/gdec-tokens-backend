import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Community } from '../entities/community.entity';
import { CommunityMember } from '../entities/community-member.entity';
import { CommunityRequest } from '../entities/community-request.entity';
import { CommunityInvitation } from '../entities/community-invitation.entity';
import { CommunityResource } from '../entities/community-resource.entity';
import { User } from '../entities/user.entity';
import { CommunityPrivacy, CommunityRole } from '../common/enums';
import { CommunityAccessService } from './community-access.service';
import { CommunityNotifier } from './community-notifier.service';
import { S3Service } from '../common/services/s3.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { ReplaceResourcesDto } from './dto/community-resource.dto';
import {
  ApiCommunity,
  ApiInvitation,
  ApiJoinRequest,
  ApiMember,
  ApiMyInvitation,
  CommunityMapper,
} from './community.mapper';

export type CommunityFilter = 'all' | 'joined' | 'discover';

@Injectable()
export class CommunitiesService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(CommunityMember)
    private readonly memberRepo: Repository<CommunityMember>,
    @InjectRepository(CommunityRequest)
    private readonly requestRepo: Repository<CommunityRequest>,
    @InjectRepository(CommunityInvitation)
    private readonly invitationRepo: Repository<CommunityInvitation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(CommunityResource)
    private readonly resourceRepo: Repository<CommunityResource>,
    private readonly access: CommunityAccessService,
    private readonly mapper: CommunityMapper,
    private readonly notifier: CommunityNotifier,
    private readonly s3Service: S3Service,
  ) {}

  // ─── Directory ────────────────────────────────────────────────────────────

  /**
   * GET /communities — directory.
   * `filter`: all | joined | discover (not joined). `q`: search name/description/topics.
   * Sorted by memberCount desc (docs/community.md §7).
   */
  async list(
    user: User,
    filter: CommunityFilter = 'all',
    q?: string,
  ): Promise<ApiCommunity[]> {
    const qb = this.communityRepo
      .createQueryBuilder('c')
      .leftJoin(
        'community_members',
        'mc',
        'mc."communityId" = c.id AND mc."userId" = :userId',
        { userId: user.id },
      );

    if (filter === 'joined') {
      qb.andWhere('mc.userId IS NOT NULL');
    } else if (filter === 'discover') {
      qb.andWhere('mc.userId IS NULL');
    }

    if (q?.trim()) {
      const term = `%${q.trim().toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('LOWER(c.name) LIKE :term', { term })
            .orWhere('LOWER(c.description) LIKE :term', { term })
            .orWhere(
              `EXISTS (SELECT 1 FROM unnest(c.topics) t WHERE LOWER(t) LIKE :term)`,
              { term },
            );
        }),
      );
    }

    const communities = await qb.getMany();
    // Order by member count desc, computed in the mapper; sort the mapped result.
    const mapped = await this.mapper.mapMany(communities, user.id);
    return mapped.sort((a, b) => b.memberCount - a.memberCount);
  }

  async getOne(user: User, id: string): Promise<ApiCommunity> {
    const community = await this.access.getCommunityOrThrow(id);
    return this.mapper.mapOne(community, user.id);
  }

  // ─── Admin: create & manage ───────────────────────────────────────────────

  /**
   * POST /communities — create a community. The creator becomes a community
   * admin member.
   *
   * Platform admins may create either privacy level and may claim a human slug
   * id (`cnb-team`). Regular users may only create **private** communities, and
   * always get a generated UUID id so the readable-slug namespace stays
   * admin-owned.
   */
  async create(user: User, dto: CreateCommunityDto): Promise<ApiCommunity> {
    const isPlatformAdmin = this.access.isPlatformAdmin(user);

    if (!isPlatformAdmin && dto.privacy === CommunityPrivacy.PUBLIC) {
      throw new ForbiddenException(
        'Only platform admins can create public communities',
      );
    }

    const privacy = isPlatformAdmin
      ? (dto.privacy ?? CommunityPrivacy.PUBLIC)
      : CommunityPrivacy.PRIVATE;

    const id = (isPlatformAdmin && dto.id?.trim()) || uuidv4();

    if (await this.communityRepo.findOne({ where: { id } })) {
      throw new ConflictException(`Community '${id}' already exists`);
    }

    await this.communityRepo.save(
      this.communityRepo.create({
        id,
        name: dto.name.trim(),
        slug: isPlatformAdmin
          ? dto.slug?.trim() || dto.id?.trim() || null
          : null,
        description: dto.description ?? null,
        about: dto.about ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        coverUrl: dto.coverUrl ?? null,
        privacy,
        topics: dto.topics ?? [],
      }),
    );

    if (dto.resources?.length) {
      await this.resourceRepo.save(
        dto.resources.map((r, i) =>
          this.resourceRepo.create({ communityId: id, ...r, sortOrder: i }),
        ),
      );
    }

    // Creator becomes a community admin so they can manage it.
    await this.memberRepo.save(
      this.memberRepo.create({
        communityId: id,
        userId: user.id,
        role: CommunityRole.ADMIN,
      }),
    );

    const community = await this.access.getCommunityOrThrow(id);
    return this.mapper.mapOne(community, user.id);
  }

  /** PATCH /communities/:id — edit metadata (community admin or platform admin). */
  async update(
    user: User,
    id: string,
    dto: UpdateCommunityDto,
  ): Promise<ApiCommunity> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    if (dto.name !== undefined) community.name = dto.name.trim();
    if (dto.description !== undefined) community.description = dto.description;
    if (dto.about !== undefined) community.about = dto.about;
    if (dto.avatarUrl !== undefined) community.avatarUrl = dto.avatarUrl;
    if (dto.coverUrl !== undefined) community.coverUrl = dto.coverUrl;
    if (dto.privacy !== undefined) {
      // Mirrors create(): opening a community to the whole company is a
      // platform-admin decision, so a community admin can't do it here.
      if (
        dto.privacy === CommunityPrivacy.PUBLIC &&
        !this.access.isPlatformAdmin(user)
      ) {
        throw new ForbiddenException(
          'Only platform admins can make a community public',
        );
      }
      community.privacy = dto.privacy;
    }
    if (dto.topics !== undefined) community.topics = dto.topics;

    await this.communityRepo.save(community);
    return this.mapper.mapOne(community, user.id);
  }

  /** PUT /communities/:id/resources — replace the resource list (admin). */
  async replaceResources(
    user: User,
    id: string,
    dto: ReplaceResourcesDto,
  ): Promise<ApiCommunity> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    await this.resourceRepo.delete({ communityId: id });
    if (dto.resources.length) {
      await this.resourceRepo.save(
        dto.resources.map((r, i) =>
          this.resourceRepo.create({ communityId: id, ...r, sortOrder: i }),
        ),
      );
    }
    return this.mapper.mapOne(community, user.id);
  }

  /**
   * POST /communities/:id/members/:userId/role — promote/demote a member (admin).
   * Returns the updated member list.
   */
  async updateMemberRole(
    user: User,
    id: string,
    targetUserId: string,
    role: CommunityRole,
  ): Promise<ApiMember[]> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    const member = await this.memberRepo.findOne({
      where: { communityId: id, userId: targetUserId },
    });
    if (!member) throw new NotFoundException('User is not a member');

    member.role = role;
    await this.memberRepo.save(member);
    return this.listMembers(user, id);
  }

  /**
   * POST /communities/:id/members/:userId/expert — toggle a member's expert flag
   * (admin). Returns the updated member list.
   */
  async toggleMemberExpert(
    user: User,
    id: string,
    targetUserId: string,
  ): Promise<ApiMember[]> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    const member = await this.memberRepo.findOne({
      where: { communityId: id, userId: targetUserId },
    });
    if (!member) throw new NotFoundException('User is not a member');

    member.expert = !member.expert;
    await this.memberRepo.save(member);
    return this.listMembers(user, id);
  }

  // ─── Membership ─────────────────────────────────────────────────────────────

  /**
   * POST /communities/:id/join
   * public  → caller becomes a member immediately.
   * private → creates a pending join request (membership unchanged).
   */
  async join(user: User, id: string): Promise<ApiCommunity> {
    const community = await this.access.getCommunityOrThrow(id);

    const existing = await this.access.getMembership(id, user.id);
    if (existing) return this.mapper.mapOne(community, user.id);

    if (community.privacy === CommunityPrivacy.PUBLIC) {
      await this.memberRepo.save(
        this.memberRepo.create({
          communityId: id,
          userId: user.id,
          role: CommunityRole.MEMBER,
        }),
      );
    } else {
      // Private: upsert a join request (idempotent).
      const pending = await this.requestRepo.findOne({
        where: { communityId: id, userId: user.id },
      });
      if (!pending) {
        await this.requestRepo.save(
          this.requestRepo.create({ communityId: id, userId: user.id }),
        );
        void this.notifier.joinRequested(community, user.fullName);
      }
    }

    return this.mapper.mapOne(community, user.id);
  }

  /** POST /communities/:id/leave — remove membership and clear any pending request. */
  async leave(user: User, id: string): Promise<ApiCommunity> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.memberRepo.delete({ communityId: id, userId: user.id });
    await this.requestRepo.delete({ communityId: id, userId: user.id });
    return this.mapper.mapOne(community, user.id);
  }

  /** DELETE /communities/:id/request — cancel the caller's pending join request. */
  async cancelRequest(user: User, id: string): Promise<ApiCommunity> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.requestRepo.delete({ communityId: id, userId: user.id });
    return this.mapper.mapOne(community, user.id);
  }

  // ─── Members & requests ─────────────────────────────────────────────────────

  /** GET /communities/:id/members — 403 for non-members of a private community. */
  async listMembers(user: User, id: string): Promise<ApiMember[]> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCanViewContent(community, user);

    const members = await this.memberRepo.find({
      where: { communityId: id },
      relations: { user: true },
      order: { role: 'ASC', joinedAt: 'ASC' },
    });
    const mapped = members.map((m) => this.mapper.mapMember(m));
    await this.s3Service.presignAvatars(mapped);
    return mapped;
  }

  /** GET /communities/:id/requests — community admin only. */
  async listRequests(user: User, id: string): Promise<ApiJoinRequest[]> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    const requests = await this.requestRepo.find({
      where: { communityId: id },
      relations: { user: true },
      order: { requestedAt: 'ASC' },
    });
    return requests.map((r) => this.mapper.mapJoinRequest(r));
  }

  /** POST /communities/:id/requests/:userId/approve — admin only. */
  async approveRequest(
    user: User,
    id: string,
    targetUserId: string,
  ): Promise<{ members: ApiMember[]; requests: ApiJoinRequest[] }> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    const request = await this.requestRepo.findOne({
      where: { communityId: id, userId: targetUserId },
    });
    if (!request) throw new NotFoundException('Join request not found');

    const alreadyMember = await this.access.getMembership(id, targetUserId);
    if (!alreadyMember) {
      await this.memberRepo.save(
        this.memberRepo.create({
          communityId: id,
          userId: targetUserId,
          role: CommunityRole.MEMBER,
        }),
      );
    }
    await this.requestRepo.delete({ communityId: id, userId: targetUserId });
    void this.notifier.requestDecision(community, targetUserId, true);

    return {
      members: await this.listMembers(user, id),
      requests: await this.listRequests(user, id),
    };
  }

  /** POST /communities/:id/requests/:userId/decline — admin only. */
  async declineRequest(
    user: User,
    id: string,
    targetUserId: string,
  ): Promise<{ requests: ApiJoinRequest[] }> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    const existing = await this.requestRepo.findOne({
      where: { communityId: id, userId: targetUserId },
    });
    await this.requestRepo.delete({ communityId: id, userId: targetUserId });
    if (existing) {
      void this.notifier.requestDecision(community, targetUserId, false);
    }
    return { requests: await this.listRequests(user, id) };
  }

  // ─── Invitations ────────────────────────────────────────────────────────────
  // The mirror of join requests: an admin invites, the invitee decides. Accepting
  // is always the invitee's action — an invitation never grants membership on its
  // own, so nobody ends up in a community they did not choose.

  /**
   * POST /communities/:id/invitations — admin only.
   *
   * Reports a per-user outcome rather than failing the batch: inviting five
   * people where one is already a member should invite the other four, not
   * reject the lot.
   */
  async invite(
    user: User,
    id: string,
    userIds: string[],
  ): Promise<{
    invited: string[];
    alreadyMember: string[];
    alreadyInvited: string[];
    notFound: string[];
  }> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    const unique = [...new Set(userIds)];
    const result = {
      invited: [] as string[],
      alreadyMember: [] as string[],
      alreadyInvited: [] as string[],
      notFound: [] as string[],
    };
    if (unique.length === 0) return result;

    // Three lookups for the whole batch rather than three per invitee.
    const [users, members, invitations] = await Promise.all([
      this.userRepo.find({
        where: { id: In(unique), isActive: true },
        select: { id: true },
      }),
      this.memberRepo.find({ where: { communityId: id, userId: In(unique) } }),
      this.invitationRepo.find({
        where: { communityId: id, userId: In(unique) },
      }),
    ]);
    const active = new Set(users.map((u) => u.id));
    const isMember = new Set(members.map((m) => m.userId));
    const isInvited = new Set(invitations.map((i) => i.userId));

    const toCreate: CommunityInvitation[] = [];
    for (const userId of unique) {
      if (!active.has(userId)) result.notFound.push(userId);
      else if (isMember.has(userId)) result.alreadyMember.push(userId);
      else if (isInvited.has(userId)) result.alreadyInvited.push(userId);
      else {
        toCreate.push(
          this.invitationRepo.create({
            communityId: id,
            userId,
            invitedById: user.id,
          }),
        );
        result.invited.push(userId);
      }
    }

    if (toCreate.length) {
      await this.invitationRepo.save(toCreate);
      void this.notifier.invited(community, result.invited, user);
    }
    return result;
  }

  /** GET /communities/:id/invitations — admin only. */
  async listInvitations(user: User, id: string): Promise<ApiInvitation[]> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    const invitations = await this.invitationRepo.find({
      where: { communityId: id },
      relations: { user: true },
      order: { invitedAt: 'ASC' },
    });
    return invitations.map((i) => this.mapper.mapInvitation(i));
  }

  /** GET /communities/invitations/mine — what the caller has been invited to. */
  async listMyInvitations(user: User): Promise<ApiMyInvitation[]> {
    const invitations = await this.invitationRepo.find({
      where: { userId: user.id },
      relations: { community: true, invitedBy: true },
      order: { invitedAt: 'DESC' },
    });
    return invitations.map((i) => this.mapper.mapMyInvitation(i));
  }

  /**
   * POST /communities/:id/invitations/accept — the invitee joins.
   *
   * The delete and the insert share a transaction: without it a failure between
   * them consumes the invitation and leaves the user in neither state, with no
   * way back in.
   */
  async acceptInvitation(user: User, id: string): Promise<ApiCommunity> {
    const community = await this.access.getCommunityOrThrow(id);

    const invitation = await this.invitationRepo.findOne({
      where: { communityId: id, userId: user.id },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    await this.invitationRepo.manager.transaction(async (manager) => {
      await manager.delete(CommunityInvitation, {
        communityId: id,
        userId: user.id,
      });
      const already = await manager.findOne(CommunityMember, {
        where: { communityId: id, userId: user.id },
      });
      if (!already) {
        await manager.save(
          manager.create(CommunityMember, {
            communityId: id,
            userId: user.id,
            role: CommunityRole.MEMBER,
          }),
        );
      }
      // A pending join request is moot once they are in.
      await manager.delete(CommunityRequest, {
        communityId: id,
        userId: user.id,
      });
    });

    void this.notifier.inviteDecision(
      community,
      invitation.invitedById,
      user,
      true,
    );
    return this.mapper.mapOne(community, user.id);
  }

  /** POST /communities/:id/invitations/decline — the invitee says no. */
  async declineInvitation(user: User, id: string): Promise<{ declined: true }> {
    const community = await this.access.getCommunityOrThrow(id);

    const invitation = await this.invitationRepo.findOne({
      where: { communityId: id, userId: user.id },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');

    await this.invitationRepo.delete({ communityId: id, userId: user.id });
    void this.notifier.inviteDecision(
      community,
      invitation.invitedById,
      user,
      false,
    );
    return { declined: true };
  }

  /** DELETE /communities/:id/invitations/:userId — admin withdraws it. */
  async revokeInvitation(
    user: User,
    id: string,
    targetUserId: string,
  ): Promise<{ invitations: ApiInvitation[] }> {
    const community = await this.access.getCommunityOrThrow(id);
    await this.access.assertCommunityAdmin(community, user);

    await this.invitationRepo.delete({
      communityId: id,
      userId: targetUserId,
    });
    return { invitations: await this.listInvitations(user, id) };
  }
}
