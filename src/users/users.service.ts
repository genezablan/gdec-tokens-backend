import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, Not, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { TokenBalance } from '../entities/token-balance.entity';
import { UserFollow } from '../entities/user-follow.entity';
import { Post } from '../entities/post.entity';
import { Community } from '../entities/community.entity';
import { CommunityMember } from '../entities/community-member.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { DevelopmentOption } from '../entities/development-option.entity';
import { CommunityRole, UserRole } from '../common/enums';
import { UpdateUserDto } from './dto/update-user.dto';
import { EmailService } from '../common/services/email.service';
import { S3Service } from '../common/services/s3.service';

const TOKENS_PER_YEAR = 6;

/** Company-wide home community (1GDEC) every user belongs to. See scripts/seed-communities.ts. */
const DEFAULT_COMMUNITY_ID = 'general';

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
    @InjectRepository(Community)
    private readonly communityRepo: Repository<Community>,
    @InjectRepository(CommunityMember)
    private readonly communityMemberRepo: Repository<CommunityMember>,
    @InjectRepository(TokenRequest)
    private readonly tokenRequestRepo: Repository<TokenRequest>,
    @InjectRepository(CoachingSession)
    private readonly coachingSessionRepo: Repository<CoachingSession>,
    @InjectRepository(CoachAvailability)
    private readonly coachAvailabilityRepo: Repository<CoachAvailability>,
    @InjectRepository(DevelopmentOption)
    private readonly developmentOptionRepo: Repository<DevelopmentOption>,
    private readonly emailService: EmailService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * GET /users/:id/profile — public profile + per-viewer follow state. Available
   * to any authenticated user (unlike the admin-oriented findOne).
   */
  async getProfile(
    viewerId: string,
    targetId: string,
  ): Promise<ApiUserProfile> {
    const user = await this.userRepo.findOne({ where: { id: targetId } });
    if (!user) throw new NotFoundException('User not found');

    const [postsCount, followersCount, followingCount, mine] =
      await Promise.all([
        this.postRepo.count({ where: { authorId: targetId } }),
        this.followRepo.count({ where: { followingId: targetId } }),
        this.followRepo.count({ where: { followerId: targetId } }),
        this.followRepo.findOne({
          where: { followerId: viewerId, followingId: targetId },
        }),
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
      await this.followRepo.save(
        this.followRepo.create({ followerId, followingId: targetId }),
      );
    }

    const followersCount = await this.followRepo.count({
      where: { followingId: targetId },
    });
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
  async findAll(
    role?: UserRole,
    isActive?: boolean,
    isPendingApproval?: boolean,
  ) {
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
    const briefs = users.map((u) => ({
      id: u.id,
      name: u.fullName,
      avatarUrl: u.profilePicture ?? null,
    }));

    // `profilePicture` holds an S3 object key, and the bucket isn't public — so
    // it has to be signed before it can be used as an <img> src. Every other
    // brief-producing path already does this; this one didn't, which is why
    // @mention suggestions rendered initials instead of photos.
    await this.s3Service.presignAvatars(briefs);
    return briefs;
  }

  /**
   * PATCH /users/:id — HR/admin profile edit.
   * A new supervisor must be an active user with the approver role (the same
   * requirement token-request routing enforces) and cannot be the user themselves.
   */
  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    if (dto.immediateSupervisorId !== undefined) {
      await this.assertValidSupervisor(id, dto.immediateSupervisorId);
      user.immediateSupervisorId = dto.immediateSupervisorId as string;
    }

    if (dto.department !== undefined) user.department = dto.department;
    if (dto.position !== undefined) user.position = dto.position;
    if (dto.employeeType !== undefined) user.employeeType = dto.employeeType;

    await this.userRepo.save(user);
    return this.safeUser(user);
  }

  /** null (clear manager) is always valid; a UUID must be an active approver other than the user. */
  private async assertValidSupervisor(
    userId: string,
    supervisorId: string | null,
  ): Promise<void> {
    if (supervisorId === null) return;
    if (supervisorId === userId) {
      throw new BadRequestException('A user cannot be their own manager');
    }
    const supervisor = await this.userRepo.findOne({
      where: { id: supervisorId },
    });
    if (!supervisor) throw new NotFoundException('Selected manager not found');
    if (!supervisor.isActive) {
      throw new BadRequestException('Selected manager is not an active user');
    }
    if (!supervisor.hasRole(UserRole.APPROVER)) {
      throw new BadRequestException(
        'Selected manager must have the approver role to receive token requests',
      );
    }
  }

  async updateRoles(id: string, roles: UserRole[]) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.roles = roles;
    await this.userRepo.save(user);

    this.emailService
      .sendRolesUpdatedEmail({
        email: user.email,
        name: user.fullName,
        roles: user.roles,
      })
      .catch(() => {});

    return this.safeUser(user);
  }

  async toggleActive(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    user.isActive = !user.isActive;
    await this.userRepo.save(user);

    this.emailService
      .sendAccountStatusChangedEmail({
        email: user.email,
        name: user.fullName,
        isActive: user.isActive,
      })
      .catch(() => {});

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

    await this.joinDefaultCommunity(user.id);

    this.emailService
      .sendRegistrationApprovedEmail({
        email: user.email,
        name: user.fullName,
      })
      .catch(() => {});

    return {
      ...this.safeUser(user),
      tokensAllocated: TOKENS_PER_YEAR,
      tokenYear: currentYear,
    };
  }

  /**
   * Every user belongs to the company-wide 1GDEC community. The seed script
   * only backfills users that exist when it runs, so newly approved accounts
   * are joined here. Skips silently if the community was never seeded or the
   * user is already a member; never fails the approval.
   */
  private async joinDefaultCommunity(userId: string): Promise<void> {
    try {
      const community = await this.communityRepo.findOne({
        where: { id: DEFAULT_COMMUNITY_ID },
      });
      if (!community) return;

      const existing = await this.communityMemberRepo.findOne({
        where: { communityId: DEFAULT_COMMUNITY_ID, userId },
      });
      if (existing) return;

      await this.communityMemberRepo.save(
        this.communityMemberRepo.create({
          communityId: DEFAULT_COMMUNITY_ID,
          userId,
          role: CommunityRole.MEMBER,
        }),
      );
    } catch {
      // Best-effort: membership can be fixed by re-running seed:communities.
    }
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

    this.emailService
      .sendRegistrationRejectedEmail({
        email: user.email,
        name: user.fullName,
        reason,
      })
      .catch(() => {});

    return this.safeUser(user);
  }

  /**
   * DELETE /users/:id — Admin-only, permanent removal.
   * Blocked (409, with reasons) if the user is referenced by any relation that
   * the DB enforces as ON DELETE NO ACTION (manager, token requests, coaching
   * data) — those must be reassigned/cleared first. Once clear, the delete
   * relies on DB-level ON DELETE CASCADE / SET NULL to clean up everything
   * else (posts, comments, notifications, community memberships, etc.).
   */
  async deleteUser(
    id: string,
    currentUserId: string,
  ): Promise<{ success: true }> {
    if (id === currentUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    if (user.hasRole(UserRole.ADMIN)) {
      await this.assertNotLastAdmin(id);
    }

    const reasons = await this.findDeletionBlockers(id);
    if (reasons.length > 0) {
      throw new ConflictException({ message: 'Cannot delete user', reasons });
    }

    const result = await this.userRepo.delete(id);
    if (!result.affected) throw new NotFoundException(`User ${id} not found`);
    return { success: true };
  }

  private async assertNotLastAdmin(id: string): Promise<void> {
    const otherAdmins = await this.userRepo.count({
      where: { roles: ArrayContains([UserRole.ADMIN]), id: Not(id) },
    });
    if (otherAdmins === 0) {
      throw new ConflictException(
        'Cannot delete the only remaining admin account',
      );
    }
  }

  /**
   * Counts every relation the DB enforces as ON DELETE NO ACTION for this
   * user (manager, token requests, coaching data) and turns each non-zero
   * count into a human-readable reason the delete is blocked.
   */
  private async findDeletionBlockers(id: string): Promise<string[]> {
    const plural = (n: number) => (n === 1 ? '' : 's');
    const checks: Array<{
      count: Promise<number>;
      label: (n: number) => string;
    }> = [
      {
        count: this.userRepo.count({ where: { immediateSupervisorId: id } }),
        label: (n) => `Is the manager of ${n} employee${plural(n)}`,
      },
      {
        count: this.tokenRequestRepo.count({ where: { employeeId: id } }),
        label: (n) => `Has ${n} token request${plural(n)} as employee`,
      },
      {
        count: this.tokenRequestRepo.count({ where: { managerId: id } }),
        label: (n) => `Has handled ${n} token request${plural(n)} as manager`,
      },
      {
        count: this.tokenRequestRepo.count({ where: { hrId: id } }),
        label: (n) => `Has processed ${n} token request${plural(n)} as HR`,
      },
      {
        count: this.tokenRequestRepo.count({ where: { rejectedById: id } }),
        label: (n) => `Has rejected ${n} token request${plural(n)}`,
      },
      {
        count: this.coachingSessionRepo.count({ where: { coachId: id } }),
        label: (n) => `Has coached ${n} session${plural(n)}`,
      },
      {
        count: this.coachingSessionRepo.count({ where: { employeeId: id } }),
        label: (n) => `Has attended ${n} session${plural(n)} as coachee`,
      },
      {
        count: this.coachAvailabilityRepo.count({ where: { coachId: id } }),
        label: (n) => `Has published ${n} coach availability slot${plural(n)}`,
      },
      {
        count: this.developmentOptionRepo.count({ where: { updatedById: id } }),
        label: (n) => `Has edited ${n} development option${plural(n)}`,
      },
    ];

    const counts = await Promise.all(checks.map((c) => c.count));
    return checks
      .map((c, i) => (counts[i] > 0 ? c.label(counts[i]) : null))
      .filter((reason): reason is string => reason !== null);
  }
}
