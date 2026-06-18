import { Injectable } from '@nestjs/common';
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

/** Display names for each development option type, used by the breakdown sections. */
const OPTION_LABELS: Record<DevelopmentOptionType, string> = {
  [DevelopmentOptionType.TASK_OFFLOADING]: 'Task Offloading',
  [DevelopmentOptionType.COACHING]: 'Internal Coaching',
  [DevelopmentOptionType.LEARNING_SUBSIDY]: 'Learning Subsidy',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Round to one decimal place. */
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Percentage of `part` out of `total`, one decimal, 0 when total is 0. */
const pct = (part: number, total: number): number =>
  total > 0 ? round1((part / total) * 100) : 0;

@Injectable()
export class AnalyticsService {
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

  /**
   * Aggregates powering the admin "Development Token" analytics dashboard.
   * All token figures count APPROVED requests (i.e. tokens actually spent).
   */
  async getDevelopmentTokenAnalytics(year = new Date().getFullYear()) {
    const [summary, requestStatus, byDevelopmentOption, byDepartment, engagement] =
      await Promise.all([
        this.buildSummary(year),
        this.buildRequestStatus(year),
        this.buildByDevelopmentOption(year),
        this.buildByDepartment(year),
        this.buildEngagement(),
      ]);

    return {
      year,
      generatedAt: new Date().toISOString(),
      summary,
      requestStatus,
      byDevelopmentOption: byDevelopmentOption.rows,
      totalOptionTokens: byDevelopmentOption.total,
      byDepartment: byDepartment.rows,
      totalDepartmentTokens: byDepartment.total,
      engagement,
    };
  }

  // ─── Stat cards ─────────────────────────────────────────────────────────────

  private async buildSummary(year: number) {
    const balanceAgg = await this.tokenBalanceRepo
      .createQueryBuilder('b')
      .select('COALESCE(SUM(b.allocated + b.boostTokens), 0)', 'issued')
      .addSelect('COALESCE(SUM(b.used), 0)', 'used')
      .where('b.year = :year', { year })
      .getRawOne<{ issued: string; used: string }>();

    const subsidyAgg = await this.tokenRequestRepo
      .createQueryBuilder('r')
      .select(`COALESCE(SUM((r."formData"->>'subsidyAmount')::numeric), 0)`, 'total')
      .where('r.type = :type', { type: DevelopmentOptionType.LEARNING_SUBSIDY })
      .andWhere('r.status = :status', { status: RequestStatus.APPROVED })
      .andWhere('r.year = :year', { year })
      .getRawOne<{ total: string }>();

    const totalIssued = Number(balanceAgg?.issued ?? 0);
    const totalUsed = Number(balanceAgg?.used ?? 0);
    const totalSubsidized = Number(subsidyAgg?.total ?? 0);

    return {
      totalIssued,
      totalUsed,
      remaining: totalIssued - totalUsed,
      utilizationRate: pct(totalUsed, totalIssued),
      totalSubsidized,
      expiringOn: `${year}-12-31`,
    };
  }

  // ─── Request Status Overview ─────────────────────────────────────────────────
  // The 5 dashboard cards don't map 1:1 to RequestStatus, so we bucket:
  //   submitted  ← pending           inProgress ← manager_approved
  //   approved   ← approved          rejected   ← rejected + cancelled
  //   completed  ← coaching sessions marked completed (the only "done" signal we track)

  private async buildRequestStatus(year: number) {
    const rows = await this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('r.year = :year', { year })
      .groupBy('r.status')
      .getRawMany<{ status: RequestStatus; count: string }>();

    const counts = new Map(rows.map((r) => [r.status, Number(r.count)]));

    const completed = await this.coachingSessionRepo
      .createQueryBuilder('s')
      .innerJoin('s.tokenRequest', 'tr')
      .where('s.status = :status', { status: CoachingSessionStatus.COMPLETED })
      .andWhere('tr.year = :year', { year })
      .getCount();

    return {
      submitted: counts.get(RequestStatus.PENDING) ?? 0,
      inProgress: counts.get(RequestStatus.MANAGER_APPROVED) ?? 0,
      approved: counts.get(RequestStatus.APPROVED) ?? 0,
      completed,
      rejected:
        (counts.get(RequestStatus.REJECTED) ?? 0) +
        (counts.get(RequestStatus.CANCELLED) ?? 0),
    };
  }

  // ─── By Development Option (donut) ────────────────────────────────────────────

  private async buildByDevelopmentOption(year: number) {
    const rows = await this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r.type', 'type')
      .addSelect('COALESCE(SUM(r.tokenCost), 0)', 'tokens')
      .where('r.status = :status', { status: RequestStatus.APPROVED })
      .andWhere('r.year = :year', { year })
      .groupBy('r.type')
      .getRawMany<{ type: DevelopmentOptionType; tokens: string }>();

    const tokensByType = new Map(rows.map((r) => [r.type, Number(r.tokens)]));
    const total = [...tokensByType.values()].reduce((sum, t) => sum + t, 0);

    // Emit every option type in a stable order so the chart legend is consistent.
    const result = Object.values(DevelopmentOptionType).map((type) => {
      const tokens = tokensByType.get(type) ?? 0;
      return { type, name: OPTION_LABELS[type], tokens, pct: pct(tokens, total) };
    });

    return { rows: result, total };
  }

  // ─── By Department ─────────────────────────────────────────────────────────────

  private async buildByDepartment(year: number) {
    const rows = await this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r.snapshotDepartment', 'department')
      .addSelect('COALESCE(SUM(r.tokenCost), 0)', 'tokens')
      .where('r.status = :status', { status: RequestStatus.APPROVED })
      .andWhere('r.year = :year', { year })
      .andWhere('r.snapshotDepartment IS NOT NULL')
      .groupBy('r.snapshotDepartment')
      .orderBy('tokens', 'DESC')
      .getRawMany<{ department: string; tokens: string }>();

    const parsed = rows.map((r) => ({
      department: r.department,
      tokens: Number(r.tokens),
    }));
    const total = parsed.reduce((sum, r) => sum + r.tokens, 0);

    return {
      rows: parsed.map((r) => ({ ...r, pct: pct(r.tokens, total) })),
      total,
    };
  }

  // ─── User Activity and Engagement ──────────────────────────────────────────────

  private async buildEngagement() {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS);
    const since15d = new Date(now - 15 * DAY_MS);
    const since30d = new Date(now - 30 * DAY_MS);

    const totalActiveUsers = await this.userRepo.count({
      where: { isActive: true },
    });

    const dailyActiveRow = await this.loginEventRepo
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.userId)', 'count')
      .where('e.createdAt >= :since', { since: since24h })
      .getRawOne<{ count: string }>();

    // Logins per user over the last 30 days → average sessions + returning rate.
    const logins30d = await this.loginEventRepo
      .createQueryBuilder('e')
      .select('e.userId', 'userId')
      .addSelect('COUNT(*)', 'cnt')
      .where('e.createdAt >= :since', { since: since30d })
      .groupBy('e.userId')
      .getRawMany<{ userId: string; cnt: string }>();

    const distinctUsers30d = logins30d.length;
    const totalLogins30d = logins30d.reduce((sum, r) => sum + Number(r.cnt), 0);
    const returningUsers30d = logins30d.filter((r) => Number(r.cnt) > 1).length;

    const firstTimeUsers30d = await this.userRepo
      .createQueryBuilder('u')
      .where('u.createdAt >= :since', { since: since30d })
      .getCount();

    const nonActive15d = await this.userRepo
      .createQueryBuilder('u')
      .where('u.isActive = true')
      .andWhere('(u.lastLoginAt IS NULL OR u.lastLoginAt < :since)', {
        since: since15d,
      })
      .getCount();

    // No per-feature instrumentation yet — approximate "most-used feature" with
    // the development option that has the most approved requests this year.
    const topOption = await this.tokenRequestRepo
      .createQueryBuilder('r')
      .select('r.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('r.status = :status', { status: RequestStatus.APPROVED })
      .groupBy('r.type')
      .orderBy('count', 'DESC')
      .limit(1)
      .getRawOne<{ type: DevelopmentOptionType; count: string }>();

    return {
      totalActiveUsers,
      dailyActive: Number(dailyActiveRow?.count ?? 0),
      avgSessions:
        distinctUsers30d > 0 ? round1(totalLogins30d / distinctUsers30d) : 0,
      returningUsersPct: pct(returningUsers30d, distinctUsers30d),
      firstTimeUsers30d,
      nonActive15d,
      mostUsedFeature: topOption ? OPTION_LABELS[topOption.type] : null,
    };
  }
}
