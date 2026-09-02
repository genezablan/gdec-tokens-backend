import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, MoreThanOrEqual } from 'typeorm';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { CoachingSession } from '../entities/coaching-session.entity';
import { User } from '../entities/user.entity';
import { CoachingSessionStatus } from '../common/enums';
import { CreateAvailabilitySlotDto } from './dto/create-availability-slot.dto';
import { UpdateCoachingHoursDto } from './dto/update-coaching-hours.dto';
import { CalendarService } from '../calendar/calendar.service';
import {
  addBusinessDays,
  utcToWallClock,
  wallClockPartsToUtc,
  wallClockToUtc,
} from '../common/utils/timezone';

/** How far ahead to scan Outlook for conflicts when syncing (days). */
const SYNC_WINDOW_DAYS = 56;
/** How far ahead to generate bookable slots from Outlook free time (days). */
const BOOKING_HORIZON_DAYS = 28;

// Slots are described in the business timezone, not the server's — see
// `common/utils/timezone.ts`.
const hhmm = (d: Date) => utcToWallClock(d).time;
const ymd = (d: Date) => utcToWallClock(d).date;

/** A published window the coach is already busy in, over the booking horizon. */
export interface HourConflict {
  day: number;
  startTime: string;
  endTime: string;
  /** How many times this weekday falls inside the horizon. */
  occurrences: number;
  /** The `YYYY-MM-DD` days where the calendar clashes with the window. */
  conflictingDates: string[];
}

export interface BookableSlot {
  id: string;
  availableDate: string;
  startTime: string;
  endTime: string;
  startDateTime: string;
  endDateTime: string;
}

@Injectable()
export class CoachAvailabilityService {
  private readonly logger = new Logger(CoachAvailabilityService.name);

  constructor(
    @InjectRepository(CoachAvailability)
    private readonly availabilityRepo: Repository<CoachAvailability>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(CoachingSession)
    private readonly sessionRepo: Repository<CoachingSession>,
    private readonly calendarService: CalendarService,
  ) {}

  // ─── Coaching hours (per coach) ────────────────────────────────────────────────

  async getCoachingHours(coachId: string) {
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (!coach) throw new NotFoundException('Coach not found');
    return {
      coachingWeeklyHours: coach.coachingWeeklyHours ?? [],
      coachingSessionMinutes: coach.coachingSessionMinutes ?? 60,
    };
  }

  async updateCoachingHours(coachId: string, dto: UpdateCoachingHoursDto) {
    if (dto.coachingWeeklyHours !== undefined) {
      const byDay = new Map<number, { startTime: string; endTime: string }[]>();
      for (const window of dto.coachingWeeklyHours) {
        if (window.startTime >= window.endTime) {
          throw new BadRequestException(
            `startTime must be before endTime for day ${window.day}`,
          );
        }
        if (!byDay.has(window.day)) byDay.set(window.day, []);
        byDay.get(window.day)!.push(window);
      }
      // A day can have several windows (e.g. 9–12 and 1–5); they just can't overlap.
      for (const [day, windows] of byDay) {
        const sorted = [...windows].sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        );
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].endTime > sorted[i + 1].startTime) {
            throw new BadRequestException(
              `Coaching windows for day ${day} overlap`,
            );
          }
        }
      }
    }

    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (!coach) throw new NotFoundException('Coach not found');

    if (dto.coachingWeeklyHours !== undefined)
      coach.coachingWeeklyHours = dto.coachingWeeklyHours;
    if (dto.coachingSessionMinutes !== undefined)
      coach.coachingSessionMinutes = dto.coachingSessionMinutes;
    await this.userRepo.save(coach);

    const saved = await this.getCoachingHours(coachId);
    return { ...saved, conflicts: await this.findHourConflicts(coach) };
  }

  /**
   * Published windows that yield no bookable time, over the booking horizon.
   *
   * Coaches choose their hours blind — the form shows a weekly grid, not their
   * calendar — so it is easy to publish an hour you are booked solid in and end
   * up with no availability at all and no idea why.
   *
   * Deliberately reports "this window produced nothing that day" rather than
   * "something overlaps this window". A coach offering 09:00–17:00 almost always
   * has *a* meeting inside it, and warning about that would be noise on every
   * wide window; what matters is whether a bookable session survives. Measured
   * against the real generated slots so the warning cannot disagree with what
   * employees are actually offered.
   *
   * Advisory only: the hours are already saved by the time this runs, and a
   * coach may well intend to move those meetings. Returns null when there is no
   * calendar to check against, so the UI can say "not checked" rather than
   * implying the window is clear.
   */
  private async findHourConflicts(coach: User): Promise<HourConflict[] | null> {
    const windows = coach.coachingWeeklyHours ?? [];
    if (windows.length === 0) return [];
    if (!(await this.calendarService.isConnected(coach.id))) return null;

    let slots: BookableSlot[];
    try {
      ({ slots } = await this.getBookableSlots(coach.id));
    } catch (err) {
      // Never let a calendar hiccup surface as a failed save — the hours are
      // already committed, and the warning is a nicety.
      this.logger.warn(
        `Conflict scan failed for coach ${coach.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const firstDay = utcToWallClock(new Date()).date;

    return windows
      .map((w) => {
        const dates: string[] = [];
        let occurrences = 0;
        for (let i = 0; i < BOOKING_HORIZON_DAYS; i++) {
          const day = addBusinessDays(firstDay, i);
          if (utcToWallClock(wallClockToUtc(day, '12:00')).weekday !== w.day) {
            continue;
          }
          occurrences++;
          const yielded = slots.some(
            (slot) =>
              slot.availableDate === day &&
              slot.startTime >= w.startTime &&
              slot.startTime < w.endTime,
          );
          if (!yielded) dates.push(day);
        }
        return {
          day: w.day,
          startTime: w.startTime,
          endTime: w.endTime,
          occurrences,
          conflictingDates: dates,
        };
      })
      .filter((c) => c.conflictingDates.length > 0);
  }

  // ─── Bookable slots (Outlook is the source of truth) ───────────────────────────

  /**
   * Generate bookable slots for a coach = their coaching-hours grid over the next
   * BOOKING_HORIZON_DAYS, minus already-booked sessions, and minus Outlook busy
   * times when the coach has connected a calendar.
   *
   * Outlook is an enhancement, not a requirement. It used to gate the whole
   * result, which left 53 of 66 active coaches permanently unbookable no matter
   * what hours they set — only 19% have ever connected, and a handful are on
   * madagency.ph without a Microsoft work account at all. A coach without
   * Outlook can now be booked over something in their own calendar, which is a
   * real loss of protection, but it only applies to people who could not be
   * booked at all before.
   *
   * `connected` is still returned so the UI can suggest connecting.
   */
  async getBookableSlots(coachId: string): Promise<{
    connected: boolean;
    hasHours: boolean;
    slots: BookableSlot[];
  }> {
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (!coach) throw new NotFoundException('Coach not found');

    const hasHours =
      !!coach.coachingWeeklyHours?.length && !!coach.coachingSessionMinutes;
    const connected = await this.calendarService.isConnected(coachId);
    if (!hasHours) return { connected, hasHours, slots: [] };

    const now = new Date();
    // Walk business-timezone calendar days: "today" and each window's hours mean
    // the office's day and clock, not the server's.
    const firstDay = utcToWallClock(now).date;
    const from = wallClockToUtc(firstDay, '00:00');
    const to = wallClockToUtc(
      addBusinessDays(firstDay, BOOKING_HORIZON_DAYS),
      '00:00',
    );

    // Skip the Graph round-trip entirely when there is no calendar to read.
    const busy = connected
      ? await this.calendarService.getBusyIntervals(coachId, from, to)
      : [];

    // Active sessions block their time (start → start + session length).
    const sessions = await this.sessionRepo.find({
      where: {
        coachId,
        status: In([
          CoachingSessionStatus.SCHEDULED,
          CoachingSessionStatus.PENDING_COACH_APPROVAL,
        ]),
      },
    });
    const stepMs = (coach.coachingSessionMinutes as number) * 60000;
    const booked = sessions.map((s) => ({
      start: new Date(s.scheduledAt),
      end: new Date(new Date(s.scheduledAt).getTime() + stepMs),
    }));

    const windowsByDay = new Map<
      number,
      { startTime: string; endTime: string }[]
    >();
    for (const w of coach.coachingWeeklyHours ?? []) {
      if (!windowsByDay.has(w.day)) windowsByDay.set(w.day, []);
      windowsByDay.get(w.day)!.push(w);
    }

    const overlaps = (s: Date, e: Date, list: { start: Date; end: Date }[]) =>
      list.some((b) => s < b.end && e > b.start);

    const slots: BookableSlot[] = [];
    for (let i = 0; i < BOOKING_HORIZON_DAYS; i++) {
      const dayDate = addBusinessDays(firstDay, i);
      // Weekday in the business zone — `getDay()` on a UTC server reads the
      // previous day for anything before 08:00 local and matches the wrong window.
      const dayWindows = windowsByDay.get(
        utcToWallClock(wallClockToUtc(dayDate, '12:00')).weekday,
      );
      if (!dayWindows) continue;

      for (const window of dayWindows) {
        const [sh, sm] = window.startTime.split(':').map(Number);
        const [eh, em] = window.endTime.split(':').map(Number);

        const windowEnd = wallClockPartsToUtc(dayDate, eh, em);
        let slotStart = wallClockPartsToUtc(dayDate, sh, sm);

        while (slotStart.getTime() + stepMs <= windowEnd.getTime() + 1) {
          const slotEnd = new Date(slotStart.getTime() + stepMs);
          if (
            slotStart > now &&
            !overlaps(slotStart, slotEnd, busy) &&
            !overlaps(slotStart, slotEnd, booked)
          ) {
            slots.push({
              id: `${ymd(slotStart)}T${hhmm(slotStart)}`,
              availableDate: ymd(slotStart),
              startTime: hhmm(slotStart),
              endTime: hhmm(slotEnd),
              startDateTime: slotStart.toISOString(),
              endDateTime: slotEnd.toISOString(),
            });
          }
          slotStart = slotEnd;
        }
      }
    }

    return { connected, hasHours, slots };
  }

  /** Coach: add a new available time slot. */
  async addSlot(
    coachId: string,
    dto: CreateAvailabilitySlotDto,
  ): Promise<CoachAvailability> {
    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const today = new Date().toISOString().split('T')[0];
    if (dto.availableDate < today) {
      throw new BadRequestException('availableDate cannot be in the past');
    }

    // Prevent overlapping slots: reject if any active slot on the same date shares time range
    // Overlap condition: existingStart < newEnd  AND  existingEnd > newStart
    const overlapping = await this.availabilityRepo
      .createQueryBuilder('slot')
      .where('slot.coachId = :coachId', { coachId })
      .andWhere('slot.availableDate = :date', { date: dto.availableDate })
      .andWhere('slot.isActive = true')
      .andWhere('slot.startTime < :endTime', { endTime: dto.endTime })
      .andWhere('slot.endTime > :startTime', { startTime: dto.startTime })
      .getOne();

    if (overlapping) {
      throw new BadRequestException(
        `This slot overlaps with an existing slot (${overlapping.startTime}–${overlapping.endTime})`,
      );
    }

    const slot = this.availabilityRepo.create({
      coachId,
      availableDate: dto.availableDate,
      startTime: dto.startTime,
      endTime: dto.endTime,
    });
    return this.availabilityRepo.save(slot);
  }

  /** Coach: view all own slots (active and inactive), future + today, ordered by date/time. */
  async findMySlots(coachId: string): Promise<CoachAvailability[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.availabilityRepo.find({
      where: { coachId, availableDate: MoreThanOrEqual(today) as any },
      order: { availableDate: 'ASC', startTime: 'ASC' },
    });
  }

  /**
   * Pull busy times from the coach's Outlook calendar and deactivate any active,
   * unbooked slots that overlap a real meeting. Reversible: the coach can
   * reactivate a slot afterwards.
   */
  async syncWithOutlook(
    coachId: string,
  ): Promise<{ blocked: number; blockedSlots: CoachAvailability[] }> {
    if (!(await this.calendarService.isConnected(coachId))) {
      throw new BadRequestException('Outlook calendar is not connected');
    }

    // Scan from the start of the business day, in the business zone.
    const today = utcToWallClock(new Date()).date;
    const from = wallClockToUtc(today, '00:00');
    const to = wallClockToUtc(
      addBusinessDays(today, SYNC_WINDOW_DAYS),
      '00:00',
    );

    const busy = await this.calendarService.getBusyIntervals(coachId, from, to);
    if (busy.length === 0) return { blocked: 0, blockedSlots: [] };
    const slots = await this.availabilityRepo.find({
      where: {
        coachId,
        isActive: true,
        isBooked: false,
        availableDate: MoreThanOrEqual(today) as any,
      },
    });

    const blockedSlots: CoachAvailability[] = [];
    for (const slot of slots) {
      const slotStart = wallClockToUtc(slot.availableDate, slot.startTime);
      const slotEnd = wallClockToUtc(slot.availableDate, slot.endTime);
      if (
        Number.isNaN(slotStart.getTime()) ||
        Number.isNaN(slotEnd.getTime())
      ) {
        continue;
      }
      // Overlap: slotStart < busyEnd AND slotEnd > busyStart
      const conflicts = busy.some(
        (b) => slotStart < b.end && slotEnd > b.start,
      );
      if (conflicts) {
        slot.isActive = false;
        blockedSlots.push(slot);
      }
    }

    if (blockedSlots.length > 0) {
      await this.availabilityRepo.save(blockedSlots);
    }

    return { blocked: blockedSlots.length, blockedSlots };
  }

  /**
   * Public: get a specific coach's available (active, unbooked, future) slots.
   * Used by employees when viewing a coach before/after submitting a request.
   */
  async findAvailableForCoach(coachId: string): Promise<CoachAvailability[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.availabilityRepo.find({
      where: {
        coachId,
        isActive: true,
        isBooked: false,
        availableDate: MoreThanOrEqual(today) as any,
      },
      order: { availableDate: 'ASC', startTime: 'ASC' },
    });
  }

  /** Coach: delete a slot (only if not yet booked). */
  async removeSlot(slotId: string, coachId: string): Promise<void> {
    const slot = await this.availabilityRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Availability slot not found');
    if (slot.coachId !== coachId)
      throw new ForbiddenException('You can only remove your own slots');
    if (slot.isBooked)
      throw new BadRequestException(
        'Cannot delete a slot that already has a session booked',
      );
    await this.availabilityRepo.remove(slot);
  }

  /** Coach: deactivate a slot (soft-disable without deleting). */
  async deactivateSlot(
    slotId: string,
    coachId: string,
  ): Promise<CoachAvailability> {
    const slot = await this.availabilityRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Availability slot not found');
    if (slot.coachId !== coachId)
      throw new ForbiddenException('You can only deactivate your own slots');
    if (slot.isBooked)
      throw new BadRequestException(
        'Cannot deactivate a slot that already has a session booked',
      );
    slot.isActive = false;
    return this.availabilityRepo.save(slot);
  }

  /** Coach: reactivate a previously deactivated slot. */
  async reactivateSlot(
    slotId: string,
    coachId: string,
  ): Promise<CoachAvailability> {
    const slot = await this.availabilityRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Availability slot not found');
    if (slot.coachId !== coachId)
      throw new ForbiddenException('You can only reactivate your own slots');
    if (slot.isActive)
      throw new BadRequestException('This slot is already active');

    const today = new Date().toISOString().split('T')[0];
    if (slot.availableDate < today) {
      throw new BadRequestException(
        'Cannot reactivate a slot that is in the past',
      );
    }

    // Re-check for overlaps — other active slots may have been added while this one was inactive
    const overlapping = await this.availabilityRepo
      .createQueryBuilder('s')
      .where('s.coachId = :coachId', { coachId })
      .andWhere('s.availableDate = :date', { date: slot.availableDate })
      .andWhere('s.isActive = true')
      .andWhere('s.id != :slotId', { slotId })
      .andWhere('s.startTime < :endTime', { endTime: slot.endTime })
      .andWhere('s.endTime > :startTime', { startTime: slot.startTime })
      .getOne();

    if (overlapping) {
      throw new BadRequestException(
        `Cannot reactivate: overlaps with an existing active slot (${overlapping.startTime}–${overlapping.endTime})`,
      );
    }

    slot.isActive = true;
    return this.availabilityRepo.save(slot);
  }

  /** Internal: mark a slot as booked (called by session booking logic). */
  async markBooked(slotId: string): Promise<CoachAvailability> {
    const slot = await this.availabilityRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Availability slot not found');
    if (slot.isBooked)
      throw new BadRequestException('This slot has already been booked');
    if (!slot.isActive)
      throw new BadRequestException('This slot is no longer active');
    slot.isBooked = true;
    return this.availabilityRepo.save(slot);
  }

  /** Internal: release a booking (e.g. if a session is cancelled). */
  async releaseSlot(slotId: string): Promise<void> {
    await this.availabilityRepo.update(slotId, { isBooked: false });
  }
}
