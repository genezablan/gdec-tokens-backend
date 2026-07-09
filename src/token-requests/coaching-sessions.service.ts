import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, QueryFailedError, Repository } from 'typeorm';
import { CoachingSession } from '../entities/coaching-session.entity';
import { CoachAvailability } from '../entities/coach-availability.entity';
import { TokenRequest } from '../entities/token-request.entity';
import { User } from '../entities/user.entity';
import {
  CoachingSessionStatus,
  DevelopmentOptionType,
  RequestStatus,
} from '../common/enums';
import { BookSessionDto } from './dto/book-session.dto';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import { CalendarService } from '../calendar/calendar.service';

const SESSIONS_PER_CYCLE = 3;
const DEFAULT_SESSION_MINUTES = 60;

@Injectable()
export class CoachingSessionsService {
  private readonly logger = new Logger(CoachingSessionsService.name);

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
    private readonly calendarService: CalendarService,
  ) {}

  // ─── Calendar sync helpers (best-effort) ───────────────────────────────────────

  /**
   * Push a confirmed session to the coach's Outlook calendar with a Teams link.
   * Best-effort: failures are logged and recorded but never block confirmation.
   */
  private async syncSessionToCalendar(
    session: CoachingSession,
    coach: User | null,
    employee: User | null,
  ): Promise<void> {
    if (!coach) return;
    if (!(await this.calendarService.isConnected(coach.id))) return;

    // Determine end time from the booked slot, else default duration.
    let end = new Date(
      session.scheduledAt.getTime() + DEFAULT_SESSION_MINUTES * 60_000,
    );
    if (session.availabilityId) {
      const slot = await this.availabilityRepo.findOne({
        where: { id: session.availabilityId },
      });
      if (slot?.endTime && slot?.availableDate) {
        const slotEnd = new Date(`${slot.availableDate}T${slot.endTime}`);
        if (!Number.isNaN(slotEnd.getTime()) && slotEnd > session.scheduledAt)
          end = slotEnd;
      }
    }

    const withWho = employee ? ` with ${employee.fullName}` : '';
    const subject = `Coaching Session ${session.sessionNumber}${withWho}`;
    try {
      const { eventId, joinUrl } =
        await this.calendarService.createCoachingEvent(coach.id, {
          subject,
          bodyHtml: `<p>${subject}.</p>`,
          start: session.scheduledAt,
          end,
          attendeeEmail: employee?.email ?? null,
          attendeeName: employee?.fullName ?? null,
        });
      session.graphEventId = eventId;
      session.teamsJoinUrl = joinUrl;
      session.calendarSyncStatus = 'synced';
      await this.sessionRepo.save(session);
    } catch (err) {
      session.calendarSyncStatus = 'failed';
      await this.sessionRepo.save(session);
      this.logger.error(
        `Failed to sync session ${session.id} to calendar: ${(err as Error).message}`,
      );
    }
  }

  /** Remove a session's calendar event if one was created. Best-effort. */
  private async removeSessionFromCalendar(
    session: CoachingSession,
  ): Promise<void> {
    if (!session.graphEventId) return;
    try {
      await this.calendarService.cancelEvent(
        session.coachId,
        session.graphEventId,
      );
    } catch (err) {
      this.logger.error(
        `Failed to cancel calendar event for session ${session.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Live Outlook check at booking time — unlike getBookableSlots (which only
   * checks Outlook when the slot list is first displayed), this closes the gap
   * where the coach's calendar changes between page-load and the employee
   * clicking Confirm. No-ops if the coach hasn't connected a calendar.
   *
   * The Graph call itself is best-effort, matching syncSessionToCalendar/
   * removeSessionFromCalendar below: a stale token or a Graph outage logs a
   * warning and lets the (already locally-validated) booking proceed rather
   * than making booking depend on Microsoft's uptime.
   */
  private async assertNoOutlookConflict(
    coachId: string,
    availableDate: string,
    startTime: string,
    endTime: string,
  ): Promise<void> {
    if (!(await this.calendarService.isConnected(coachId))) return;
    const start = new Date(`${availableDate}T${startTime}`);
    const end = new Date(`${availableDate}T${endTime}`);

    let busy: { start: Date; end: Date }[];
    try {
      busy = await this.calendarService.getBusyIntervals(coachId, start, end);
    } catch (err) {
      this.logger.warn(
        `Outlook conflict check failed for coach ${coachId}, proceeding without it: ${(err as Error).message}`,
      );
      return;
    }

    if (busy.some((b) => start < b.end && end > b.start)) {
      throw new BadRequestException(
        "This time conflicts with the coach's Outlook calendar. Please choose another slot.",
      );
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private async getApprovedCoachingRequest(
    requestId: string,
  ): Promise<TokenRequest> {
    const req = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['employee'],
    });
    if (!req) throw new NotFoundException('Token request not found');
    if (req.type !== DevelopmentOptionType.COACHING) {
      throw new BadRequestException('This is not a coaching request');
    }
    if (req.status !== RequestStatus.APPROVED) {
      throw new BadRequestException(
        'Sessions can only be booked after the request is fully approved',
      );
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
        status: In([
          RequestStatus.APPROVED,
          RequestStatus.MANAGER_APPROVED,
          RequestStatus.PENDING,
        ]),
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

  /**
   * Return the current user's coaching sessions (as coach OR employee) as dated
   * calendar events. Excludes cancelled/declined. Powers the navbar calendar.
   */
  async findMyEvents(userId: string): Promise<
    {
      id: string;
      scheduledAt: Date;
      status: CoachingSessionStatus;
      sessionNumber: number;
      role: 'coach' | 'employee';
      title: string;
      counterpartName: string;
      startTime: string | null;
      endTime: string | null;
      teamsJoinUrl: string | null;
    }[]
  > {
    const sessions = await this.sessionRepo.find({
      where: [{ employeeId: userId }, { coachId: userId }],
      relations: [
        'coach',
        'employee',
        'availability',
        'tokenRequest',
        'tokenRequest.developmentOption',
      ],
      order: { scheduledAt: 'ASC' },
    });

    const hidden: CoachingSessionStatus[] = [
      CoachingSessionStatus.CANCELLED,
      CoachingSessionStatus.DECLINED,
    ];

    return sessions
      .filter((s) => !hidden.includes(s.status))
      .map((s) => {
        const isCoach = s.coachId === userId;
        const optionName = s.tokenRequest?.developmentOption?.name ?? 'Coaching';
        const counterpart = isCoach
          ? (s.employee?.fullName ?? 'Employee')
          : (s.coach?.fullName ?? 'Coach');
        return {
          id: s.id,
          scheduledAt: s.scheduledAt,
          status: s.status,
          sessionNumber: s.sessionNumber,
          role: isCoach ? ('coach' as const) : ('employee' as const),
          title: `${optionName} (${counterpart})`,
          counterpartName: counterpart,
          startTime: s.availability?.startTime ?? null,
          endTime: s.availability?.endTime ?? null,
          teamsJoinUrl: s.teamsJoinUrl ?? null,
        };
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

    const formData = request.formData;
    const coachId = formData.coachId as string;

    // Only the employee or the assigned coach can book sessions
    if (callerId !== request.employeeId && callerId !== coachId) {
      throw new ForbiddenException(
        'Only the employee or assigned coach can book sessions',
      );
    }

    // Count active sessions (exclude cancelled, declined, and no-show so the slot can be rebooked)
    const bookedCount = await this.sessionRepo.count({
      where: {
        tokenRequestId: requestId,
        status: Not(
          In([
            CoachingSessionStatus.CANCELLED,
            CoachingSessionStatus.DECLINED,
            CoachingSessionStatus.NO_SHOW,
          ]),
        ),
      },
    });

    if (bookedCount >= SESSIONS_PER_CYCLE) {
      throw new BadRequestException(
        'All 3 sessions for this coaching cycle are already booked',
      );
    }

    // Resolve the slot: either an existing manual slot (availabilityId) or an
    // Outlook-derived time slot (availableDate + startTime + endTime), for which
    // we create a backing availability row so downstream displays stay unchanged.
    let slot: CoachAvailability | null;
    if (dto.availabilityId) {
      slot = await this.availabilityRepo.findOne({
        where: { id: dto.availabilityId },
      });
      if (!slot) throw new NotFoundException('Availability slot not found');
      // This legacy path never went through the Outlook-live getBookableSlots
      // check, so verify it here too.
      await this.assertNoOutlookConflict(
        coachId,
        slot.availableDate,
        slot.startTime,
        slot.endTime,
      );
    } else if (dto.availableDate && dto.startTime && dto.endTime) {
      // Guard against double-booking the coach at this exact time.
      const startAt = new Date(`${dto.availableDate}T${dto.startTime}`);
      const clash = await this.sessionRepo.findOne({
        where: {
          coachId,
          scheduledAt: startAt,
          status: Not(
            In([
              CoachingSessionStatus.CANCELLED,
              CoachingSessionStatus.DECLINED,
              CoachingSessionStatus.NO_SHOW,
            ]),
          ),
        },
      });
      if (clash) {
        throw new BadRequestException('This time slot is no longer available');
      }
      // Re-check Outlook live — the slot list the employee picked from may be
      // stale (fetched before the coach's calendar changed).
      await this.assertNoOutlookConflict(
        coachId,
        dto.availableDate,
        dto.startTime,
        dto.endTime,
      );
      slot = await this.availabilityRepo.save(
        this.availabilityRepo.create({
          coachId,
          availableDate: dto.availableDate,
          startTime: dto.startTime,
          endTime: dto.endTime,
          isBooked: false,
          isActive: true,
        }),
      );
    } else {
      throw new BadRequestException(
        'Provide an availabilityId or a time slot (availableDate, startTime, endTime)',
      );
    }

    if (slot.coachId !== coachId) {
      throw new BadRequestException(
        'The selected slot does not belong to the assigned coach',
      );
    }
    if (slot.isBooked)
      throw new BadRequestException('This slot has already been booked');
    if (!slot.isActive)
      throw new BadRequestException('This slot is no longer available');

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

    let saved: CoachingSession;
    try {
      saved = await this.sessionRepo.save(session);
    } catch (err) {
      // A concurrent request won the race for this exact coach/time —
      // enforced by the partial unique index on (coachId, scheduledAt).
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new BadRequestException('This time slot is no longer available');
      }
      throw err;
    }

    // Notify the coach that a booking request is pending their confirmation
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (coach) {
      this.emailService
        .sendSessionBookingRequestNotification({
          coachEmail: coach.email,
          coachName: coach.fullName,
          employeeName: request.employee.fullName,
          sessionNumber: saved.sessionNumber,
          scheduledAt: saved.scheduledAt,
        })
        .catch(() => {});

      this.notificationsService
        .create(coachId, {
          title: 'Session Booking Request',
          message: `${request.employee.fullName} has requested to book Session ${saved.sessionNumber} with you. Please confirm or decline.`,
          type: NotificationType.INFO,
          requestId: requestId,
          metadata: { deeplink: '/coach/sessions' },
        })
        .catch(() => {});
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
      throw new ForbiddenException(
        'Only the assigned coach can confirm this session',
      );
    }
    if (session.status !== CoachingSessionStatus.PENDING_COACH_APPROVAL) {
      throw new BadRequestException(
        `Session is not pending approval — current status: ${session.status}`,
      );
    }

    session.status = CoachingSessionStatus.SCHEDULED;
    const saved = await this.sessionRepo.save(session);

    // Notify the employee that the coach confirmed their session
    const [employee, coach] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.employeeId } }),
      this.userRepo.findOne({ where: { id: coachId } }),
    ]);
    if (employee && coach) {
      this.emailService
        .sendSessionConfirmedNotification({
          employeeEmail: employee.email,
          employeeName: employee.fullName,
          coachName: coach.fullName,
          sessionNumber: session.sessionNumber,
          scheduledAt: session.scheduledAt,
          requestId,
        })
        .catch(() => {});

      this.notificationsService
        .create(session.employeeId, {
          title: 'Session Confirmed',
          message: `Your Session ${session.sessionNumber} with ${coach.fullName} has been confirmed.`,
          type: NotificationType.SUCCESS,
          requestId: requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
    }

    // Push the confirmed session to the coach's Outlook calendar (best-effort).
    await this.syncSessionToCalendar(saved, coach, employee);

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
      throw new ForbiddenException(
        'Only the assigned coach can decline this session',
      );
    }
    if (session.status !== CoachingSessionStatus.PENDING_COACH_APPROVAL) {
      throw new BadRequestException(
        `Session is not pending approval — current status: ${session.status}`,
      );
    }

    session.status = CoachingSessionStatus.DECLINED;

    // Release the slot so the employee can rebook
    if (session.availabilityId) {
      await this.availabilityRepo.update(session.availabilityId, {
        isBooked: false,
      });
    }

    const saved = await this.sessionRepo.save(session);

    // Notify the employee that the coach declined
    const [employee, coach] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.employeeId } }),
      this.userRepo.findOne({ where: { id: coachId } }),
    ]);
    if (employee && coach) {
      this.emailService
        .sendSessionDeclinedNotification({
          employeeEmail: employee.email,
          employeeName: employee.fullName,
          coachName: coach.fullName,
          sessionNumber: session.sessionNumber,
          scheduledAt: session.scheduledAt,
          requestId,
        })
        .catch(() => {});

      this.notificationsService
        .create(session.employeeId, {
          title: 'Session Booking Declined',
          message: `${coach.fullName} declined your Session ${session.sessionNumber} booking. Please select a different slot.`,
          type: NotificationType.WARNING,
          requestId: requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
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
      throw new ForbiddenException(
        'Only the assigned coach can mark sessions as completed',
      );
    }
    if (session.status !== CoachingSessionStatus.SCHEDULED) {
      throw new BadRequestException(`Session is already ${session.status}`);
    }

    session.status = CoachingSessionStatus.COMPLETED;
    session.completedAt = new Date();
    if (notes) session.sessionNotes = notes;

    const saved = await this.sessionRepo.save(session);

    // Notify the employee that the session was marked complete
    const employee = await this.userRepo.findOne({
      where: { id: session.employeeId },
    });
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (employee && coach) {
      this.emailService
        .sendSessionCompletedNotification({
          employeeEmail: employee.email,
          employeeName: employee.fullName,
          coachName: coach.fullName,
          sessionNumber: session.sessionNumber,
          scheduledAt: session.scheduledAt,
          sessionNotes: saved.sessionNotes,
          requestId,
        })
        .catch(() => {});

      this.notificationsService
        .create(session.employeeId, {
          title: 'Session Completed',
          message: `Session ${session.sessionNumber} with ${coach.fullName} has been marked as completed.`,
          type: NotificationType.SUCCESS,
          requestId: requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
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

    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });
    const formData = request?.formData as Record<string, unknown>;
    const coachId = formData?.coachId as string;

    if (callerId !== session.employeeId && callerId !== coachId) {
      throw new ForbiddenException(
        'Only the employee or coach can cancel a session',
      );
    }
    const cancellable = [
      CoachingSessionStatus.PENDING_COACH_APPROVAL,
      CoachingSessionStatus.SCHEDULED,
    ];
    if (!cancellable.includes(session.status)) {
      throw new BadRequestException(
        `Cannot cancel a session that is already ${session.status}`,
      );
    }

    session.status = CoachingSessionStatus.CANCELLED;

    // Remove the calendar event (best-effort) and clear its references.
    await this.removeSessionFromCalendar(session);
    session.graphEventId = null;
    session.teamsJoinUrl = null;
    session.calendarSyncStatus = null;

    // Release the availability slot so it can be rebooked
    if (session.availabilityId) {
      await this.availabilityRepo.update(session.availabilityId, {
        isBooked: false,
      });
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
      throw new ForbiddenException(
        'Only the assigned coach can mark a no-show',
      );
    }
    if (session.status !== CoachingSessionStatus.SCHEDULED) {
      throw new BadRequestException(`Session is already ${session.status}`);
    }

    session.status = CoachingSessionStatus.NO_SHOW;

    // Release the slot so it can be rebooked by the employee
    if (session.availabilityId) {
      await this.availabilityRepo.update(session.availabilityId, {
        isBooked: false,
      });
    }

    const saved = await this.sessionRepo.save(session);

    // Notify the employee that a no-show was recorded
    const employee = await this.userRepo.findOne({
      where: { id: session.employeeId },
    });
    const coach = await this.userRepo.findOne({ where: { id: coachId } });
    if (employee && coach) {
      this.emailService
        .sendSessionNoShowNotification({
          employeeEmail: employee.email,
          employeeName: employee.fullName,
          coachName: coach.fullName,
          sessionNumber: session.sessionNumber,
          scheduledAt: session.scheduledAt,
          requestId,
        })
        .catch(() => {});

      this.notificationsService
        .create(session.employeeId, {
          title: 'Session No-Show Recorded',
          message: `A no-show was recorded for your Session ${session.sessionNumber} with ${coach.fullName}. Please reschedule.`,
          type: NotificationType.WARNING,
          requestId: requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
    }

    return saved;
  }
}
