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
  applyRequestFilters,
  applyUserFilters,
  monthBuckets,
  monthKeyExpr,
  pct,
  REPORTING_TZ,
  resolvePeriod,
  round1,
} from './analytics-query.util';

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

    const [kpis, previous, tokenLedger, engagementTrends, newVsReturning] =
      await Promise.all([
        this.buildKpis(period.start, period.end, filters),
        this.buildKpis(period.prevStart, period.prevEnd, filters),
        this.buildTokenLedger(period.year, filters),
        this.buildEngagementSeries(period.year, filters),
        this.buildNewVsReturningSeries(period.year, filters),
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
