import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachingSession } from '../entities/coaching-session.entity';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { CoachingSessionStatus, DevelopmentOptionType, RequestStatus } from '../common/enums';
import { BookSessionDto } from './dto/book-session.dto';

const SESSIONS_PER_CYCLE = 3;

@Injectable()
export class CoachingSessionsService {
  constructor(
    @InjectRepository(CoachingSession)
    private readonly sessionRepo: Repository<CoachingSession>,
    @InjectRepository(CoachAvailability)
    private readonly availabilityRepo: Repository<CoachAvailability>,
    @InjectRepository(TokenRequest)
    private readonly requestRepo: Repository<TokenRequest>,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private async getApprovedCoachingRequest(requestId: string): Promise<TokenRequest> {
    const req = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['employee'],
    });
    if (!req) throw new NotFoundException('Token request not found');
    if (req.type !== DevelopmentOptionType.COACHING) {
      throw new BadRequestException('This is not a coaching request');
    }
    if (req.status !== RequestStatus.APPROVED) {
      throw new BadRequestException('Sessions can only be booked after the request is fully approved');
    }
    return req;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────────

  /** Get all sessions for a coaching request, ordered by session number. */
  async findSessions(requestId: string): Promise<CoachingSession[]> {
    return this.sessionRepo.find({
      where: { tokenRequestId: requestId },
      relations: ['coach', 'employee', 'availability'],
      order: { sessionNumber: 'ASC' },
    });
  }

  // ─── Book a session ───────────────────────────────────────────────────────────

  /**
   * Book the next available session slot (1 → 2 → 3) for an approved coaching request.
   * Either the employee or the coach can book.
   * The caller must own the request (employee) or be the coach.
   */
  async bookSession(
    requestId: string,
    callerId: string,
    dto: BookSessionDto,
  ): Promise<CoachingSession> {
    const request = await this.getApprovedCoachingRequest(requestId);

    const formData = request.formData as Record<string, unknown>;
    const coachId = formData.coachId as string;

    // Only the employee or the assigned coach can book sessions
    if (callerId !== request.employeeId && callerId !== coachId) {
      throw new ForbiddenException('Only the employee or assigned coach can book sessions');
    }

    // How many sessions already booked?
    const bookedCount = await this.sessionRepo.count({
      where: { tokenRequestId: requestId },
    });

    if (bookedCount >= SESSIONS_PER_CYCLE) {
      throw new BadRequestException('All 3 sessions for this coaching cycle are already booked');
    }

    // Validate the availability slot
    const slot = await this.availabilityRepo.findOne({ where: { id: dto.availabilityId } });
    if (!slot) throw new NotFoundException('Availability slot not found');
    if (slot.coachId !== coachId) {
      throw new BadRequestException('The selected slot does not belong to the assigned coach');
    }
    if (slot.isBooked) throw new BadRequestException('This slot has already been booked');
    if (!slot.isActive) throw new BadRequestException('This slot is no longer available');

    // Build scheduledAt from date + startTime
    const scheduledAt = new Date(`${slot.availableDate}T${slot.startTime}:00`);
    if (scheduledAt < new Date()) {
      throw new BadRequestException('Cannot book a slot in the past');
    }

    // Mark slot as booked
    slot.isBooked = true;
    await this.availabilityRepo.save(slot);

    const session = this.sessionRepo.create({
      tokenRequestId: requestId,
      coachId,
      employeeId: request.employeeId,
      availabilityId: slot.id,
      sessionNumber: bookedCount + 1,
      scheduledAt,
      status: CoachingSessionStatus.SCHEDULED,
    });

    return this.sessionRepo.save(session);
  }

  // ─── Complete a session ───────────────────────────────────────────────────────

  /**
   * Coach marks a session as completed.
   * Optionally attaches post-session notes.
   */
  async completeSession(
    requestId: string,
    sessionId: string,
    coachId: string,
    notes?: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.coachId !== coachId) {
      throw new ForbiddenException('Only the assigned coach can mark sessions as completed');
    }
    if (session.status !== CoachingSessionStatus.SCHEDULED) {
      throw new BadRequestException(`Session is already ${session.status}`);
    }

    session.status = CoachingSessionStatus.COMPLETED;
    session.completedAt = new Date();
    if (notes) session.sessionNotes = notes;

    return this.sessionRepo.save(session);
  }

  // ─── Cancel a session ─────────────────────────────────────────────────────────

  /**
   * Cancel a scheduled session.
   * Either the employee or the coach can cancel.
   * The availability slot is released back to unbooked.
   */
  async cancelSession(
    requestId: string,
    sessionId: string,
    callerId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');

    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    const formData = request?.formData as Record<string, unknown>;
    const coachId = formData?.coachId as string;

    if (callerId !== session.employeeId && callerId !== coachId) {
      throw new ForbiddenException('Only the employee or coach can cancel a session');
    }
    if (session.status !== CoachingSessionStatus.SCHEDULED) {
      throw new BadRequestException(`Cannot cancel a session that is already ${session.status}`);
    }

    session.status = CoachingSessionStatus.CANCELLED;

    // Release the availability slot so it can be rebooked
    if (session.availabilityId) {
      await this.availabilityRepo.update(session.availabilityId, { isBooked: false });
    }

    return this.sessionRepo.save(session);
  }

  // ─── Mark no-show ─────────────────────────────────────────────────────────────

  /** Coach marks the employee as a no-show for a session. */
  async markNoShow(
    requestId: string,
    sessionId: string,
    coachId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.coachId !== coachId) {
      throw new ForbiddenException('Only the assigned coach can mark a no-show');
    }
    if (session.status !== CoachingSessionStatus.SCHEDULED) {
      throw new BadRequestException(`Session is already ${session.status}`);
    }

    session.status = CoachingSessionStatus.NO_SHOW;

    // Release the slot so it can be rebooked by the employee
    if (session.availabilityId) {
      await this.availabilityRepo.update(session.availabilityId, { isBooked: false });
    }

    return this.sessionRepo.save(session);
  }
}
