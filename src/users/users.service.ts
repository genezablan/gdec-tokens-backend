import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { TokenBalance } from '../entities/token-balance.entity';
import { UserFollow } from '../entities/user-follow.entity';
import { Post } from '../entities/post.entity';
import { PostStatus, UserRole } from '../common/enums';
import { EmailService } from '../common/services/email.service';
import { S3Service } from '../common/services/s3.service';

const TOKENS_PER_YEAR = 6;

/** Public profile shape consumed by the member profile page. */
export interface ApiUserProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  department: string | null;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
  isSelf: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(TokenBalance)
    private readonly tokenBalanceRepo: Repository<TokenBalance>,
    @InjectRepository(UserFollow)
    private readonly followRepo: Repository<UserFollow>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>,
    private readonly emailService: EmailService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * GET /users/:id/profile — public profile + per-viewer follow state. Available
   * to any authenticated user (unlike the admin-oriented findOne).
   */
  async getProfile(viewerId: string, targetId: string): Promise<ApiUserProfile> {
    const user = await this.userRepo.findOne({ where: { id: targetId } });
    if (!user) throw new NotFoundException('User not found');

    const [postsCount, followersCount, followingCount, mine] = await Promise.all([
      this.postRepo.count({ where: { authorId: targetId, status: PostStatus.APPROVED } }),
      this.followRepo.count({ where: { followingId: targetId } }),
      this.followRepo.count({ where: { followerId: targetId } }),
      this.followRepo.findOne({ where: { followerId: viewerId, followingId: targetId } }),
    ]);

    const profile: ApiUserProfile = {
      id: user.id,
      name: user.fullName,
      avatarUrl: user.profilePicture ?? null,
      jobTitle: user.position ?? null,
      department: user.department ?? null,
      postsCount,
      followersCount,
      followingCount,
      isFollowing: !!mine,
      isSelf: viewerId === targetId,
    };
    await this.s3Service.presignAvatars([profile]);
    return profile;
  }

  /**
   * POST /users/:id/follow — toggle the viewer's follow of the target.
   * Returns the new follow state + follower count. Self-follow is rejected.
   */
  async toggleFollow(
    followerId: string,
    targetId: string,
  ): Promise<{ isFollowing: boolean; followersCount: number }> {
    if (followerId === targetId) {
      throw new BadRequestException('You cannot follow yourself');
    }
    const target = await this.userRepo.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');

    const existing = await this.followRepo.findOne({
      where: { followerId, followingId: targetId },
    });
    if (existing) {
      await this.followRepo.delete({ followerId, followingId: targetId });
    } else {
      await this.followRepo.save(this.followRepo.create({ followerId, followingId: targetId }));
    }

    const followersCount = await this.followRepo.count({ where: { followingId: targetId } });
    return { isFollowing: !existing, followersCount };
  }

  private safeUser(user: User) {
    return {
      id: user.id,
      employeeId: user.employeeId,
      email: user.email,
      firstName: user.firstName,
      middleName: user.middleName,
      lastName: user.lastName,
      fullName: user.fullName,
      gender: user.gender,
      department: user.department,
      location: user.location,
      position: user.position,
      employeeType: user.employeeType,
      employeeStatus: user.employeeStatus,
      roles: user.roles,
      isActive: user.isActive,
      isPasswordChanged: user.isPasswordChanged,
      immediateSupervisorId: user.immediateSupervisorId,
      contact: user.contact,
      separationDate: user.separationDate,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * List users.
   * - ?role=coach|employee|approver|hr_approver|admin  → filter by role (users who have that role)
   * - ?isActive=true|false                              → filter by active status (default: all)
   * Sorted by lastName asc.
   */
  async findAll(role?: UserRole, isActive?: boolean, isPendingApproval?: boolean) {
    const where: Record<string, unknown> = {};

    if (role) {
      where.roles = ArrayContains([role]);
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isPendingApproval !== undefined) {
      where.isPendingApproval = isPendingApproval;
    }

    const users = await this.userRepo.find({
      where,
      order: { lastName: 'ASC', firstName: 'ASC' },
    });

    return users.map((u) => this.safeUser(u));
  }

  async findOne(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.safeUser(user);
  }

  /**
   * People-picker search for the Community composer (@mentions / praise).
   * Returns up to `limit` active users as UserBrief { id, name, avatarUrl }.
   * Empty query returns a small suggested set. (docs/community.md §9.1)
   */
  async searchBriefs(q?: string, limit = 8) {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .where('u.isActive = true')
      .orderBy('u.firstName', 'ASC')
      .addOrderBy('u.lastName', 'ASC')
      .take(limit);

    if (q?.trim()) {
      const term = `%${q.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(u.firstName) LIKE :term OR LOWER(u.lastName) LIKE :term
          OR LOWER(u.firstName || ' ' || u.lastName) LIKE :term)`,
        { term },
      );
    }

    const users = await qb.getMany();
    return users.map((u) => ({
      id: u.id,
      name: u.fullName,
      avatarUrl: u.profilePicture ?? null,
    }));
  }

  async updateRoles(id: string, roles: UserRole[]) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.roles = roles;
    await this.userRepo.save(user);
    return this.safeUser(user);
  }

  async toggleActive(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.isActive = !user.isActive;
    await this.userRepo.save(user);
    return this.safeUser(user);
  }

  async approvePendingRegistration(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (!user.isPendingApproval) {
      throw new BadRequestException('This account is not pending approval');
    }

    user.isPendingApproval = false;
    user.isActive = true;
    await this.userRepo.save(user);

    // Auto-allocate tokens for the current year
    const currentYear = new Date().getFullYear();
    const existingBalance = await this.tokenBalanceRepo.findOne({
      where: { userId: user.id, year: currentYear },
    });
    if (!existingBalance) {
      await this.tokenBalanceRepo.save(
        this.tokenBalanceRepo.create({
          userId: user.id,
          year: currentYear,
          allocated: TOKENS_PER_YEAR,
          used: 0,
        }),
      );
    }

    this.emailService.sendRegistrationApprovedEmail({
      email: user.email,
      name: user.fullName,
    }).catch(() => {});

    return {
      ...this.safeUser(user),
      tokensAllocated: TOKENS_PER_YEAR,
      tokenYear: currentYear,
    };
  }

  async rejectPendingRegistration(id: string, reason?: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (!user.isPendingApproval) {
      throw new BadRequestException('This account is not pending approval');
    }

    user.isPendingApproval = false;
    user.isActive = false;
    await this.userRepo.save(user);

    this.emailService.sendRegistrationRejectedEmail({
      email: user.email,
      name: user.fullName,
      reason,
    }).catch(() => {});

    return this.safeUser(user);
  }
}
