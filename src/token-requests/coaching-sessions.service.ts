import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { CoachingSession } from '../entities/coaching-session.entity';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import { CoachingSessionStatus, DevelopmentOptionType, RequestStatus } from '../common/enums';
import { BookSessionDto } from './dto/book-session.dto';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';

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
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
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

  /**
   * Returns all coaching requests assigned to this coach (managerId = coachId,
   * type = coaching, status = approved or manager_approved), each with its
   * sessions embedded. This is the data source for the coach's "My Sessions" page.
   */
  async findCoachOverview(
    coachId: string,
  ): Promise<(TokenRequest & { sessions: CoachingSession[] })[]> {
    const requests = await this.requestRepo.find({
      where: {
        managerId: coachId,
        type: DevelopmentOptionType.COACHING,
        status: In([RequestStatus.APPROVED, RequestStatus.MANAGER_APPROVED, RequestStatus.PENDING]),
      },
      relations: ['employee', 'developmentOption'],
      order: { createdAt: 'DESC' },
    });

    const results = await Promise.all(
      requests.map(async (req) => {
        const sessions = await this.sessionRepo.find({
          where: { tokenRequestId: req.id },
          relations: ['availability'],
          order: { sessionNumber: 'ASC' },
        });
        return Object.assign(req, { sessions });
      }),
    );

    return results;
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

    // Count active sessions (exclude cancelled, declined, and no-show so the slot can be rebooked)
    const bookedCount = await this.sessionRepo.count({
      where: {
        tokenRequestId: requestId,
        status: Not(In([CoachingSessionStatus.CANCELLED, CoachingSessionStatus.DECLINED, CoachingSessionStatus.NO_SHOW])),
      },
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
    // pg returns time columns as "HH:MM:SS", so don't append extra ":00"
    const scheduledAt = new Date(`${slot.availableDate}T${slot.startTime}`);
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
      // Awaiting coach confirmation before the session is locked in
      status: CoachingSessionStatus.PENDING_COACH_APPROVAL,
    });

    const saved = await this.sessionRepo.save(session);

    // Notify the coach that a booking request is pending their confirmation
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (coach) {
      this.emailService.sendSessionBookingRequestNotification({
        coachEmail: coach.email,
        coachName: coach.fullName,
        employeeName: request.employee.fullName,
        sessionNumber: saved.sessionNumber,
        scheduledAt: saved.scheduledAt,
      }).catch(() => {});

      this.notificationsService.create(coachId, {
        title: 'Session Booking Request',
        message: `${request.employee.fullName} has requested to book Session ${saved.sessionNumber} with you. Please confirm or decline.`,
        type: NotificationType.INFO,
        requestId: requestId,
      }).catch(() => {});
    }

    return saved;
  }

  // ─── Confirm a session (coach) ────────────────────────────────────────────────

  /**
   * Coach confirms a pending booking request → status becomes scheduled.
   */
  async confirmSession(
    requestId: string,
    sessionId: string,
    coachId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.coachId !== coachId) {
      throw new ForbiddenException('Only the assigned coach can confirm this session');
    }
    if (session.status !== CoachingSessionStatus.PENDING_COACH_APPROVAL) {
      throw new BadRequestException(`Session is not pending approval — current status: ${session.status}`);
    }

    session.status = CoachingSessionStatus.SCHEDULED;
    const saved = await this.sessionRepo.save(session);

    // Notify the employee that the coach confirmed their session
    const [employee, coach] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.employeeId } }),
      this.userRepo.findOne({ where: { id: coachId } }),
    ]);
    if (employee && coach) {
      this.emailService.sendSessionConfirmedNotification({
        employeeEmail: employee.email,
        employeeName: employee.fullName,
        coachName: coach.fullName,
        sessionNumber: session.sessionNumber,
        scheduledAt: session.scheduledAt,
      }).catch(() => {});

      this.notificationsService.create(session.employeeId, {
        title: 'Session Confirmed',
        message: `Your Session ${session.sessionNumber} with ${coach.fullName} has been confirmed.`,
        type: NotificationType.SUCCESS,
        requestId: requestId,
      }).catch(() => {});
    }

    return saved;
  }

  // ─── Decline a session (coach) ───────────────────────────────────────────────

  /**
   * Coach declines a pending booking request.
   * The availability slot is released so the employee can pick a different one.
   */
  async declineSession(
    requestId: string,
    sessionId: string,
    coachId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.coachId !== coachId) {
      throw new ForbiddenException('Only the assigned coach can decline this session');
    }
    if (session.status !== CoachingSessionStatus.PENDING_COACH_APPROVAL) {
      throw new BadRequestException(`Session is not pending approval — current status: ${session.status}`);
    }

    session.status = CoachingSessionStatus.DECLINED;

    // Release the slot so the employee can rebook
    if (session.availabilityId) {
      await this.availabilityRepo.update(session.availabilityId, { isBooked: false });
    }

    const saved = await this.sessionRepo.save(session);

    // Notify the employee that the coach declined
    const [employee, coach] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.employeeId } }),
      this.userRepo.findOne({ where: { id: coachId } }),
    ]);
    if (employee && coach) {
      this.emailService.sendSessionDeclinedNotification({
        employeeEmail: employee.email,
        employeeName: employee.fullName,
        coachName: coach.fullName,
        sessionNumber: session.sessionNumber,
        scheduledAt: session.scheduledAt,
      }).catch(() => {});

      this.notificationsService.create(session.employeeId, {
        title: 'Session Booking Declined',
        message: `${coach.fullName} declined your Session ${session.sessionNumber} booking. Please select a different slot.`,
        type: NotificationType.WARNING,
        requestId: requestId,
      }).catch(() => {});
    }

    return saved;
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

    const saved = await this.sessionRepo.save(session);

    // Notify the employee that the session was marked complete
    const employee = await this.userRepo.findOne({ where: { id: session.employeeId } });
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (employee && coach) {
      this.emailService.sendSessionCompletedNotification({
        employeeEmail: employee.email,
        employeeName: employee.fullName,
        coachName: coach.fullName,
        sessionNumber: session.sessionNumber,
        scheduledAt: session.scheduledAt,
        sessionNotes: saved.sessionNotes,
      }).catch(() => {});

      this.notificationsService.create(session.employeeId, {
        title: 'Session Completed',
        message: `Session ${session.sessionNumber} with ${coach.fullName} has been marked as completed.`,
        type: NotificationType.SUCCESS,
        requestId: requestId,
      }).catch(() => {});
    }

    return saved;
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
    const cancellable = [CoachingSessionStatus.PENDING_COACH_APPROVAL, CoachingSessionStatus.SCHEDULED];
    if (!cancellable.includes(session.status)) {
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

    const saved = await this.sessionRepo.save(session);

    // Notify the employee that a no-show was recorded
    const employee = await this.userRepo.findOne({ where: { id: session.employeeId } });
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (employee && coach) {
      this.emailService.sendSessionNoShowNotification({
        employeeEmail: employee.email,
        employeeName: employee.fullName,
        coachName: coach.fullName,
        sessionNumber: session.sessionNumber,
        scheduledAt: session.scheduledAt,
      }).catch(() => {});

      this.notificationsService.create(session.employeeId, {
        title: 'Session No-Show Recorded',
        message: `A no-show was recorded for your Session ${session.sessionNumber} with ${coach.fullName}. Please reschedule.`,
        type: NotificationType.WARNING,
        requestId: requestId,
      }).catch(() => {});
    }

    return saved;
  }
}
