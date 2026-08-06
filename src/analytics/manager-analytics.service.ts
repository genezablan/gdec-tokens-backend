import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { LoginEvent } from '../entities/login-event.entity';
import { DevelopmentOptionType } from '../common/enums';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';
import {
  monthBuckets,
  monthKeyExpr,
  OPTION_LABELS,
  pct,
  resolvePeriod,
  round1,
} from './analytics-query.util';

/**
 * Powers the People Manager Analytics tab: one panel per manager with their
 * team's adoption/engagement figures. The department filter matches the
 * manager's own department; team membership comes from the live org chart
 * (users.immediateSupervisorId), request attribution from the submission-time
 * snapshot (token_requests.managerId).
 */
@Injectable()
export class ManagerAnalyticsService {
  constructor(
    @InjectRepository(TokenRequest)
    private readonly tokenRequestRepo: Repository<TokenRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(LoginEvent)
    private readonly loginEventRepo: Repository<LoginEvent>,
  ) {}

  async getManagers(filters: AnalyticsFiltersDto) {
    const period = resolvePeriod(filters);

    // ── Managers in scope ──
    const managerQb = this.userRepo
      .createQueryBuilder('m')
      .innerJoin(
        'users',
        'r',
        'r."immediateSupervisorId" = m.id AND r."isActive" = true',
      )
      .select('m.id', 'id')
      .addSelect('m.firstName', 'firstName')
      .addSelect('m.lastName', 'lastName')
      .addSelect('m.department', 'department')
      .where('m.isActive = true')
      .distinct(true)
      .orderBy('m.firstName', 'ASC');
    if (filters.managerId) {
      managerQb.andWhere('m.id = :managerId', { managerId: filters.managerId });
    }
    if (filters.department) {
      managerQb.andWhere('m.department = :department', {
        department: filters.department,
      });
    }
    const managerRows = await managerQb.getRawMany<{
      id: string;
      firstName: string;
      lastName: string;
      department: string | null;
    }>();
    const managerIds = managerRows.map((m) => m.id);
    if (managerIds.length === 0) {
      return {
        year: period.year,
        month: period.month,
        generatedAt: new Date().toISOString(),
        managers: [],
      };
    }

    // ── Team members (live org chart) ──
    const memberQb = this.userRepo
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .addSelect('u.firstName', 'firstName')
      .addSelect('u.lastName', 'lastName')
      .addSelect('u."immediateSupervisorId"', 'managerId')
      .where('u.isActive = true')
      .andWhere('u."immediateSupervisorId" IN (:...managerIds)', {
        managerIds,
      });
    if (filters.employeeId) {
      memberQb.andWhere('u.id = :employeeId', {
        employeeId: filters.employeeId,
      });
    }
    const members = await memberQb.getRawMany<{
      id: string;
      firstName: string;
      lastName: string;
      managerId: string;
    }>();
    const memberIds = members.map((u) => u.id);
    const memberById = new Map(
      members.map((u) => [
        u.id,
        { ...u, name: `${u.firstName} ${u.lastName}`.trim() },
      ]),
    );

    // ── Bulk aggregates over the members ──
    const { start, end, year } = period;
    const yearRange = resolvePeriod({ ...filters, year, month: undefined });

    const [activity, trend, requestAgg, requestByEmployee, optionCounts] =
      memberIds.length === 0
        ? [[], [], [], [], []]
        : await Promise.all([
            // sessions/seconds per member in period
            this.loginEventRepo
              .createQueryBuilder('e')
              .select('e."userId"', 'userId')
              .addSelect('COUNT(*)', 'sessions')
              .addSelect('COALESCE(SUM(e."durationSeconds"), 0)', 'seconds')
              .where('e."userId" IN (:...memberIds)', { memberIds })
              .andWhere('e.createdAt >= :start AND e.createdAt < :end', {
                start,
                end,
              })
              .groupBy('e."userId"')
              .getRawMany<{
                userId: string;
                sessions: string;
                seconds: string;
              }>(),
            // active members per (manager, month) across the year
            this.loginEventRepo
              .createQueryBuilder('e')
              .innerJoin('e.user', 'u')
              .select('u."immediateSupervisorId"', 'managerId')
              .addSelect(monthKeyExpr('e', 'createdAt'), 'month')
              .addSelect('COUNT(DISTINCT e."userId")', 'active')
              .where('e."userId" IN (:...memberIds)', { memberIds })
              .andWhere('e.createdAt >= :start AND e.createdAt < :end', {
                start: yearRange.start,
                end: yearRange.end,
              })
              .groupBy('u."immediateSupervisorId"')
              .addGroupBy('month')
              .getRawMany<{
                managerId: string;
                month: string;
                active: string;
              }>(),
            // request count per manager (snapshot attribution) in period
            this.tokenRequestRepo
              .createQueryBuilder('r')
              .select('r."managerId"', 'managerId')
              .addSelect('COUNT(*)', 'count')
              .where('r."managerId" IN (:...managerIds)', { managerIds })
              .andWhere('r.createdAt >= :start AND r.createdAt < :end', {
                start,
                end,
              })
              .groupBy('r."managerId"')
              .getRawMany<{ managerId: string; count: string }>(),
            // request count per (manager, employee) in period
            this.tokenRequestRepo
              .createQueryBuilder('r')
              .innerJoin('r.employee', 'emp')
              .select('r."managerId"', 'managerId')
              .addSelect('r."employeeId"', 'employeeId')
              .addSelect('emp.firstName', 'firstName')
              .addSelect('emp.lastName', 'lastName')
              .addSelect('COUNT(*)', 'count')
              .where('r."managerId" IN (:...managerIds)', { managerIds })
              .andWhere('r.createdAt >= :start AND r.createdAt < :end', {
                start,
                end,
              })
              .groupBy('r."managerId"')
              .addGroupBy('r."employeeId"')
              .addGroupBy('emp.firstName')
              .addGroupBy('emp.lastName')
              .getRawMany<{
                managerId: string;
                employeeId: string;
                firstName: string;
                lastName: string;
                count: string;
              }>(),
            // option demand per (manager, type) in period
            this.tokenRequestRepo
              .createQueryBuilder('r')
              .select('r."managerId"', 'managerId')
              .addSelect('r.type', 'type')
              .addSelect('COUNT(*)', 'count')
              .where('r."managerId" IN (:...managerIds)', { managerIds })
              .andWhere('r.createdAt >= :start AND r.createdAt < :end', {
                start,
                end,
              })
              .groupBy('r."managerId"')
              .addGroupBy('r.type')
              .getRawMany<{
                managerId: string;
                type: DevelopmentOptionType;
                count: string;
              }>(),
          ]);

    const activityBy = new Map(activity.map((a) => [a.userId, a]));
    const buckets = monthBuckets(year);

    const managers = managerRows.map((m) => {
      const team = members.filter((u) => u.managerId === m.id);
      const teamActivity = team.map((u) => ({
        userId: u.id,
        name: memberById.get(u.id)?.name ?? '',
        sessions: Number(activityBy.get(u.id)?.sessions ?? 0),
        seconds: Number(activityBy.get(u.id)?.seconds ?? 0),
      }));
      const sessions = teamActivity.reduce((s, u) => s + u.sessions, 0);
      const seconds = teamActivity.reduce((s, u) => s + u.seconds, 0);
      const activeMembers = teamActivity.filter((u) => u.sessions > 0).length;

      const myTrend = trend.filter((t) => t.managerId === m.id);
      const engagementTrend = buckets.map(({ month, label }) => ({
        month,
        label,
        active: Number(myTrend.find((t) => t.month === month)?.active ?? 0),
      }));

      const myOptions = optionCounts.filter((o) => o.managerId === m.id);
      const topOption = myOptions.reduce(
        (best, o) => (Number(o.count) > Number(best?.count ?? 0) ? o : best),
        null as { type: DevelopmentOptionType; count: string } | null,
      );

      return {
        managerId: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        department: m.department,
        teamSize: team.length,
        activeTeamMembers: activeMembers,
        adoptionPct: pct(activeMembers, team.length),
        totalTeamSessions: sessions,
        avgSessionsPerEmployee:
          team.length > 0 ? round1(sessions / team.length) : 0,
        avgUsageHoursPerEmployee:
          team.length > 0 ? round1(seconds / 3600 / team.length) : 0,
        avgSessionDurationMinutes:
          sessions > 0 ? Math.round(seconds / sessions / 60) : 0,
        devRequests: Number(
          requestAgg.find((r) => r.managerId === m.id)?.count ?? 0,
        ),
        mostRequestedOption: topOption ? OPTION_LABELS[topOption.type] : null,
        engagementTrend,
        devRequestsByEmployee: requestByEmployee
          .filter((r) => r.managerId === m.id)
          .map((r) => ({
            name: `${r.firstName} ${r.lastName}`.trim(),
            count: Number(r.count),
          }))
          .sort((a, b) => b.count - a.count),
        topActiveMembers: teamActivity
          .filter((u) => u.sessions > 0)
          .sort((a, b) => b.sessions - a.sessions)
          .slice(0, 5)
          .map(({ userId, name, sessions: s }) => ({
            userId,
            name,
            sessions: s,
          })),
        membersWithoutActivity: teamActivity
          .filter((u) => u.sessions === 0)
          .map(({ userId, name }) => ({ userId, name })),
      };
    });

    return {
      year: period.year,
      month: period.month,
      generatedAt: new Date().toISOString(),
      managers,
    };
  }
}
