import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { User } from '../entities/user.entity';
import { CoachingSessionStatus, RequestStatus } from '../common/enums';

export type PlatformMetric =
  | 'requests_by_status'
  | 'requests_by_type'
  | 'requests_by_department'
  | 'sessions_by_status'
  | 'top_coaches'
  | 'token_usage';

/**
 * Read-only database queries exposed to the AI chat as tools.
 *
 * Personal queries are always scoped to the requesting user's id — the model
 * never chooses whose data to read. Platform-wide aggregates return counts
 * only (no per-employee rows) and the caller (ChatService) gates them by role.
 */
@Injectable()
export class ChatToolsService {
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
}
