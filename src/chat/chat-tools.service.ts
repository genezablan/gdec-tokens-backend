import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Not, Repository } from 'typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { User } from '../entities/user.entity';
import {
  CoachingSessionStatus,
  EmployeeType,
  RequestStatus,
} from '../common/enums';

export type PlatformMetric =
  | 'requests_by_status'
  | 'requests_by_type'
  | 'requests_by_department'
  | 'sessions_by_status'
  | 'top_coaches'
  | 'token_usage';

/** Profile fields an admin may change through chat. Roles, activation and manager are deliberately excluded. */
export interface EmployeeProfileChanges {
  email?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  department?: string;
  position?: string | null;
  location?: string | null;
  contact?: string | null;
  employeeType?: EmployeeType;
}

type ProfileField = keyof EmployeeProfileChanges;

interface PendingUpdate {
  targetUserId: string;
  changes: EmployeeProfileChanges;
  /** Values at proposal time — the update is refused if the record moved since. */
  before: Record<string, unknown>;
  /** Chat request that proposed it; confirmation must come from a later one. */
  turnId: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Database queries exposed to the AI chat as tools.
 *
 * Personal queries are always scoped to the requesting user's id — the model
 * never chooses whose data to read. Platform-wide aggregates return counts
 * only (no per-employee rows) and the caller (ChatService) gates them by role.
 *
 * The only writes are admin profile edits, which are two-phase: a proposal is
 * held in memory per admin, and can only be applied by a *later* chat request
 * — so the model cannot propose and apply in one turn; the admin must reply
 * in between. In-memory is fine because the backend runs as a single PM2
 * instance; a restart just drops unconfirmed proposals.
 */
@Injectable()
export class ChatToolsService {
  private readonly logger = new Logger(ChatToolsService.name);
  private readonly pendingUpdates = new Map<string, PendingUpdate>();

  constructor(
    @InjectRepository(TokenBalance)
    private readonly balances: Repository<TokenBalance>,
    @InjectRepository(TokenRequest)
    private readonly requests: Repository<TokenRequest>,
    @InjectRepository(CoachingSession)
    private readonly sessions: Repository<CoachingSession>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async getMyTokenBalance(userId: string, year?: number) {
    const y = year ?? new Date().getFullYear();
    const balance = await this.balances.findOne({
      where: { userId, year: y },
    });
    if (!balance) {
      return { year: y, note: 'No token balance record exists for this year.' };
    }
    return {
      year: y,
      allocated: balance.allocated,
      boostTokens: balance.boostTokens,
      used: balance.used,
      remaining: balance.remaining,
    };
  }

  async getMyTokenRequests(
    userId: string,
    status?: RequestStatus,
    year?: number,
  ) {
    const where: Record<string, unknown> = { employeeId: userId };
    if (status) where.status = status;
    if (year) where.year = year;

    const [items, total] = await this.requests.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: 25,
    });
    return {
      total,
      showing: items.length,
      requests: items.map((r) => ({
        type: r.type,
        status: r.status,
        tokenCost: r.tokenCost,
        year: r.year,
        createdAt: r.createdAt,
      })),
    };
  }

  /** Coaches see sessions they give; everyone else sees sessions they receive. */
  async getMyCoachingSessions(
    userId: string,
    isCoach: boolean,
    status?: CoachingSessionStatus,
  ) {
    const where: Record<string, unknown> = isCoach
      ? { coachId: userId }
      : { employeeId: userId };
    if (status) where.status = status;

    const [items, total] = await this.sessions.findAndCount({
      where,
      order: { scheduledAt: 'DESC' },
      take: 25,
    });
    return {
      perspective: isCoach ? 'as coach' : 'as employee',
      total,
      showing: items.length,
      sessions: items.map((s) => ({
        sessionNumber: s.sessionNumber,
        scheduledAt: s.scheduledAt,
        status: s.status,
      })),
    };
  }

  /** Aggregate platform analytics. Role-gated by ChatService (admin / HR only). */
  async getPlatformStats(metric: PlatformMetric, year?: number) {
    const y = year ?? new Date().getFullYear();

    switch (metric) {
      case 'requests_by_status':
        return {
          year: y,
          byStatus: await this.requests
            .createQueryBuilder('r')
            .select('r.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where('r.year = :y', { y })
            .groupBy('r.status')
            .getRawMany(),
        };

      case 'requests_by_type':
        return {
          year: y,
          byType: await this.requests
            .createQueryBuilder('r')
            .select('r.type', 'type')
            .addSelect('COUNT(*)', 'count')
            .addSelect('SUM(r.tokenCost)', 'totalTokenCost')
            .where('r.year = :y', { y })
            .groupBy('r.type')
            .getRawMany(),
        };

      case 'requests_by_department':
        return {
          year: y,
          byDepartment: await this.requests
            .createQueryBuilder('r')
            .select('r.snapshotDepartment', 'department')
            .addSelect('COUNT(*)', 'count')
            .where('r.year = :y', { y })
            .groupBy('r.snapshotDepartment')
            .orderBy('COUNT(*)', 'DESC')
            .getRawMany(),
        };

      case 'sessions_by_status':
        return {
          year: y,
          byStatus: await this.sessions
            .createQueryBuilder('s')
            .select('s.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .where("date_part('year', s.scheduledAt) = :y", { y })
            .groupBy('s.status')
            .getRawMany(),
        };

      case 'top_coaches': {
        const rows: Array<{ coachId: string; completedSessions: string }> =
          await this.sessions
            .createQueryBuilder('s')
            .select('s.coachId', 'coachId')
            .addSelect('COUNT(*)', 'completedSessions')
            .where('s.status = :st', { st: CoachingSessionStatus.COMPLETED })
            .andWhere("date_part('year', s.scheduledAt) = :y", { y })
            .groupBy('s.coachId')
            .orderBy('COUNT(*)', 'DESC')
            .limit(5)
            .getRawMany();

        const coaches = rows.length
          ? await this.users.findBy({ id: In(rows.map((r) => r.coachId)) })
          : [];
        const nameById = new Map(coaches.map((c) => [c.id, c.fullName]));
        return {
          year: y,
          topCoaches: rows.map((r) => ({
            coach: nameById.get(r.coachId) ?? 'Unknown',
            completedSessions: Number(r.completedSessions),
          })),
        };
      }

      case 'token_usage': {
        const totals = await this.balances
          .createQueryBuilder('b')
          .select('COUNT(*)', 'employeesWithBalance')
          .addSelect('SUM(b.allocated)', 'totalAllocated')
          .addSelect('SUM(b.boostTokens)', 'totalBoostTokens')
          .addSelect('SUM(b.used)', 'totalUsed')
          .where('b.year = :y', { y })
          .getRawOne();
        return { year: y, ...totals };
      }
    }
  }

  /** Admin lookup by name, email, or employee ID. Role-gated by ChatService. */
  async findEmployees(query: string) {
    const q = `%${query.trim()}%`;
    const matches = await this.users
      .createQueryBuilder('u')
      .where(
        `concat_ws(' ', u.firstName, u.middleName, u.lastName) ILIKE :q
         OR concat_ws(' ', u.firstName, u.lastName) ILIKE :q
         OR u.email ILIKE :q
         OR u.employeeId ILIKE :q`,
        { q },
      )
      .orderBy('u.lastName', 'ASC')
      .addOrderBy('u.firstName', 'ASC')
      .take(10)
      .getMany();
    return {
      showing: matches.length,
      employees: matches.map((u) => this.profileSnapshot(u)),
    };
  }

  /** Stage a profile edit for the admin to confirm. Nothing is written here. */
  async proposeEmployeeUpdate(
    adminId: string,
    turnId: string,
    targetUserId: string,
    changes: EmployeeProfileChanges,
  ) {
    const target = await this.users.findOne({ where: { id: targetUserId } });
    if (!target) return { error: 'No employee found with that id.' };

    const effective: EmployeeProfileChanges = {};
    const before: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(changes) as [
      ProfileField,
      unknown,
    ][]) {
      if (value === undefined || target[field] === value) continue;
      (effective as Record<string, unknown>)[field] = value;
      before[field] = target[field] ?? null;
    }
    if (!Object.keys(effective).length) {
      return {
        error:
          'Those values already match the current record — nothing to change.',
      };
    }

    if (effective.email) {
      const taken = await this.users.findOne({
        where: { email: ILike(effective.email), id: Not(target.id) },
      });
      if (taken) {
        return {
          error: `The email ${effective.email} already belongs to ${taken.fullName}.`,
        };
      }
    }

    // The chat history is text-only, so on the admin's "yes" the model can't
    // see its earlier tool call and often re-proposes before confirming. An
    // identical re-proposal keeps the original entry — the admin has already
    // seen and replied to it — or confirmation would be blocked as same-turn.
    const existing = this.pendingUpdates.get(adminId);
    const isRepeat =
      existing &&
      Date.now() - existing.createdAt <= PENDING_TTL_MS &&
      existing.targetUserId === target.id &&
      JSON.stringify(existing.changes) === JSON.stringify(effective);
    if (!isRepeat) {
      this.pendingUpdates.set(adminId, {
        targetUserId: target.id,
        changes: effective,
        before,
        turnId,
        createdAt: Date.now(),
      });
    }
    this.logger.log(
      `Admin ${adminId} ${isRepeat ? 're-proposed (kept earlier proposal)' : 'proposed'} edit to user ${target.id}: ${JSON.stringify(effective)}`,
    );
    return {
      status: 'awaiting_confirmation',
      employee: `${target.fullName} (${target.employeeId})`,
      changes: Object.keys(effective).map((field) => ({
        field,
        from: before[field],
        to: effective[field as ProfileField],
      })),
      instruction:
        'Nothing has been saved. Show these changes to the admin and ask them to confirm. Only call confirm_employee_update after they reply agreeing.',
    };
  }

  /** Apply the admin's staged edit — only from a later chat request than the proposal. */
  async confirmEmployeeUpdate(adminId: string, turnId: string) {
    const pending = this.pendingUpdates.get(adminId);
    if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
      this.logger.warn(
        `Admin ${adminId} confirm refused: ${pending ? 'proposal expired' : 'no pending proposal'}`,
      );
      this.pendingUpdates.delete(adminId);
      return {
        error:
          'Nothing was saved: no change has been proposed yet, or the proposal expired (10 minutes). Call propose_employee_update now, show the admin its result, and tell them you need their confirmation once more.',
      };
    }
    if (pending.turnId === turnId) {
      this.logger.warn(
        `Admin ${adminId} confirm refused: proposed in this same chat turn`,
      );
      return {
        error:
          'The admin has not confirmed yet. Show the proposed changes and wait for their reply before confirming.',
      };
    }

    const target = await this.users.findOne({
      where: { id: pending.targetUserId },
    });
    if (!target) {
      this.pendingUpdates.delete(adminId);
      return { error: 'That employee no longer exists.' };
    }
    const stale = Object.entries(pending.before).some(
      ([field, value]) => (target[field as ProfileField] ?? null) !== value,
    );
    if (stale) {
      this.pendingUpdates.delete(adminId);
      return {
        error:
          'The record changed after the proposal was made. Look it up again and re-propose.',
      };
    }

    if (pending.changes.email) {
      const taken = await this.users.findOne({
        where: { email: ILike(pending.changes.email), id: Not(target.id) },
      });
      if (taken) {
        this.pendingUpdates.delete(adminId);
        return {
          error: `The email ${pending.changes.email} now belongs to ${taken.fullName}.`,
        };
      }
    }

    Object.assign(target, pending.changes);
    await this.users.save(target);
    this.pendingUpdates.delete(adminId);

    this.logger.log(
      `Admin ${adminId} updated user ${target.id} (${target.employeeId}) via chat: ` +
        Object.keys(pending.changes)
          .map(
            (f) =>
              `${f}: ${JSON.stringify(pending.before[f])} -> ${JSON.stringify(pending.changes[f as ProfileField])}`,
          )
          .join('; '),
    );
    return { status: 'saved', employee: this.profileSnapshot(target) };
  }

  private profileSnapshot(u: User) {
    return {
      id: u.id,
      employeeId: u.employeeId,
      name: u.fullName,
      email: u.email,
      firstName: u.firstName,
      middleName: u.middleName ?? null,
      lastName: u.lastName,
      department: u.department,
      position: u.position,
      location: u.location,
      contact: u.contact ?? null,
      employeeType: u.employeeType,
      isActive: u.isActive,
    };
  }
}
