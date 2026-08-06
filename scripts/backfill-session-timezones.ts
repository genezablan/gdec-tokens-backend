/**
 * backfill-session-timezones.ts
 *
 * Repairs coaching sessions whose `scheduledAt` was written by the old
 * timezone-naive booking code.
 *
 * Slots are stored as bare wall clocks ("09:00 on 2026-08-10") meaning 9am in
 * the office. The old code resolved them with `new Date('2026-08-10T09:00')`,
 * which uses the *server's* timezone — so on a UTC box every session landed 8
 * hours late, and any Outlook events created from it landed 8 hours late too.
 *
 * This recomputes each session's instant from its slot using the business
 * timezone and, for sessions that pushed a Graph event, moves that event to
 * match. Sessions that no longer hold their time (cancelled / declined /
 * no-show) are skipped — there is nothing to re-notify anyone about.
 *
 * Dry run (default — prints the diff, writes nothing):
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-session-timezones.ts
 *
 * Apply, database only:
 *   ... scripts/backfill-session-timezones.ts --apply
 *
 * Apply, and move the Outlook events too (re-invites attendees):
 *   ... scripts/backfill-session-timezones.ts --apply --calendar
 *
 * Every applied change is appended to scripts/backfill-session-timezones.log.json
 * with the previous value, so it can be reversed.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppDataSource } from '../src/data-source';
import { AppModule } from '../src/app.module';
import { CalendarService } from '../src/calendar/calendar.service';
import { CoachingSession } from '../src/entities/coaching-session.entity';
import { CoachAvailability } from '../src/entities/coach-availability.entity';
import { CoachingSessionStatus } from '../src/common/enums';
import {
  BUSINESS_TIME_ZONE,
  wallClockToUtc,
} from '../src/common/utils/timezone';

/** Statuses that no longer hold their slot — not worth touching. */
const RELEASED = [
  CoachingSessionStatus.CANCELLED,
  CoachingSessionStatus.DECLINED,
  CoachingSessionStatus.NO_SHOW,
];

const DEFAULT_SESSION_MINUTES = 60;

type Change = {
  sessionId: string;
  slot: string;
  from: string;
  to: string;
  driftHours: number;
  graphEventId: string | null;
  calendarUpdated: boolean;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const withCalendar = process.argv.includes('--calendar');

  console.log(`Business timezone : ${BUSINESS_TIME_ZONE}`);
  console.log(`Server timezone   : ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log(`Mode              : ${apply ? 'APPLY' : 'DRY RUN'}${withCalendar ? ' + calendar' : ''}\n`);

  await AppDataSource.initialize();

  const sessionRepo = AppDataSource.getRepository(CoachingSession);
  const availabilityRepo = AppDataSource.getRepository(CoachAvailability);

  const sessions = await sessionRepo.find({ order: { scheduledAt: 'ASC' } });

  const changes: Change[] = [];
  let skippedReleased = 0;
  let skippedNoSlot = 0;
  let alreadyCorrect = 0;

  for (const session of sessions) {
    if (RELEASED.includes(session.status)) {
      skippedReleased++;
      continue;
    }
    if (!session.availabilityId) {
      // Nothing authoritative to recompute from — the wall clock lives on the slot.
      skippedNoSlot++;
      continue;
    }

    const slot = await availabilityRepo.findOne({
      where: { id: session.availabilityId },
    });
    if (!slot?.availableDate || !slot?.startTime) {
      skippedNoSlot++;
      continue;
    }

    const correct = wallClockToUtc(slot.availableDate, slot.startTime);
    if (Number.isNaN(correct.getTime())) {
      skippedNoSlot++;
      continue;
    }
    if (correct.getTime() === session.scheduledAt.getTime()) {
      alreadyCorrect++;
      continue;
    }

    changes.push({
      sessionId: session.id,
      slot: `${slot.availableDate} ${String(slot.startTime).slice(0, 5)}`,
      from: session.scheduledAt.toISOString(),
      to: correct.toISOString(),
      driftHours:
        (session.scheduledAt.getTime() - correct.getTime()) / 3_600_000,
      graphEventId: session.graphEventId ?? null,
      calendarUpdated: false,
    });
  }

  console.log(`${sessions.length} sessions examined`);
  console.log(`  ${alreadyCorrect} already correct`);
  console.log(`  ${skippedReleased} skipped (cancelled/declined/no-show)`);
  console.log(`  ${skippedNoSlot} skipped (no usable slot)`);
  console.log(`  ${changes.length} need correcting\n`);

  if (changes.length === 0) {
    console.log('Nothing to do.');
    await AppDataSource.destroy();
    return;
  }

  console.table(
    changes.map((c) => ({
      session: c.sessionId.slice(0, 8),
      slot: c.slot,
      from: c.from.slice(0, 16),
      to: c.to.slice(0, 16),
      drift: `${c.driftHours > 0 ? '+' : ''}${c.driftHours}h`,
      outlook: c.graphEventId ? 'yes' : '—',
    })),
  );

  const withEvents = changes.filter((c) => c.graphEventId).length;

  if (!apply) {
    console.log(
      `\nDry run — nothing written. ${withEvents} of these have an Outlook event.`,
    );
    console.log('Re-run with --apply (add --calendar to move the events too).');
    await AppDataSource.destroy();
    return;
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  for (const change of changes) {
    await sessionRepo.update(change.sessionId, { scheduledAt: new Date(change.to) });
  }
  console.log(`\nUpdated ${changes.length} session rows.`);

  if (withCalendar && withEvents > 0) {
    // Only stand up the Nest context when we actually intend to talk to Graph —
    // it needs the app's config and token-decryption wiring.
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const calendar = app.get(CalendarService);

    for (const change of changes) {
      if (!change.graphEventId) continue;
      const session = await sessionRepo.findOne({
        where: { id: change.sessionId },
        relations: ['availability'],
      });
      if (!session) continue;

      const start = new Date(change.to);
      const slot = session.availability;
      let end = slot?.endTime && slot?.availableDate
        ? wallClockToUtc(slot.availableDate, slot.endTime)
        : new Date(NaN);
      if (Number.isNaN(end.getTime()) || end <= start) {
        end = new Date(start.getTime() + DEFAULT_SESSION_MINUTES * 60_000);
      }

      try {
        await calendar.updateEventTime(
          session.coachId,
          change.graphEventId,
          start,
          end,
        );
        change.calendarUpdated = true;
        console.log(`  moved Outlook event for ${change.sessionId.slice(0, 8)}`);
      } catch (err) {
        console.error(
          `  FAILED to move Outlook event for ${change.sessionId.slice(0, 8)}: ${(err as Error).message}`,
        );
      }
    }
    await app.close();
  } else if (withEvents > 0) {
    console.log(
      `\n${withEvents} sessions still have Outlook events at the OLD time — re-run with --calendar to move them.`,
    );
  }

  const logPath = join(__dirname, 'backfill-session-timezones.log.json');
  writeFileSync(
    logPath,
    JSON.stringify(
      { appliedAt: new Date().toISOString(), businessTimeZone: BUSINESS_TIME_ZONE, changes },
      null,
      2,
    ),
  );
  console.log(`\nReversible record written to ${logPath}`);

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
