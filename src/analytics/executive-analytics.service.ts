import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenBalance } from '../entities/token-balance.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { LoginEvent } from '../entities/login-event.entity';
import { RequestStatus } from '../common/enums';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';
import {
  AnalyticsPeriod,
  applyRequestFilters,
  applyUserFilters,
  dayBuckets,
  dayKeyExpr,
  monthBuckets,
  monthKeyExpr,
  pct,
  REPORTING_TZ,
  resolvePeriod,
  round1,
} from './analytics-query.util';

/** Trailing days shown by the daily series when no month filter is applied. */
const DAILY_WINDOW_DAYS = 30;

export interface KpiBlock {
  totalActiveUsers: number;
  totalEmployees: number;
  adoptionRate: number;
  mau: number;
  totalSessions: number;
  avgSessionsPerUser: number;
  totalUsageHours: number;
  developmentRequests: number;
  tokensUsed: number;
  newUsers: number;
  returningUsers: number;
}

/**
 * Powers the Executive Overview analytics tab. Every figure respects the
 * shared filters; "sessions" are login_events rows and usage hours come from
 * the heartbeat-accumulated durationSeconds.
 */
@Injectable()
export class ExecutiveAnalyticsService {
  constructor(
    @InjectRepository(TokenBalance)
    private readonly tokenBalanceRepo: Repository<TokenBalance>,
    @InjectRepository(TokenRequest)
    private readonly tokenRequestRepo: Repository<TokenRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(LoginEvent)
    private readonly loginEventRepo: Repository<LoginEvent>,
  ) {}

  async getExecutive(filters: AnalyticsFiltersDto) {
    const period = resolvePeriod(filters);

    const [
      kpis,
      previous,
      tokenLedger,
      engagementTrends,
      newVsReturning,
      newVsReturningDaily,
      approvalCycle,
    ] = await Promise.all([
      this.buildKpis(period.start, period.end, filters),
      this.buildKpis(period.prevStart, period.prevEnd, filters),
      this.buildTokenLedger(period.year, filters),
      this.buildEngagementSeries(period.year, filters),
      this.buildNewVsReturningSeries(period.year, filters),
      this.buildNewVsReturningDailySeries(period, filters),
      this.buildApprovalCycle(period.start, period.end, filters),
    ]);

    return {
      year: period.year,
      month: period.month,
      generatedAt: new Date().toISOString(),
      kpis,
      previous,
      tokenLedger,
      engagementTrends,
      newVsReturning,
      newVsReturningDaily,
      approvalCycle,
    };
  }

  // ─── Approval cycle time ─────────────────────────────────────────────────────
  // How long requests wait at each approval stage. Decided requests are scoped
  // to the filter period (by submission date); the pending-aging buckets are a
  // live snapshot of everything still in the pipeline right now.

  private async buildApprovalCycle(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ) {
    const decidedQb = this.tokenRequestRepo
      .createQueryBuilder('r')
      .select(
        `AVG(CASE WHEN r."managerApprovedAt" IS NOT NULL
              THEN EXTRACT(EPOCH FROM (r."managerApprovedAt" - r."createdAt")) END)`,
        'toManagerSec',
      )
      .addSelect(
        `AVG(CASE WHEN r."hrApprovedAt" IS NOT NULL AND r."managerApprovedAt" IS NOT NULL
              THEN EXTRACT(EPOCH FROM (r."hrApprovedAt" - r."managerApprovedAt")) END)`,
        'managerToHrSec',
      )
      .addSelect(
        // Total submission → final approval. hrApprovedAt is null for options
        // finalized at first level, where managerApprovedAt IS the final stamp.
        `AVG(CASE WHEN r.status = :approvedStatus
              THEN EXTRACT(EPOCH FROM (COALESCE(r."hrApprovedAt", r."managerApprovedAt") - r."createdAt")) END)`,
        'totalSec',
      )
      .addSelect(`COUNT(CASE WHEN r.status = :approvedStatus THEN 1 END)`, 'approvedCount')
      .where('r.createdAt >= :start AND r.createdAt < :end', { start, end })
      .setParameter('approvedStatus', RequestStatus.APPROVED);
    applyRequestFilters(decidedQb, 'r', filters);
    const decided = await decidedQb.getRawOne<{
      toManagerSec: string | null;
      managerToHrSec: string | null;
      totalSec: string | null;
      approvedCount: string;
    }>();

    // Live snapshot: everything currently waiting on someone, bucketed by age
    // of the current stage (pending → since submission; manager_approved →
    // since manager approval). Raw SQL — the stage-conditional age doesn't
    // express cleanly through the query builder.
    const agingRows: { fresh: string; overSla: string; critical: string }[] =
      await this.tokenRequestRepo.query(
        `SELECT
           SUM(CASE WHEN days <  3 THEN 1 ELSE 0 END) AS "fresh",
           SUM(CASE WHEN days >= 3 AND days < 7 THEN 1 ELSE 0 END) AS "overSla",
           SUM(CASE WHEN days >= 7 THEN 1 ELSE 0 END) AS "critical"
         FROM (
           SELECT EXTRACT(EPOCH FROM (NOW() - CASE
             WHEN r.status = 'manager_approved' THEN COALESCE(r."managerApprovedAt", r."createdAt")
             ELSE r."createdAt" END)) / 86400 AS days
           FROM token_requests r
           WHERE r.status IN ('pending', 'manager_approved')
         ) t`,
      );
    const aging = agingRows[0];

    const toHours = (sec: string | null | undefined) =>
      sec == null ? null : round1(Number(sec) / 3600);

    return {
      avgHoursToManagerApproval: toHours(decided?.toManagerSec),
      avgHoursManagerToHr: toHours(decided?.managerToHrSec),
      avgHoursToFinalApproval: toHours(decided?.totalSec),
      approvedCount: Number(decided?.approvedCount ?? 0),
      pendingAging: {
        withinSla: Number(aging?.fresh ?? 0),
        overSla: Number(aging?.overSla ?? 0),
        critical: Number(aging?.critical ?? 0),
      },
    };
  }

  // ─── KPI grid ────────────────────────────────────────────────────────────────

  private async buildKpis(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ): Promise<KpiBlock> {
    const [activity, totalEmployees, monthlyMau, newUsers, requests] =
      await Promise.all([
        this.activityAggregate(start, end, filters),
        this.employeeCount(filters),
        this.avgMonthlyActiveUsers(start, end, filters),
        this.firstLoginCount(start, end, filters),
        this.requestAggregate(start, end, filters),
      ]);

    const { sessions, activeUsers, seconds } = activity;
    return {
      totalActiveUsers: activeUsers,
      totalEmployees,
      adoptionRate: pct(activeUsers, totalEmployees),
      mau: monthlyMau,
      totalSessions: sessions,
      avgSessionsPerUser: activeUsers > 0 ? round1(sessions / activeUsers) : 0,
      totalUsageHours: round1(seconds / 3600),
      developmentRequests: requests.count,
      tokensUsed: requests.tokens,
      newUsers,
      returningUsers: Math.max(0, activeUsers - newUsers),
    };
  }

  /** Sessions, distinct active users, and accumulated seconds in [start, end). */
  private async activityAggregate(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ) {
    const qb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select('COUNT(*)', 'sessions')
      .addSelect('COUNT(DISTINCT e."userId")', 'activeUsers')
      .addSelect('COALESCE(SUM(e."durationSeconds"), 0)', 'seconds')
      .where('u.isActive = true')
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start, end });
    applyUserFilters(qb, 'u', filters);
    const row = await qb.getRawOne<{
      sessions: string;
      activeUsers: string;
      seconds: string;
    }>();
    return {
      sessions: Number(row?.sessions ?? 0),
      activeUsers: Number(row?.activeUsers ?? 0),
      seconds: Number(row?.seconds ?? 0),
    };
  }

  private async employeeCount(filters: AnalyticsFiltersDto): Promise<number> {
    const qb = this.userRepo.createQueryBuilder('u').where('u.isActive = true');
    applyUserFilters(qb, 'u', filters);
    return qb.getCount();
  }

  /** Average distinct login users per calendar month of [start, end). */
  private async avgMonthlyActiveUsers(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ): Promise<number> {
    const qb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select(monthKeyExpr('e', 'createdAt'), 'month')
      .addSelect('COUNT(DISTINCT e."userId")', 'mau')
      .where('u.isActive = true')
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start, end })
      .groupBy('month');
    applyUserFilters(qb, 'u', filters);
    const rows = await qb.getRawMany<{ month: string; mau: string }>();
    if (rows.length === 0) return 0;
    const total = rows.reduce((sum, r) => sum + Number(r.mau), 0);
    return Math.round(total / rows.length);
  }

  /** Users whose first-ever login falls inside [start, end). */
  private async firstLoginCount(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ): Promise<number> {
    const qb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select('e."userId"')
      .where('u.isActive = true')
      .groupBy('e."userId"')
      .having('MIN(e."createdAt") >= :start AND MIN(e."createdAt") < :end', {
        start,
        end,
      });
    applyUserFilters(qb, 'u', filters);
    const rows = await qb.getRawMany();
    return rows.length;
  }

  /** Request count (all statuses) + approved token spend in [start, end). */
  private async requestAggregate(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ) {
    const qb = this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('COUNT(*)', 'count')
      .addSelect(
        `COALESCE(SUM(CASE WHEN r.status = :approved THEN r."tokenCost" ELSE 0 END), 0)`,
        'tokens',
      )
      .where('r.createdAt >= :start AND r.createdAt < :end', { start, end })
      .setParameter('approved', RequestStatus.APPROVED);
    applyRequestFilters(qb, 'r', filters);
    const row = await qb.getRawOne<{ count: string; tokens: string }>();
    return { count: Number(row?.count ?? 0), tokens: Number(row?.tokens ?? 0) };
  }

  // ─── Token Ledger banner ─────────────────────────────────────────────────────
  // Balances are annual, so the ledger is always year-scoped regardless of the
  // month filter; entity filters apply via the balance owner.

  private async buildTokenLedger(year: number, filters: AnalyticsFiltersDto) {
    const qb = this.tokenBalanceRepo
      .createQueryBuilder('b')
      .innerJoin('users', 'u', 'u.id = b."userId"')
      .select('COALESCE(SUM(b.allocated + b."boostTokens"), 0)', 'allocated')
      .addSelect('COALESCE(SUM(b.used), 0)', 'used')
      .where('b.year = :year', { year });
    applyUserFilters(qb, 'u', filters);
    const row = await qb.getRawOne<{ allocated: string; used: string }>();
    const allocated = Number(row?.allocated ?? 0);
    const used = Number(row?.used ?? 0);
    return { used, allocated, burnRatePct: pct(used, allocated) };
  }

  // ─── Monthly series (always the full year, zero-filled) ──────────────────────

  private async buildEngagementSeries(
    year: number,
    filters: AnalyticsFiltersDto,
  ) {
    const { start, end } = resolvePeriod({
      ...filters,
      year,
      month: undefined,
    });
    const qb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select(monthKeyExpr('e', 'createdAt'), 'month')
      .addSelect('COUNT(DISTINCT e."userId")', 'mau')
      .addSelect('COUNT(*)', 'sessions')
      .where('u.isActive = true')
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start, end })
      .groupBy('month');
    applyUserFilters(qb, 'u', filters);
    const rows = await qb.getRawMany<{
      month: string;
      mau: string;
      sessions: string;
    }>();
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    return monthBuckets(year).map(({ month, label }) => ({
      month,
      label,
      mau: Number(byMonth.get(month)?.mau ?? 0),
      sessions: Number(byMonth.get(month)?.sessions ?? 0),
    }));
  }

  private async buildNewVsReturningSeries(
    year: number,
    filters: AnalyticsFiltersDto,
  ) {
    const [engagement, firstLogins] = await Promise.all([
      this.buildEngagementSeries(year, filters),
      this.firstLoginsByMonth(filters),
    ]);
    return engagement.map(({ month, label, mau }) => {
      const newUsers = firstLogins.get(month) ?? 0;
      return {
        month,
        label,
        newUsers,
        returningUsers: Math.max(0, mau - newUsers),
      };
    });
  }

  // ─── Daily new vs returning ──────────────────────────────────────────────────
  // The monthly series hides short campaigns: a reminder blast that brings 15
  // people back on one day is a single bar averaged across 30. This is the
  // day-resolution view of the same question.

  /**
   * Window for the daily series: the selected month when one is set, otherwise
   * the trailing DAILY_WINDOW_DAYS of the period. A full year at day
   * resolution is 365 points — too dense to read, and not what this view is for.
   */
  private resolveDailyWindow(period: AnalyticsPeriod): {
    start: Date;
    end: Date;
  } {
    if (period.month) return { start: period.start, end: period.end };
    // Don't project past today when the selected year is the current one.
    const end = new Date(Math.min(period.end.getTime(), Date.now()));
    const start = new Date(end.getTime() - DAILY_WINDOW_DAYS * 86_400_000);
    return {
      start: start < period.start ? period.start : start,
      end,
    };
  }

  private async buildNewVsReturningDailySeries(
    period: AnalyticsPeriod,
    filters: AnalyticsFiltersDto,
  ) {
    const { start, end } = this.resolveDailyWindow(period);

    const qb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select(dayKeyExpr('e', 'createdAt'), 'date')
      .addSelect('COUNT(DISTINCT e."userId")', 'activeUsers')
      .addSelect('COUNT(*)', 'sessions')
      .where('u.isActive = true')
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start, end })
      .groupBy('date');
    applyUserFilters(qb, 'u', filters);

    const [rows, firstLogins] = await Promise.all([
      qb.getRawMany<{ date: string; activeUsers: string; sessions: string }>(),
      this.firstLoginsByDay(filters),
    ]);

    const byDay = new Map(rows.map((r) => [r.date, r]));
    return dayBuckets(start, end).map(({ date, label }) => {
      const activeUsers = Number(byDay.get(date)?.activeUsers ?? 0);
      // A first-ever login is counted new on its own day, so anyone else
      // active that day had logged in before.
      const newUsers = firstLogins.get(date) ?? 0;
      return {
        date,
        label,
        newUsers,
        returningUsers: Math.max(0, activeUsers - newUsers),
        sessions: Number(byDay.get(date)?.sessions ?? 0),
      };
    });
  }

  /** Count of users whose first-ever login fell on each `YYYY-MM-DD`. */
  private async firstLoginsByDay(
    filters: AnalyticsFiltersDto,
  ): Promise<Map<string, number>> {
    const inner = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select('e."userId"', 'userId')
      .addSelect('MIN(e."createdAt")', 'first')
      .where('u.isActive = true')
      .groupBy('e."userId"');
    applyUserFilters(inner, 'u', filters);
    const rows = await this.loginEventRepo.manager
      .createQueryBuilder()
      .select(
        `to_char(f."first" AT TIME ZONE '${REPORTING_TZ}', 'YYYY-MM-DD')`,
        'date',
      )
      .addSelect('COUNT(*)', 'count')
      .from(`(${inner.getQuery()})`, 'f')
      .setParameters(inner.getParameters())
      .groupBy('date')
      .getRawMany<{ date: string; count: string }>();
    return new Map(rows.map((r) => [r.date, Number(r.count)]));
  }

  /** First-ever-login counts bucketed by month ('YYYY-MM' → count). */
  private async firstLoginsByMonth(
    filters: AnalyticsFiltersDto,
  ): Promise<Map<string, number>> {
    const inner = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select('e."userId"', 'userId')
      .addSelect('MIN(e."createdAt")', 'first')
      .where('u.isActive = true')
      .groupBy('e."userId"');
    applyUserFilters(inner, 'u', filters);
    const rows = await this.loginEventRepo.manager
      .createQueryBuilder()
      .select(
        `to_char(f."first" AT TIME ZONE '${REPORTING_TZ}', 'YYYY-MM')`,
        'month',
      )
      .addSelect('COUNT(*)', 'count')
      .from(`(${inner.getQuery()})`, 'f')
      .setParameters(inner.getParameters())
      .groupBy('month')
      .getRawMany<{ month: string; count: string }>();
    return new Map(rows.map((r) => [r.month, Number(r.count)]));
  }
}
