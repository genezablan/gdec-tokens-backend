import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Community } from '../entities/community.entity';
import { CommunityMember } from '../entities/community-member.entity';
import { CommunityRequest } from '../entities/community-request.entity';
import { User } from '../entities/user.entity';
import { CommunityPrivacy, CommunityRole, UserRole } from '../common/enums';

/**
 * Centralizes Community visibility & RBAC (docs/community.md §2).
 * Shared by the communities module and the community feed module so the rules
 * live in exactly one place.
 */
@Injectable()
export class CommunityAccessService {
  constructor(
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(CommunityMember)
    private readonly memberRepo: Repository<CommunityMember>,
    @InjectRepository(CommunityRequest)
    private readonly requestRepo: Repository<CommunityRequest>,
  ) {}

  /** Load a community or throw 404. */
  async getCommunityOrThrow(id: string): Promise<Community> {
    const community = await this.communityRepo.findOne({ where: { id } });
    if (!community) throw new NotFoundException('Community not found');
    return community;
  }

  getMembership(
    communityId: string,
    userId: string,
  ): Promise<CommunityMember | null> {
    return this.memberRepo.findOne({ where: { communityId, userId } });
  }

  async getRole(
    communityId: string,
    userId: string,
  ): Promise<CommunityRole | null> {
    const membership = await this.getMembership(communityId, userId);
    return membership?.role ?? null;
  }

  async isMember(communityId: string, userId: string): Promise<boolean> {
    return (await this.getMembership(communityId, userId)) !== null;
  }

  hasPendingRequest(communityId: string, userId: string): Promise<boolean> {
    return this.requestRepo
      .findOne({ where: { communityId, userId } })
      .then((r) => r !== null);
  }

  isPlatformAdmin(user: User): boolean {
    return user.roles?.includes(UserRole.ADMIN) ?? false;
  }

  /** True if the caller is a community admin OR a platform admin. */
  async isCommunityAdmin(community: Community, user: User): Promise<boolean> {
    if (this.isPlatformAdmin(user)) return true;
    return (await this.getRole(community.id, user.id)) === CommunityRole.ADMIN;
  }

  /** Throw 403 unless the caller can administer the community. */
  async assertCommunityAdmin(community: Community, user: User): Promise<void> {
    if (!(await this.isCommunityAdmin(community, user))) {
      throw new ForbiddenException(
        'You must be a community admin to perform this action',
      );
    }
  }

  /**
   * A private community's feed & members are visible to members only
   * (platform admins included). Throws 403 otherwise.
   */
  async assertCanViewContent(community: Community, user: User): Promise<void> {
    if (community.privacy === CommunityPrivacy.PUBLIC) return;
    if (this.isPlatformAdmin(user)) return;
    if (await this.isMember(community.id, user.id)) return;
    throw new ForbiddenException('This community is private');
  }
}
