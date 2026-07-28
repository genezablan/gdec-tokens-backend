import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { LoginEvent } from '../entities/login-event.entity';
import { DevelopmentOptionType, RequestStatus } from '../common/enums';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';
import {
  applyRequestFilters,
  applyUserFilters,
  monthBuckets,
  monthKeyExpr,
  OPTION_LABELS,
  pct,
  REPORTING_TZ,
  resolvePeriod,
  round1,
} from './analytics-query.util';

/** Cap the adoption-trend legend to the largest departments. */
const TREND_SERIES_LIMIT = 6;

/**
 * Powers the Department Analytics tab. Headcount/session columns use the
 * live `users.department`; request/token columns use the submission-time
 * `snapshotDepartment` — after a transfer the two can disagree, which is the
 * same tradeoff the rest of the app makes for historical attribution.
 */
@Injectable()
export class DepartmentAnalyticsService {
  constructor(
    @InjectRepository(TokenRequest)
    private readonly tokenRequestRepo: Repository<TokenRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(LoginEvent)
    private readonly loginEventRepo: Repository<LoginEvent>,
  ) {}

  async getDepartments(filters: AnalyticsFiltersDto) {
    const period = resolvePeriod(filters);
    const [
      leaderboard,
      monthlyAdoptionTrend,
      developmentOptionRequests,
      activityLists,
      activityHeatmap,
    ] = await Promise.all([
      this.buildLeaderboard(period.start, period.end, filters),
      this.buildAdoptionTrend(period.year, filters),
      this.buildOptionRequests(period.start, period.end, filters),
      this.buildActivityLists(period.start, period.end, filters),
      this.buildHeatmap(period.start, period.end, filters),
    ]);

    return {
      year: period.year,
      month: period.month,
      generatedAt: new Date().toISOString(),
      leaderboard,
      monthlyAdoptionTrend,
      developmentOptionRequests,
      mostActiveEmployees: activityLists.most,
      leastActiveEmployees: activityLists.least,
      activityHeatmap,
    };
  }

  // ─── Adoption leaderboard table ──────────────────────────────────────────────

  private async buildLeaderboard(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ) {
    const headcountQb = this.userRepo
      .createQueryBuilder('u')
      .select('u.department', 'department')
      .addSelect('COUNT(*)', 'employees')
      .where('u.isActive = true')
      .andWhere('u.department IS NOT NULL')
      .groupBy('u.department');
    applyUserFilters(headcountQb, 'u', filters);

    const activityQb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select('u.department', 'department')
      .addSelect('COUNT(DISTINCT e."userId")', 'active')
      .addSelect('COUNT(*)', 'sessions')
      .where('u.isActive = true')
      .andWhere('u.department IS NOT NULL')
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start, end })
      .groupBy('u.department');
    applyUserFilters(activityQb, 'u', filters);

    const requestsQb = this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r."snapshotDepartment"', 'department')
      .addSelect('COUNT(*)', 'devRequests')
      .addSelect(
        `COALESCE(SUM(CASE WHEN r.status = :approved THEN r."tokenCost" ELSE 0 END), 0)`,
        'tokensRedeemed',
      )
      .where('r."snapshotDepartment" IS NOT NULL')
      .andWhere('r.createdAt >= :start AND r.createdAt < :end', { start, end })
      .setParameter('approved', RequestStatus.APPROVED)
      .groupBy('r."snapshotDepartment"');
    applyRequestFilters(requestsQb, 'r', filters);

    const topOptionQb = this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r."snapshotDepartment"', 'department')
      .addSelect('r.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('r."snapshotDepartment" IS NOT NULL')
      .andWhere('r.createdAt >= :start AND r.createdAt < :end', { start, end })
      .groupBy('r."snapshotDepartment"')
      .addGroupBy('r.type');
    applyRequestFilters(topOptionQb, 'r', filters);

    const [headcount, activity, requests, topOptions] = await Promise.all([
      headcountQb.getRawMany<{ department: string; employees: string }>(),
      activityQb.getRawMany<{
        department: string;
        active: string;
        sessions: string;
      }>(),
      requestsQb.getRawMany<{
        department: string;
        devRequests: string;
        tokensRedeemed: string;
      }>(),
      topOptionQb.getRawMany<{
        department: string;
        type: DevelopmentOptionType;
        count: string;
      }>(),
    ]);

    const activityBy = new Map(activity.map((r) => [r.department, r]));
    const requestsBy = new Map(requests.map((r) => [r.department, r]));
    const topBy = new Map<
      string,
      { type: DevelopmentOptionType; count: number }
    >();
    for (const row of topOptions) {
      const cur = topBy.get(row.department);
      if (!cur || Number(row.count) > cur.count) {
        topBy.set(row.department, { type: row.type, count: Number(row.count) });
      }
    }

    const rows = headcount.map((h) => {
      const employees = Number(h.employees);
      const active = Number(activityBy.get(h.department)?.active ?? 0);
      const sessions = Number(activityBy.get(h.department)?.sessions ?? 0);
      const req = requestsBy.get(h.department);
      const top = topBy.get(h.department);
      return {
        department: h.department,
        employees,
        active,
        inactive: Math.max(0, employees - active),
        adoptionPct: pct(active, employees),
        sessions,
        avgSessionsPerEmployee:
          employees > 0 ? round1(sessions / employees) : 0,
        devRequests: Number(req?.devRequests ?? 0),
        tokensRedeemed: Number(req?.tokensRedeemed ?? 0),
        topOption: top?.type ?? null,
        topOptionName: top ? OPTION_LABELS[top.type] : null,
      };
    });

    rows.sort(
      (a, b) => b.adoptionPct - a.adoptionPct || b.sessions - a.sessions,
    );
    return rows.map((row, i) => ({ rank: i + 1, ...row }));
  }

  // ─── Monthly adoption trend (multi-line) ─────────────────────────────────────

  private async buildAdoptionTrend(year: number, filters: AnalyticsFiltersDto) {
    const { start, end } = resolvePeriod({
      ...filters,
      year,
      month: undefined,
    });

    const headcountQb = this.userRepo
      .createQueryBuilder('u')
      .select('u.department', 'department')
      .addSelect('COUNT(*)', 'employees')
      .where('u.isActive = true')
      .andWhere('u.department IS NOT NULL')
      .groupBy('u.department');
    applyUserFilters(headcountQb, 'u', filters);

    const monthlyQb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select('u.department', 'department')
      .addSelect(monthKeyExpr('e', 'createdAt'), 'month')
      .addSelect('COUNT(DISTINCT e."userId")', 'active')
      .where('u.isActive = true')
      .andWhere('u.department IS NOT NULL')
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start, end })
      .groupBy('u.department')
      .addGroupBy('month');
    applyUserFilters(monthlyQb, 'u', filters);

    const [headcount, monthly] = await Promise.all([
      headcountQb.getRawMany<{ department: string; employees: string }>(),
      monthlyQb.getRawMany<{
        department: string;
        month: string;
        active: string;
      }>(),
    ]);

    const buckets = monthBuckets(year);
    const topDepartments = headcount
      .sort((a, b) => Number(b.employees) - Number(a.employees))
      .slice(0, TREND_SERIES_LIMIT);

    const series = topDepartments.map((h) => {
      const employees = Number(h.employees);
      const values = buckets.map(({ month }) => {
        const row = monthly.find(
          (m) => m.department === h.department && m.month === month,
        );
        return pct(Number(row?.active ?? 0), employees);
      });
      return { department: h.department, values };
    });

    return { months: buckets.map((b) => b.label), series };
  }

  // ─── Development options requested (horizontal bars) ─────────────────────────

  private async buildOptionRequests(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ) {
    const qb = this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('r.createdAt >= :start AND r.createdAt < :end', { start, end })
      .groupBy('r.type');
    applyRequestFilters(qb, 'r', filters);
    const rows = await qb.getRawMany<{
      type: DevelopmentOptionType;
      count: string;
    }>();
    const byType = new Map(rows.map((r) => [r.type, Number(r.count)]));
    return Object.values(DevelopmentOptionType).map((type) => ({
      type,
      name: OPTION_LABELS[type],
      count: byType.get(type) ?? 0,
    }));
  }

  // ─── Most / least active employees ───────────────────────────────────────────

  private async buildActivityLists(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ) {
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
      .addSelect('u.lastLoginAt', 'lastLoginAt')
      .addSelect('s.firstName', 'managerFirstName')
      .addSelect('s.lastName', 'managerLastName')
      .addSelect('COUNT(e.id)', 'sessions')
      .where('u.isActive = true')
      .groupBy('u.id')
      .addGroupBy('s.id');
    applyUserFilters(qb, 'u', filters);

    const rows = await qb.getRawMany<{
      userId: string;
      firstName: string;
      lastName: string;
      department: string | null;
      lastLoginAt: Date | null;
      managerFirstName: string | null;
      managerLastName: string | null;
      sessions: string;
    }>();

    const mapped = rows.map((r) => ({
      userId: r.userId,
      name: `${r.firstName} ${r.lastName}`.trim(),
      department: r.department,
      managerName: r.managerFirstName
        ? `${r.managerFirstName} ${r.managerLastName ?? ''}`.trim()
        : null,
      sessions: Number(r.sessions),
      lastLoginAt: r.lastLoginAt,
    }));

    const most = [...mapped]
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 5);
    const least = [...mapped]
      .sort((a, b) => a.sessions - b.sessions)
      .slice(0, 5);
    return { most, least };
  }

  // ─── Activity heatmap (weekday × hour) ───────────────────────────────────────

  private async buildHeatmap(
    start: Date,
    end: Date,
    filters: AnalyticsFiltersDto,
  ) {
    const dowExpr = `EXTRACT(ISODOW FROM e."createdAt" AT TIME ZONE '${REPORTING_TZ}')::int`;
    const hourExpr = `EXTRACT(HOUR FROM e."createdAt" AT TIME ZONE '${REPORTING_TZ}')::int`;
    const qb = this.loginEventRepo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select(dowExpr, 'dow')
      .addSelect(hourExpr, 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('u.isActive = true')
      .andWhere('e.createdAt >= :start AND e.createdAt < :end', { start, end })
      .andWhere(`${dowExpr} BETWEEN 1 AND 5`)
      .groupBy('dow')
      .addGroupBy('hour');
    applyUserFilters(qb, 'u', filters);
    const rows = await qb.getRawMany<{
      dow: number;
      hour: number;
      count: string;
    }>();

    const cells: number[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 24 }, () => 0),
    );
    let max = 0;
    for (const row of rows) {
      const value = Number(row.count);
      cells[row.dow - 1][row.hour] = value;
      if (value > max) max = value;
    }
    return {
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      hours: Array.from({ length: 24 }, (_, h) => h),
      cells,
      max,
    };
  }
}
