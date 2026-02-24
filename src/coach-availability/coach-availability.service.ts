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

@Injectable()
export class CoachAvailabilityService {
  constructor(
    @InjectRepository(CoachAvailability)
    private readonly availabilityRepo: Repository<CoachAvailability>,
  ) {}

  /** Coach: add a new available time slot. */
  async addSlot(coachId: string, dto: CreateAvailabilitySlotDto): Promise<CoachAvailability> {
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
    if (slot.coachId !== coachId) throw new ForbiddenException('You can only remove your own slots');
    if (slot.isBooked) throw new BadRequestException('Cannot delete a slot that already has a session booked');
    await this.availabilityRepo.remove(slot);
  }

  /** Coach: deactivate a slot (soft-disable without deleting). */
  async deactivateSlot(slotId: string, coachId: string): Promise<CoachAvailability> {
    const slot = await this.availabilityRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Availability slot not found');
    if (slot.coachId !== coachId) throw new ForbiddenException('You can only deactivate your own slots');
    if (slot.isBooked) throw new BadRequestException('Cannot deactivate a slot that already has a session booked');
    slot.isActive = false;
    return this.availabilityRepo.save(slot);
  }

  /** Internal: mark a slot as booked (called by session booking logic). */
  async markBooked(slotId: string): Promise<CoachAvailability> {
    const slot = await this.availabilityRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Availability slot not found');
    if (slot.isBooked) throw new BadRequestException('This slot has already been booked');
    if (!slot.isActive) throw new BadRequestException('This slot is no longer active');
    slot.isBooked = true;
    return this.availabilityRepo.save(slot);
  }

  /** Internal: release a booking (e.g. if a session is cancelled). */
  async releaseSlot(slotId: string): Promise<void> {
    await this.availabilityRepo.update(slotId, { isBooked: false });
  }
}
