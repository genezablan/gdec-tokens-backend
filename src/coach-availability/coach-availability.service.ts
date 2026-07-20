import {
  Injectable,
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

/** How far ahead to scan Outlook for conflicts when syncing (days). */
const SYNC_WINDOW_DAYS = 56;
/** How far ahead to generate bookable slots from Outlook free time (days). */
const BOOKING_HORIZON_DAYS = 28;

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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
        const sorted = [...windows].sort((a, b) => a.startTime.localeCompare(b.startTime));
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].endTime > sorted[i + 1].startTime) {
            throw new BadRequestException(`Coaching windows for day ${day} overlap`);
          }
        }
      }
    }

    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (!coach) throw new NotFoundException('Coach not found');

    if (dto.coachingWeeklyHours !== undefined) coach.coachingWeeklyHours = dto.coachingWeeklyHours;
    if (dto.coachingSessionMinutes !== undefined) coach.coachingSessionMinutes = dto.coachingSessionMinutes;
    await this.userRepo.save(coach);
    return this.getCoachingHours(coachId);
  }

  // ─── Bookable slots (Outlook is the source of truth) ───────────────────────────

  /**
   * Generate bookable slots for a coach = their coaching-hours grid over the next
   * BOOKING_HORIZON_DAYS, minus Outlook busy times, minus already-booked sessions.
   * Returns flags so the UI can explain an empty result.
   */
  async getBookableSlots(coachId: string): Promise<{
    connected: boolean;
    hasHours: boolean;
    slots: BookableSlot[];
  }> {
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (!coach) throw new NotFoundException('Coach not found');

    const hasHours = !!coach.coachingWeeklyHours?.length && !!coach.coachingSessionMinutes;
    const connected = await this.calendarService.isConnected(coachId);
    if (!hasHours || !connected) return { connected, hasHours, slots: [] };

    const now = new Date();
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + BOOKING_HORIZON_DAYS * 86400000);

    const busy = await this.calendarService.getBusyIntervals(coachId, from, to);

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

    const windowsByDay = new Map<number, { startTime: string; endTime: string }[]>();
    for (const w of coach.coachingWeeklyHours ?? []) {
      if (!windowsByDay.has(w.day)) windowsByDay.set(w.day, []);
      windowsByDay.get(w.day)!.push(w);
    }

    const overlaps = (s: Date, e: Date, list: { start: Date; end: Date }[]) =>
      list.some((b) => s < b.end && e > b.start);

    const slots: BookableSlot[] = [];
    for (let i = 0; i < BOOKING_HORIZON_DAYS; i++) {
      const day = new Date(from.getTime() + i * 86400000);
      const dayWindows = windowsByDay.get(day.getDay());
      if (!dayWindows) continue;

      for (const window of dayWindows) {
        const [sh, sm] = window.startTime.split(':').map(Number);
        const [eh, em] = window.endTime.split(':').map(Number);

        const windowEnd = new Date(day);
        windowEnd.setHours(eh, em, 0, 0);
        let slotStart = new Date(day);
        slotStart.setHours(sh, sm, 0, 0);

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

    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + SYNC_WINDOW_DAYS * 86400000);

    const busy = await this.calendarService.getBusyIntervals(coachId, from, to);
    if (busy.length === 0) return { blocked: 0, blockedSlots: [] };

    const today = from.toISOString().split('T')[0];
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
      const slotStart = new Date(`${slot.availableDate}T${slot.startTime}`);
      const slotEnd = new Date(`${slot.availableDate}T${slot.endTime}`);
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
