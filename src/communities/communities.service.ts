import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Community } from '../entities/community.entity';
import { CommunityMember } from '../entities/community-member.entity';
import { CommunityRequest } from '../entities/community-request.entity';
import { CommunityResource } from '../entities/community-resource.entity';
import { User } from '../entities/user.entity';
import { CommunityPrivacy, CommunityRole } from '../common/enums';
import { CommunityAccessService } from './community-access.service';
import { CommunityNotifier } from './community-notifier.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { ReplaceResourcesDto } from './dto/community-resource.dto';
import {
  ApiCommunity,
  ApiJoinRequest,
  ApiMember,
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
    @InjectRepository(CommunityResource)
    private readonly resourceRepo: Repository<CommunityResource>,
    private readonly access: CommunityAccessService,
    private readonly mapper: CommunityMapper,
    private readonly notifier: CommunityNotifier,
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
   * POST /communities — create a community (platform admin only; gated at the
   * controller). The creator becomes a community admin member.
   */
  async create(user: User, dto: CreateCommunityDto): Promise<ApiCommunity> {
    const id = dto.id?.trim() || uuidv4();

    if (await this.communityRepo.findOne({ where: { id } })) {
      throw new ConflictException(`Community '${id}' already exists`);
    }

    await this.communityRepo.save(
      this.communityRepo.create({
        id,
        name: dto.name.trim(),
        slug: dto.slug?.trim() || dto.id?.trim() || null,
        description: dto.description ?? null,
        about: dto.about ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        coverUrl: dto.coverUrl ?? null,
        privacy: dto.privacy ?? CommunityPrivacy.PUBLIC,
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
    if (dto.privacy !== undefined) community.privacy = dto.privacy;
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
    return members.map((m) => this.mapper.mapMember(m));
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
}
