/**
 * Business-timezone conversions.
 *
 * Coach availability, session slots and proposed times are all stored as
 * timezone-naive wall clocks (`date` + `time` columns) that mean "9am in the
 * office". Turning one into an instant with `new Date('2026-08-10T09:00')`
 * resolves it against the *server's* timezone, which is not a property of the
 * business — staging runs UTC while the company operates in Manila, so every
 * such conversion landed 8 hours out and Outlook conflict checks compared the
 * wrong window. These helpers pin the conversion to the business zone instead.
 *
 * Implemented on the built-in `Intl` timezone database rather than a fixed
 * offset, so the logic survives a business zone that observes DST (Manila
 * itself hasn't since 1978).
 */

/**
 * IANA zone the business operates in. `BUSINESS_TIME_ZONE` can override it, but
 * the default is the source of truth — the frontend hardcodes the same zone in
 * `src/utils/datetime.js` (`PH_TIME_ZONE`).
 */
export const BUSINESS_TIME_ZONE =
  process.env.BUSINESS_TIME_ZONE || 'Asia/Manila';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The offset (in ms) that `zone` is ahead of UTC at the given instant.
 *
 * `formatToParts` renders the instant as local wall-clock numbers in `zone`;
 * reading those back as if they were UTC and subtracting the original instant
 * yields the offset.
 */
function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  // `hour12: false` renders midnight as 24 in some ICU versions.
  const hour = get('hour') % 24;

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert a business-timezone wall clock to the instant it refers to.
 *
 * `date` is `YYYY-MM-DD`, `time` is `HH:MM` or `HH:MM:SS` (Postgres `time`
 * columns come back with seconds). Returns an Invalid Date for unparseable
 * input, mirroring `new Date()` so existing `Number.isNaN` guards still work.
 *
 * @example wallClockToUtc('2026-08-10', '09:00') // 2026-08-10T01:00:00.000Z
 */
export function wallClockToUtc(
  date: string,
  time: string,
  zone: string = BUSINESS_TIME_ZONE,
): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!d || !t) return new Date(NaN);

  // Provisional instant, treating the wall clock as UTC. It is wrong by exactly
  // the zone's offset, so re-resolve the offset *at that instant* and subtract.
  // The second pass handles the case where the guess lands on the other side of
  // a DST transition from the real answer.
  const naive = Date.UTC(
    Number(d[1]),
    Number(d[2]) - 1,
    Number(d[3]),
    Number(t[1]),
    Number(t[2]),
    Number(t[3] ?? 0),
  );

  let utc = naive - zoneOffsetMs(new Date(naive), zone);
  utc = naive - zoneOffsetMs(new Date(utc), zone);
  return new Date(utc);
}

/**
 * Render an instant as a business-timezone wall clock — the inverse of
 * {@link wallClockToUtc}, for building slot lists and anything user-facing.
 *
 * `weekday` is 0=Sunday..6=Saturday in the business zone, so it can replace
 * `Date.prototype.getDay()` when matching a coach's weekly availability.
 */
export function utcToWallClock(
  instant: Date,
  zone: string = BUSINESS_TIME_ZONE,
): { date: string; time: string; weekday: number } {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, zone));
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    weekday: shifted.getUTCDay(),
  };
}

/**
 * Instant for a business-timezone wall clock expressed as numbers — used when
 * walking a coach's availability window, where the hour/minute come from parsed
 * config rather than a string.
 */
export function wallClockPartsToUtc(
  date: string,
  hour: number,
  minute: number,
  zone: string = BUSINESS_TIME_ZONE,
): Date {
  return wallClockToUtc(date, `${pad(hour)}:${pad(minute)}`, zone);
}

/** Add days to a business-timezone calendar date (`YYYY-MM-DD`). */
export function addBusinessDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
