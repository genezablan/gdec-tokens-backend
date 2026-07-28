import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { User } from '../entities/user.entity';
import { LoginEvent } from '../entities/login-event.entity';
import {
  CoachingSessionStatus,
  DevelopmentOptionType,
  RequestStatus,
} from '../common/enums';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';
import {
  applyUserFilters,
  monthBuckets,
  monthKeyExpr,
  OPTION_LABELS,
  REPORTING_TZ,
  resolvePeriod,
  round1,
} from './analytics-query.util';

/**
 * Powers the Employee Analytics tab. Without an employeeId filter it returns
 * the roster (sorted by sessions, engagement bucketed by terciles); with one
 * it returns the full single-employee profile.
 */
@Injectable()
export class EmployeeAnalyticsService {
  constructor(
    @InjectRepository(TokenBalance)
    private readonly tokenBalanceRepo: Repository<TokenBalance>,
    @InjectRepository(TokenRequest)
    private readonly tokenRequestRepo: Repository<TokenRequest>,
    @InjectRepository(CoachingSession)
    private readonly coachingSessionRepo: Repository<CoachingSession>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(LoginEvent)
    private readonly loginEventRepo: Repository<LoginEvent>,
  ) {}

  async getEmployees(filters: AnalyticsFiltersDto) {
    const period = resolvePeriod(filters);
    const base = {
      year: period.year,
      month: period.month,
      generatedAt: new Date().toISOString(),
    };
    if (filters.employeeId) {
      return { ...base, profile: await this.buildProfile(filters, period) };
    }
    return { ...base, roster: await this.buildRoster(filters, period) };
  }

  // ─── Roster ──────────────────────────────────────────────────────────────────

  private async buildRoster(
    filters: AnalyticsFiltersDto,
    period: ReturnType<typeof resolvePeriod>,
  ) {
    const { start, end } = period;
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoin(
        'login_events',
        'e',
        'e."userId" = u.id AND e."createdAt" >= :start AND e."createdAt" < :end',
        { start, end },
      )
      .leftJoin('u.immediateSupervisor', 's')
      .select('u.id', 'userId')
      .addSelect('u.firstName', 'firstName')
      .addSelect('u.lastName', 'lastName')
      .addSelect('u.department', 'department')
      .addSelect('s.firstName', 'managerFirstName')
      .addSelect('s.lastName', 'managerLastName')
      .addSelect('COUNT(e.id)', 'sessions')
      .addSelect('COALESCE(SUM(e."durationSeconds"), 0)', 'seconds')
      .addSelect('MAX(e."createdAt")', 'lastActive')
      .where('u.isActive = true')
      .groupBy('u.id')
      .addGroupBy('s.id');
    applyUserFilters(qb, 'u', filters);
    const rows = await qb.getRawMany<{
      userId: string;
      firstName: string;
      lastName: string;
      department: string | null;
      managerFirstName: string | null;
      managerLastName: string | null;
      sessions: string;
      seconds: string;
      lastActive: Date | null;
    }>();

    // Request counts per employee in the same period.
    const reqQb = this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r."employeeId"', 'employeeId')
      .addSelect('COUNT(*)', 'count')
      .where('r.createdAt >= :start AND r.createdAt < :end', { start, end })
      .groupBy('r."employeeId"');
    const reqRows = await reqQb.getRawMany<{
      employeeId: string;
      count: string;
    }>();
    const reqBy = new Map(reqRows.map((r) => [r.employeeId, Number(r.count)]));

    const roster = rows
      .map((r) => ({
        userId: r.userId,
        name: `${r.firstName} ${r.lastName}`.trim(),
        department: r.department,
        managerName: r.managerFirstName
          ? `${r.managerFirstName} ${r.managerLastName ?? ''}`.trim()
          : null,
        sessions: Number(r.sessions),
        usageHours: round1(Number(r.seconds) / 3600),
        requests: reqBy.get(r.userId) ?? 0,
        lastActive: r.lastActive,
      }))
      .sort((a, b) => b.sessions - a.sessions);

    // Engagement terciles over employees with any activity; zero = low.
    const activeCounts = roster
      .filter((r) => r.sessions > 0)
      .map((r) => r.sessions);
    const tercile = (q: number) =>
      activeCounts.length > 0
        ? activeCounts[
            Math.min(
              activeCounts.length - 1,
              Math.floor((activeCounts.length - 1) * q),
            )
          ]
        : 0;
    const hi = tercile(1 / 3); // counts are sorted desc already via roster order
    const mid = tercile(2 / 3);
    return roster.map((r) => ({
      ...r,
      engagement:
        r.sessions === 0
          ? 'low'
          : r.sessions >= hi
            ? 'high'
            : r.sessions >= mid
              ? 'medium'
              : 'low',
    }));
  }

  // ─── Single-employee profile ─────────────────────────────────────────────────

  private async buildProfile(
    filters: AnalyticsFiltersDto,
    period: ReturnType<typeof resolvePeriod>,
  ) {
    const { start, end, year } = period;
    const employeeId = filters.employeeId as string;

    const user = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.immediateSupervisor', 's')
      .where('u.id = :employeeId', { employeeId })
      .getOne();
    if (!user) throw new NotFoundException('Employee not found');

    const yearRange = resolvePeriod({ ...filters, year, month: undefined });

    const [
      activity,
      monthly,
      balance,
      requestAgg,
      favorite,
      completedSessions,
    ] = await Promise.all([
      this.loginEventRepo
        .createQueryBuilder('e')
        .select('COUNT(*)', 'sessions')
        .addSelect('COALESCE(SUM(e."durationSeconds"), 0)', 'seconds')
        .addSelect(
          `COUNT(DISTINCT (e."createdAt" AT TIME ZONE '${REPORTING_TZ}')::date)`,
          'loginDays',
        )
        .addSelect('MAX(e."createdAt")', 'lastActive')
        .where('e."userId" = :employeeId', { employeeId })
        .andWhere('e.createdAt >= :start AND e.createdAt < :end', {
          start,
          end,
        })
        .getRawOne<{
          sessions: string;
          seconds: string;
          loginDays: string;
          lastActive: Date | null;
        }>(),
      this.loginEventRepo
        .createQueryBuilder('e')
        .select(monthKeyExpr('e', 'createdAt'), 'month')
        .addSelect('COUNT(*)', 'sessions')
        .addSelect('COALESCE(SUM(e."durationSeconds"), 0)', 'seconds')
        .where('e."userId" = :employeeId', { employeeId })
        .andWhere('e.createdAt >= :start AND e.createdAt < :end', {
          start: yearRange.start,
          end: yearRange.end,
        })
        .groupBy('month')
        .getRawMany<{ month: string; sessions: string; seconds: string }>(),
      this.tokenBalanceRepo
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.allocated + b."boostTokens"), 0)', 'allocated')
        .addSelect('COALESCE(SUM(b.used), 0)', 'used')
        .where('b."userId" = :employeeId AND b.year = :year', {
          employeeId,
          year,
        })
        .getRawOne<{ allocated: string; used: string }>(),
      this.tokenRequestRepo
        .createQueryBuilder('r')
        .select('COUNT(*)', 'submitted')
        .addSelect(
          'COALESCE(SUM(CASE WHEN r.status = :approved THEN 1 ELSE 0 END), 0)',
          'approved',
        )
        .where('r."employeeId" = :employeeId', { employeeId })
        .andWhere('r.createdAt >= :start AND r.createdAt < :end', {
          start,
          end,
        })
        .setParameter('approved', RequestStatus.APPROVED)
        .getRawOne<{ submitted: string; approved: string }>(),
      this.tokenRequestRepo
        .createQueryBuilder('r')
        .select('r.type', 'type')
        .addSelect('COUNT(*)', 'count')
        .where('r."employeeId" = :employeeId', { employeeId })
        .andWhere('r.createdAt >= :start AND r.createdAt < :end', {
          start,
          end,
        })
        .groupBy('r.type')
        .orderBy('count', 'DESC')
        .limit(1)
        .getRawOne<{ type: DevelopmentOptionType; count: string }>(),
      this.coachingSessionRepo
        .createQueryBuilder('cs')
        .where('cs."employeeId" = :employeeId', { employeeId })
        .andWhere('cs.status = :completed', {
          completed: CoachingSessionStatus.COMPLETED,
        })
        .andWhere('cs."completedAt" >= :start AND cs."completedAt" < :end', {
          start,
          end,
        })
        .getCount(),
    ]);

    const sessions = Number(activity?.sessions ?? 0);
    const seconds = Number(activity?.seconds ?? 0);
    const used = Number(balance?.used ?? 0);
    const allocated = Number(balance?.allocated ?? 0);
    const byMonth = new Map(monthly.map((m) => [m.month, m]));

    return {
      userId: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      department: user.department,
      managerName: user.immediateSupervisor
        ? `${user.immediateSupervisor.firstName} ${user.immediateSupervisor.lastName}`.trim()
        : null,
      totalSessions: sessions,
      totalLoginDays: Number(activity?.loginDays ?? 0),
      totalUsageHours: round1(seconds / 3600),
      avgSessionDurationMinutes:
        sessions > 0 ? Math.round(seconds / sessions / 60) : 0,
      tokensUsed: used,
      tokensRemaining: Math.max(0, allocated - used),
      requestsSubmitted: Number(requestAgg?.submitted ?? 0),
      approvedRequests: Number(requestAgg?.approved ?? 0),
      completedRequests: completedSessions,
      favoriteDevOption: favorite
        ? { name: OPTION_LABELS[favorite.type], count: Number(favorite.count) }
        : null,
      lastActive: activity?.lastActive ?? null,
      monthlyActivity: monthBuckets(year).map(({ month, label }) => ({
        month,
        label,
        sessions: Number(byMonth.get(month)?.sessions ?? 0),
        hours: round1(Number(byMonth.get(month)?.seconds ?? 0) / 3600),
      })),
    };
  }
}
