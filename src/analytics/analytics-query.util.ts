import { SelectQueryBuilder } from 'typeorm';
import { DevelopmentOptionType } from '../common/enums';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';

/** Display names for each development option type. */
export const OPTION_LABELS: Record<DevelopmentOptionType, string> = {
  [DevelopmentOptionType.TASK_OFFLOADING]: 'Task Offloading',
  [DevelopmentOptionType.COACHING]: 'Internal Coaching',
  [DevelopmentOptionType.LEARNING_SUBSIDY]: 'Learning Subsidy',
};

/** Round to one decimal place. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Percentage of `part` out of `total`, one decimal, 0 when total is 0. */
export const pct = (part: number, total: number): number =>
  total > 0 ? round1((part / total) * 100) : 0;

/**
 * Reporting timezone for calendar bucketing. Login events are stored in UTC;
 * without an explicit zone, evening activity shifts into the wrong day/month.
 * Restricted to IANA-name characters so it can be inlined into SQL safely.
 */
const rawTz = process.env.ANALYTICS_TIMEZONE ?? 'Asia/Manila';
export const REPORTING_TZ = /^[A-Za-z0-9_+\-/]+$/.test(rawTz)
  ? rawTz
  : 'Asia/Manila';

/** Offset (ms) of `tz` relative to UTC at the given instant. */
const tzOffsetMs = (tz: string, utcDate: Date): number => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(utcDate).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcDate.getTime();
};

/** UTC instant of local midnight `y-m-d` in the reporting timezone. */
const zonedMidnightUtc = (y: number, m: number, d: number): Date => {
  const guess = new Date(Date.UTC(y, m - 1, d));
  return new Date(guess.getTime() - tzOffsetMs(REPORTING_TZ, guess));
};

export const currentYearInTz = (): number =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: REPORTING_TZ,
      year: 'numeric',
    }).format(new Date()),
  );

export interface AnalyticsPeriod {
  year: number;
  month: number | null;
  /** Selected period, [start, end). Month if set, else the whole year. */
  start: Date;
  end: Date;
  /** The comparison period: previous month (Jan wraps) or previous year. */
  prevStart: Date;
  prevEnd: Date;
}

export const resolvePeriod = (
  filters: AnalyticsFiltersDto,
): AnalyticsPeriod => {
  const year = filters.year ?? currentYearInTz();
  const month = filters.month ?? null;
  if (month) {
    const start = zonedMidnightUtc(year, month, 1);
    const end =
      month === 12
        ? zonedMidnightUtc(year + 1, 1, 1)
        : zonedMidnightUtc(year, month + 1, 1);
    const prevStart =
      month === 1
        ? zonedMidnightUtc(year - 1, 12, 1)
        : zonedMidnightUtc(year, month - 1, 1);
    return { year, month, start, end, prevStart, prevEnd: start };
  }
  const start = zonedMidnightUtc(year, 1, 1);
  return {
    year,
    month,
    start,
    end: zonedMidnightUtc(year + 1, 1, 1),
    prevStart: zonedMidnightUtc(year - 1, 1, 1),
    prevEnd: start,
  };
};

/** SQL expression for the `YYYY-MM` bucket of a timestamptz column. */
export const monthKeyExpr = (alias: string, column: string): string =>
  `to_char(${alias}."${column}" AT TIME ZONE '${REPORTING_TZ}', 'YYYY-MM')`;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** The 12 `{ month: 'YYYY-MM', label: "Jan '26" }` buckets of a year. */
export const monthBuckets = (
  year: number,
): { month: string; label: string }[] =>
  MONTH_NAMES.map((name, i) => ({
    month: `${year}-${String(i + 1).padStart(2, '0')}`,
    label: `${name} '${String(year).slice(2)}`,
  }));

/**
 * Entity filters for queries joined to `users` (alias = the users alias).
 * Department/manager come from the live org chart.
 */
export const applyUserFilters = (
  qb: SelectQueryBuilder<object>,
  alias: string,
  filters: AnalyticsFiltersDto,
): void => {
  if (filters.department) {
    qb.andWhere(`${alias}.department = :fDepartment`, {
      fDepartment: filters.department,
    });
  }
  if (filters.managerId) {
    qb.andWhere(`${alias}."immediateSupervisorId" = :fManagerId`, {
      fManagerId: filters.managerId,
    });
  }
  if (filters.employeeId) {
    qb.andWhere(`${alias}.id = :fEmployeeId`, {
      fEmployeeId: filters.employeeId,
    });
  }
};

/**
 * Entity filters for `token_requests` queries (alias = the request alias).
 * Uses the submission-time snapshots so historical rows stay attributed to
 * the department/manager they were filed under.
 */
export const applyRequestFilters = (
  qb: SelectQueryBuilder<object>,
  alias: string,
  filters: AnalyticsFiltersDto,
): void => {
  if (filters.department) {
    qb.andWhere(`${alias}."snapshotDepartment" = :fDepartment`, {
      fDepartment: filters.department,
    });
  }
  if (filters.managerId) {
    qb.andWhere(`${alias}."managerId" = :fManagerId`, {
      fManagerId: filters.managerId,
    });
  }
  if (filters.employeeId) {
    qb.andWhere(`${alias}."employeeId" = :fEmployeeId`, {
      fEmployeeId: filters.employeeId,
    });
  }
};
