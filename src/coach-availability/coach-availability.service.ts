import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { CreateAvailabilitySlotDto } from './dto/create-availability-slot.dto';
import { CalendarService } from '../calendar/calendar.service';

/** How far ahead to scan Outlook for conflicts when syncing (days). */
const SYNC_WINDOW_DAYS = 56;

@Injectable()
export class CoachAvailabilityService {
  constructor(
    @InjectRepository(CoachAvailability)
    private readonly availabilityRepo: Repository<CoachAvailability>,
    private readonly calendarService: CalendarService,
  ) {}

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
