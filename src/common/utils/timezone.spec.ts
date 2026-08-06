import {
  addBusinessDays,
  utcToWallClock,
  wallClockPartsToUtc,
  wallClockToUtc,
} from './timezone';

/**
 * The bug these guard against only appears when the server's zone differs from
 * the business zone, so every assertion must hold regardless of `TZ`. Run the
 * suite under `TZ=UTC` and `TZ=Australia/Perth` (staging and local dev) — the
 * results must be identical.
 */
describe('timezone helpers (Asia/Manila, UTC+8, no DST)', () => {
  describe('wallClockToUtc', () => {
    it('reads a wall clock as business time, not server time', () => {
      // The reported bug: this resolved to 09:00Z on a UTC server.
      expect(wallClockToUtc('2026-08-10', '09:00').toISOString()).toBe(
        '2026-08-10T01:00:00.000Z',
      );
    });

    it('accepts HH:MM:SS, as Postgres time columns return', () => {
      expect(wallClockToUtc('2026-08-10', '09:00:00').toISOString()).toBe(
        '2026-08-10T01:00:00.000Z',
      );
    });

    it('rolls back across the date boundary for early wall clocks', () => {
      // 07:00 Manila on the 10th is 23:00 UTC on the 9th.
      expect(wallClockToUtc('2026-08-10', '07:00').toISOString()).toBe(
        '2026-08-09T23:00:00.000Z',
      );
    });

    it('handles midnight', () => {
      expect(wallClockToUtc('2026-08-10', '00:00').toISOString()).toBe(
        '2026-08-09T16:00:00.000Z',
      );
    });

    it('returns an Invalid Date for junk, like new Date() would', () => {
      expect(Number.isNaN(wallClockToUtc('nope', '09:00').getTime())).toBe(
        true,
      );
      expect(Number.isNaN(wallClockToUtc('2026-08-10', 'nope').getTime())).toBe(
        true,
      );
    });
  });

  describe('utcToWallClock', () => {
    it('renders an instant in business time', () => {
      expect(utcToWallClock(new Date('2026-08-10T01:00:00Z'))).toEqual({
        date: '2026-08-10',
        time: '09:00',
        weekday: 1, // Monday in Manila
      });
    });

    it('reports the business-local weekday across the UTC day boundary', () => {
      // 00:30 Monday in Manila is still Sunday in UTC — getDay() on a UTC server
      // would answer 0 and match the wrong availability window.
      const instant = wallClockToUtc('2026-08-10', '00:30');
      expect(instant.toISOString()).toBe('2026-08-09T16:30:00.000Z');
      expect(instant.getUTCDay()).toBe(0); // what the old code saw
      expect(utcToWallClock(instant).weekday).toBe(1); // Monday, correct
    });

    it('round-trips with wallClockToUtc', () => {
      for (const [date, time] of [
        ['2026-08-10', '09:00'],
        ['2026-01-01', '00:00'],
        ['2026-12-31', '23:30'],
        ['2027-02-28', '16:45'],
      ]) {
        const back = utcToWallClock(wallClockToUtc(date, time));
        expect({ date: back.date, time: back.time }).toEqual({ date, time });
      }
    });
  });

  describe('wallClockPartsToUtc', () => {
    it('matches the string form', () => {
      expect(wallClockPartsToUtc('2026-08-10', 9, 0).toISOString()).toBe(
        wallClockToUtc('2026-08-10', '09:00').toISOString(),
      );
    });
  });

  describe('addBusinessDays', () => {
    it('walks calendar dates without drifting through UTC', () => {
      expect(addBusinessDays('2026-08-10', 1)).toBe('2026-08-11');
      expect(addBusinessDays('2026-08-31', 1)).toBe('2026-09-01');
      expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addBusinessDays('2026-03-01', -1)).toBe('2026-02-28');
    });
  });

  describe('a DST zone still resolves correctly', () => {
    // Guards the two-pass offset resolution. New York moved to EDT at
    // 2026-03-08 02:00 local.
    it('picks the right offset on either side of a transition', () => {
      expect(
        wallClockToUtc('2026-03-07', '12:00', 'America/New_York').toISOString(),
      ).toBe('2026-03-07T17:00:00.000Z'); // EST, UTC-5
      expect(
        wallClockToUtc('2026-03-09', '12:00', 'America/New_York').toISOString(),
      ).toBe('2026-03-09T16:00:00.000Z'); // EDT, UTC-4
    });
  });
});
