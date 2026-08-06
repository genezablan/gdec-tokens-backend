import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Not, QueryFailedError, Repository } from 'typeorm';
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
import { RequestCancelSessionDto } from './dto/request-cancel-session.dto';
import { ProposeSessionTimeDto } from './dto/propose-session-time.dto';
import { RejectProposalDto } from './dto/reject-proposal.dto';
import { RequestNewTimeDto } from './dto/request-new-time.dto';
import { EmailService } from '../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../entities/notification.entity';
import { CalendarService } from '../calendar/calendar.service';
import { wallClockToUtc } from '../common/utils/timezone';

const SESSIONS_PER_CYCLE = 3;
const DEFAULT_SESSION_MINUTES = 60;

/** Statuses that no longer hold their time slot (safe to book over). */
const RELEASED_STATUSES = [
  CoachingSessionStatus.CANCELLED,
  CoachingSessionStatus.DECLINED,
  CoachingSessionStatus.NO_SHOW,
];

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
    let slot: CoachAvailability | null = null;
    if (session.availabilityId) {
      slot = await this.availabilityRepo.findOne({
        where: { id: session.availabilityId },
      });
    }
    const end = this.sessionEndOf(session.scheduledAt, slot);

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
      // Teams meeting still provisioning on Graph's side — pick the join URL
      // up in the background so it lands before anyone opens the session view.
      if (!joinUrl) this.scheduleJoinUrlBackfill(session.id, coach.id, eventId);
    } catch (err) {
      session.calendarSyncStatus = 'failed';
      await this.sessionRepo.save(session);
      this.logger.error(
        `Failed to sync session ${session.id} to calendar: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Re-read the event after a delay to attach a join URL that wasn't ready at
   * creation time. Fire-and-forget: a miss just leaves teamsJoinUrl null.
   */
  private scheduleJoinUrlBackfill(
    sessionId: string,
    coachId: string,
    eventId: string,
  ): void {
    setTimeout(() => {
      void (async () => {
        try {
          const joinUrl = await this.calendarService.fetchEventJoinUrl(
            coachId,
            eventId,
          );
          if (joinUrl) {
            await this.sessionRepo.update(
              { id: sessionId },
              { teamsJoinUrl: joinUrl },
            );
          }
        } catch (err) {
          this.logger.warn(
            `Join URL backfill failed for session ${sessionId}: ${(err as Error).message}`,
          );
        }
      })();
    }, 10_000);
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
   *
   * Throws on a genuine clash. Returns whether the check actually ran, so the
   * caller can mark the session as unverified — failing open is a deliberate
   * availability trade-off, but it should never be silent.
   */
  private async assertNoOutlookConflict(
    coachId: string,
    availableDate: string,
    startTime: string,
    endTime: string,
  ): Promise<{ checkFailed: boolean }> {
    // Nothing to check against — the coach's calendar isn't linked. That's a
    // visible state of its own, not a failed check.
    if (!(await this.calendarService.isConnected(coachId)))
      return { checkFailed: false };
    // Slots are business-timezone wall clocks; Graph answers in real UTC. Resolve
    // them the same way or the two sides compare different hours entirely.
    const start = wallClockToUtc(availableDate, startTime);
    const end = wallClockToUtc(availableDate, endTime);

    let busy: { start: Date; end: Date }[];
    try {
      busy = await this.calendarService.getBusyIntervals(coachId, start, end);
    } catch (err) {
      this.logger.warn(
        `Outlook conflict check failed for coach ${coachId}, proceeding without it: ${(err as Error).message}`,
      );
      return { checkFailed: true };
    }

    if (busy.some((b) => start < b.end && end > b.start)) {
      throw new BadRequestException(
        "This time conflicts with the coach's Outlook calendar. Please choose another slot.",
      );
    }
    return { checkFailed: false };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  /** Session end = booked slot's end when known, else start + default duration. */
  private sessionEndOf(
    scheduledAt: Date,
    slot: CoachAvailability | null | undefined,
  ): Date {
    if (slot?.endTime && slot?.availableDate) {
      const end = wallClockToUtc(slot.availableDate, slot.endTime);
      if (!Number.isNaN(end.getTime()) && end > scheduledAt) return end;
    }
    return new Date(scheduledAt.getTime() + DEFAULT_SESSION_MINUTES * 60_000);
  }

  /**
   * Find a session for the given coach or employee whose time range overlaps
   * [startAt, endAt). Sessions store only a start timestamp, so candidates are
   * pre-filtered to a day-wide window and each end is derived from its slot.
   */
  private async findOverlappingSession(
    scope: { coachId: string } | { employeeId: string },
    startAt: Date,
    endAt: Date,
    opts: {
      excludeStatuses: CoachingSessionStatus[];
      excludeSessionId?: string;
    },
  ): Promise<CoachingSession | null> {
    const windowStart = new Date(startAt.getTime() - 24 * 60 * 60_000);
    const candidates = await this.sessionRepo.find({
      where: {
        ...scope,
        status: Not(In(opts.excludeStatuses)),
        scheduledAt: Between(windowStart, endAt),
      },
      relations: ['availability'],
    });
    return (
      candidates.find(
        (s) =>
          s.id !== opts.excludeSessionId &&
          s.scheduledAt < endAt && // Between is end-inclusive
          this.sessionEndOf(s.scheduledAt, s.availability) > startAt,
      ) ?? null
    );
  }

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
      // A number accumulates a row per released attempt, so sessionNumber alone
      // isn't a total order — without the tiebreaker, rows sharing a number come
      // back in whatever order Postgres feels like, and the client can't tell
      // which attempt is the latest.
      order: { sessionNumber: 'ASC', createdAt: 'ASC' },
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
        const optionName =
          s.tokenRequest?.developmentOption?.name ?? 'Coaching';
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

    // Which numbers in the cycle are still held? Released sessions (cancelled,
    // declined, no-show) give their number back so it can be rebooked.
    //
    // This must be resolved by *number*, not by count: releasing session 1 while
    // 2 and 3 are still active leaves a count of 2, and numbering the rebooking
    // `count + 1` would hand out 3 a second time instead of refilling the gap.
    const activeSessions = await this.sessionRepo.find({
      where: {
        tokenRequestId: requestId,
        status: Not(In(RELEASED_STATUSES)),
      },
      select: ['sessionNumber'],
    });
    const takenNumbers = new Set(activeSessions.map((s) => s.sessionNumber));
    const freeNumbers = Array.from(
      { length: SESSIONS_PER_CYCLE },
      (_, i) => i + 1,
    ).filter((n) => !takenNumbers.has(n));

    if (freeNumbers.length === 0) {
      throw new BadRequestException(
        `All ${SESSIONS_PER_CYCLE} sessions for this coaching cycle are already booked`,
      );
    }

    // Honour the session the caller actually clicked; fall back to the lowest
    // free slot for callers that don't specify one.
    let sessionNumber: number;
    if (dto.sessionNumber === undefined) {
      sessionNumber = freeNumbers[0];
    } else if (dto.sessionNumber > SESSIONS_PER_CYCLE) {
      throw new BadRequestException(
        `Session number must be between 1 and ${SESSIONS_PER_CYCLE}`,
      );
    } else if (takenNumbers.has(dto.sessionNumber)) {
      throw new BadRequestException(
        `Session ${dto.sessionNumber} is already booked`,
      );
    } else {
      sessionNumber = dto.sessionNumber;
    }

    // Resolve the slot: either an existing manual slot (availabilityId) or an
    // Outlook-derived time slot (availableDate + startTime + endTime), for which
    // we create a backing availability row so downstream displays stay unchanged.
    let slot: CoachAvailability | null;
    // Carried onto the session so the coach can see the slot was taken without
    // our being able to read their calendar.
    let outlookCheckFailed = false;
    if (dto.availabilityId) {
      slot = await this.availabilityRepo.findOne({
        where: { id: dto.availabilityId },
      });
      if (!slot) throw new NotFoundException('Availability slot not found');
      // This legacy path never went through the Outlook-live getBookableSlots
      // check, so verify it here too.
      ({ checkFailed: outlookCheckFailed } = await this.assertNoOutlookConflict(
        coachId,
        slot.availableDate,
        slot.startTime,
        slot.endTime,
      ));
    } else if (dto.availableDate && dto.startTime && dto.endTime) {
      // Re-check Outlook live — the slot list the employee picked from may be
      // stale (fetched before the coach's calendar changed).
      ({ checkFailed: outlookCheckFailed } = await this.assertNoOutlookConflict(
        coachId,
        dto.availableDate,
        dto.startTime,
        dto.endTime,
      ));
      // Not saved yet — inserted below only once every conflict check has
      // passed, so a rejected booking leaves no orphan slot row.
      slot = this.availabilityRepo.create({
        coachId,
        availableDate: dto.availableDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isBooked: false,
        isActive: true,
      });
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

    // Build scheduledAt from date + startTime. The slot is a business-timezone
    // wall clock, so it must be resolved against that zone rather than the
    // server's — otherwise the stored instant drifts with wherever this runs.
    const scheduledAt = wallClockToUtc(slot.availableDate, slot.startTime);
    if (scheduledAt < new Date()) {
      throw new BadRequestException('Cannot book a slot in the past');
    }

    // Conflict detection: interval overlap (not exact-time equality — session
    // durations vary per coach), for the coach and the employee alike. An
    // employee holding cycles with two different coaches must not be able to
    // book both at the same time.
    const sessionEnd = this.sessionEndOf(scheduledAt, slot);
    const coachClash = await this.findOverlappingSession(
      { coachId },
      scheduledAt,
      sessionEnd,
      { excludeStatuses: RELEASED_STATUSES },
    );
    if (coachClash) {
      throw new BadRequestException('This time slot is no longer available');
    }
    const employeeClash = await this.findOverlappingSession(
      { employeeId: request.employeeId },
      scheduledAt,
      sessionEnd,
      { excludeStatuses: RELEASED_STATUSES },
    );
    if (employeeClash) {
      throw new BadRequestException(
        callerId === request.employeeId
          ? 'You already have a coaching session that overlaps this time. Please choose another slot.'
          : 'The employee already has a coaching session that overlaps this time. Please choose another slot.',
      );
    }

    // Mark slot as booked
    slot.isBooked = true;
    await this.availabilityRepo.save(slot);

    const session = this.sessionRepo.create({
      tokenRequestId: requestId,
      coachId,
      employeeId: request.employeeId,
      availabilityId: slot.id,
      sessionNumber,
      scheduledAt,
      outlookCheckFailed,
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
      relations: ['availability'],
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

    // Backstop: overlapping bookings can coexist while pending (or predate
    // conflict detection), so re-check against sessions that hold their time
    // before locking this one in. Pending requests don't block each other
    // here — otherwise two overlapping pendings could never both resolve.
    const sessionEnd = this.sessionEndOf(
      session.scheduledAt,
      session.availability,
    );
    const confirmBlockers = {
      excludeStatuses: [
        ...RELEASED_STATUSES,
        CoachingSessionStatus.PENDING_COACH_APPROVAL,
      ],
      excludeSessionId: session.id,
    };
    const clash =
      (await this.findOverlappingSession(
        { coachId: session.coachId },
        session.scheduledAt,
        sessionEnd,
        confirmBlockers,
      )) ??
      (await this.findOverlappingSession(
        { employeeId: session.employeeId },
        session.scheduledAt,
        sessionEnd,
        confirmBlockers,
      ));
    if (clash) {
      throw new BadRequestException(
        'This session overlaps another scheduled session. Please decline it so a different time can be booked.',
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

  // ─── Cancel a pending (unconfirmed) booking ───────────────────────────────────

  /**
   * Withdraw a booking that hasn't been confirmed yet. Either the employee or
   * the coach can do this unilaterally — nothing has been mutually committed
   * to yet (no calendar sync), so no consent step is needed here. This is the
   * employee-side counterpart to the coach's declineSession(); for an already
   * SCHEDULED (coach-confirmed) session, use requestCancelSession() instead,
   * which requires the other party's approval.
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

    if (callerId !== session.employeeId && callerId !== session.coachId) {
      throw new ForbiddenException(
        'Only the employee or coach can cancel a session',
      );
    }
    if (session.status !== CoachingSessionStatus.PENDING_COACH_APPROVAL) {
      throw new BadRequestException(
        session.status === CoachingSessionStatus.SCHEDULED
          ? 'This session is already confirmed — request cancellation instead, which requires the other party to approve it'
          : `Cannot cancel a session that is already ${session.status}`,
      );
    }

    session.status = CoachingSessionStatus.CANCELLED;

    // Release the availability slot so it can be rebooked
    if (session.availabilityId) {
      await this.availabilityRepo.update(session.availabilityId, {
        isBooked: false,
      });
    }

    const saved = await this.sessionRepo.save(session);

    // Notify whichever party didn't initiate the cancellation.
    const otherPartyId =
      callerId === session.employeeId ? session.coachId : session.employeeId;
    const [caller, otherParty] = await Promise.all([
      this.userRepo.findOne({ where: { id: callerId } }),
      this.userRepo.findOne({ where: { id: otherPartyId } }),
    ]);
    if (caller && otherParty) {
      this.notificationsService
        .create(otherPartyId, {
          title: 'Session Booking Cancelled',
          message: `${caller.fullName} cancelled the pending Session ${session.sessionNumber} booking.`,
          type: NotificationType.WARNING,
          requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
    }

    return saved;
  }

  // ─── Cancel a scheduled session (mutual consent) ──────────────────────────────

  /**
   * Either party requests to cancel a SCHEDULED (coach-confirmed) session.
   * Doesn't cancel immediately — moves to PENDING_CANCELLATION and notifies
   * the other party, who must approveCancelSession() or declineCancelSession().
   */
  async requestCancelSession(
    requestId: string,
    sessionId: string,
    callerId: string,
    dto: RequestCancelSessionDto,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (callerId !== session.employeeId && callerId !== session.coachId) {
      throw new ForbiddenException(
        'Only the employee or coach can request to cancel a session',
      );
    }
    if (session.status !== CoachingSessionStatus.SCHEDULED) {
      throw new BadRequestException(
        `Cannot request cancellation — session is ${session.status}`,
      );
    }

    session.statusBeforeCancellation = session.status;
    session.status = CoachingSessionStatus.PENDING_CANCELLATION;
    session.cancelRequestedById = callerId;
    session.cancelReason = dto.reason?.trim() || null;
    const saved = await this.sessionRepo.save(session);

    const otherPartyId =
      callerId === session.employeeId ? session.coachId : session.employeeId;
    const [requester, otherParty] = await Promise.all([
      this.userRepo.findOne({ where: { id: callerId } }),
      this.userRepo.findOne({ where: { id: otherPartyId } }),
    ]);
    if (requester && otherParty) {
      this.emailService
        .sendSessionCancelRequestedNotification({
          recipientEmail: otherParty.email,
          recipientName: otherParty.fullName,
          requesterName: requester.fullName,
          sessionNumber: session.sessionNumber,
          scheduledAt: session.scheduledAt,
          reason: session.cancelReason,
          requestId,
        })
        .catch(() => {});

      this.notificationsService
        .create(otherPartyId, {
          title: 'Session Cancellation Requested',
          message: `${requester.fullName} requested to cancel Session ${session.sessionNumber}. Please approve or keep the session.`,
          type: NotificationType.WARNING,
          requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
    }

    return saved;
  }

  /**
   * The other party approves a pending cancellation request — finalizes it.
   * Only the party who did NOT request the cancellation can approve it.
   */
  async approveCancelSession(
    requestId: string,
    sessionId: string,
    callerId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== CoachingSessionStatus.PENDING_CANCELLATION) {
      throw new BadRequestException(
        'This session has no pending cancellation request',
      );
    }
    if (callerId !== session.employeeId && callerId !== session.coachId) {
      throw new ForbiddenException(
        'Only the employee or coach can respond to this cancellation request',
      );
    }
    if (callerId === session.cancelRequestedById) {
      throw new ForbiddenException(
        'Waiting for the other party to respond to your cancellation request',
      );
    }

    const requesterId = session.cancelRequestedById;

    session.status = CoachingSessionStatus.CANCELLED;
    session.statusBeforeCancellation = null;

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

    const saved = await this.sessionRepo.save(session);

    if (requesterId) {
      const [requester, approver] = await Promise.all([
        this.userRepo.findOne({ where: { id: requesterId } }),
        this.userRepo.findOne({ where: { id: callerId } }),
      ]);
      if (requester && approver) {
        this.emailService
          .sendSessionCancelApprovedNotification({
            recipientEmail: requester.email,
            recipientName: requester.fullName,
            approverName: approver.fullName,
            sessionNumber: session.sessionNumber,
            scheduledAt: session.scheduledAt,
          })
          .catch(() => {});

        this.notificationsService
          .create(requesterId, {
            title: 'Session Cancelled',
            message: `${approver.fullName} approved your request to cancel Session ${session.sessionNumber}.`,
            type: NotificationType.INFO,
            requestId,
            metadata: { deeplink: `/coaching/${requestId}/sessions` },
          })
          .catch(() => {});
      }
    }

    return saved;
  }

  /**
   * Decline a pending cancellation request — reverts to the prior status.
   * Callable by the other party (declining the request) or by the requester
   * themself (withdrawing it before the other party responds). Only notifies
   * the requester when the OTHER party declined — no need to notify yourself
   * that you withdrew your own request.
   */
  async declineCancelSession(
    requestId: string,
    sessionId: string,
    callerId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== CoachingSessionStatus.PENDING_CANCELLATION) {
      throw new BadRequestException(
        'This session has no pending cancellation request',
      );
    }
    if (callerId !== session.employeeId && callerId !== session.coachId) {
      throw new ForbiddenException(
        'Only the employee or coach can respond to this cancellation request',
      );
    }

    const requesterId = session.cancelRequestedById;
    const wasWithdrawnByRequester = callerId === requesterId;

    session.status =
      session.statusBeforeCancellation ?? CoachingSessionStatus.SCHEDULED;
    session.statusBeforeCancellation = null;
    session.cancelRequestedById = null;
    session.cancelReason = null;
    const saved = await this.sessionRepo.save(session);

    if (!wasWithdrawnByRequester && requesterId) {
      const [requester, decliner] = await Promise.all([
        this.userRepo.findOne({ where: { id: requesterId } }),
        this.userRepo.findOne({ where: { id: callerId } }),
      ]);
      if (requester && decliner) {
        this.emailService
          .sendSessionCancelDeclinedNotification({
            recipientEmail: requester.email,
            recipientName: requester.fullName,
            declinerName: decliner.fullName,
            sessionNumber: session.sessionNumber,
            scheduledAt: session.scheduledAt,
            requestId,
          })
          .catch(() => {});

        this.notificationsService
          .create(requesterId, {
            title: 'Cancellation Request Declined',
            message: `${decliner.fullName} declined your request to cancel Session ${session.sessionNumber}. The session remains scheduled.`,
            type: NotificationType.INFO,
            requestId,
            metadata: { deeplink: `/coaching/${requestId}/sessions` },
          })
          .catch(() => {});
      }
    }

    return saved;
  }

  // ─── Coach counter-proposal ───────────────────────────────────────────────────

  /** Statuses a coach may counter-propose a (new) time from. */
  private static readonly PROPOSABLE_STATUSES = [
    CoachingSessionStatus.PENDING_COACH_APPROVAL, // instead of confirm/decline
    CoachingSessionStatus.SCHEDULED, // reschedule instead of cancelling
    CoachingSessionStatus.PENDING_CANCELLATION, // instead of approving the cancel
    CoachingSessionStatus.PENDING_EMPLOYEE_APPROVAL, // re-propose (negotiation loop)
    CoachingSessionStatus.NO_SHOW, // offer a replacement slot after a no-show
  ];

  /** Null out every proposal field. Does NOT touch the cancellation fields. */
  private clearProposalFields(session: CoachingSession): void {
    session.proposedDate = null;
    session.proposedStartTime = null;
    session.proposedEndTime = null;
    session.proposalNote = null;
    session.employeeProposalNote = null;
    session.proposalReturnedAt = null;
    session.statusBeforeProposal = null;
  }

  /**
   * Coach proposes a (new) time for a session. The session keeps its ORIGINAL
   * scheduledAt/availabilityId (and any in-flight cancellation fields) until
   * the employee accepts — the proposal itself holds nothing.
   * Also valid while already PENDING_EMPLOYEE_APPROVAL: re-proposing overwrites
   * the previous proposal (the "employee asked for another date" loop).
   */
  async proposeSessionTime(
    requestId: string,
    sessionId: string,
    coachId: string,
    dto: ProposeSessionTimeDto,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.coachId !== coachId) {
      throw new ForbiddenException(
        'Only the assigned coach can propose a new time for this session',
      );
    }
    if (!CoachingSessionsService.PROPOSABLE_STATUSES.includes(session.status)) {
      throw new BadRequestException(
        `Cannot propose a new time — session is ${session.status}`,
      );
    }

    // Proposing from a released status (no-show) revives that session, which
    // reclaims its number in the cycle. Refuse if the employee already rebooked
    // that slot, so a cycle never ends up with two active session 1s.
    if (RELEASED_STATUSES.includes(session.status)) {
      const alreadyRebooked = await this.sessionRepo.count({
        where: {
          tokenRequestId: requestId,
          sessionNumber: session.sessionNumber,
          status: Not(In(RELEASED_STATUSES)),
        },
      });
      if (alreadyRebooked > 0) {
        throw new BadRequestException(
          `Session ${session.sessionNumber} has already been rebooked`,
        );
      }
    }

    // Resolve the proposed time: an existing manual slot or an Outlook-derived
    // trio. Either way it's only a time pick here — no slot is held until the
    // employee accepts (accept creates its own backing availability row).
    let proposedDate: string;
    let proposedStartTime: string;
    let proposedEndTime: string;
    if (dto.availabilityId) {
      const slot = await this.availabilityRepo.findOne({
        where: { id: dto.availabilityId },
      });
      if (!slot) throw new NotFoundException('Availability slot not found');
      if (slot.coachId !== coachId) {
        throw new BadRequestException(
          'The selected slot does not belong to you',
        );
      }
      if (slot.isBooked)
        throw new BadRequestException('This slot has already been booked');
      if (!slot.isActive)
        throw new BadRequestException('This slot is no longer available');
      proposedDate = slot.availableDate;
      proposedStartTime = slot.startTime;
      proposedEndTime = slot.endTime;
    } else if (dto.availableDate && dto.startTime && dto.endTime) {
      proposedDate = dto.availableDate;
      proposedStartTime = dto.startTime;
      proposedEndTime = dto.endTime;
    } else {
      throw new BadRequestException(
        'Provide an availabilityId or a time slot (availableDate, startTime, endTime)',
      );
    }

    const proposedStart = wallClockToUtc(proposedDate, proposedStartTime);
    if (proposedStart < new Date()) {
      throw new BadRequestException('Cannot propose a time in the past');
    }
    if (proposedStart.getTime() === session.scheduledAt.getTime()) {
      throw new BadRequestException(
        'The proposed time is the same as the current session time',
      );
    }

    // Advisory checks (authoritative re-check happens at accept): the coach's
    // Outlook plus both parties' existing sessions.
    await this.assertNoOutlookConflict(
      coachId,
      proposedDate,
      proposedStartTime,
      proposedEndTime,
    );
    const proposedEnd = wallClockToUtc(proposedDate, proposedEndTime);
    const proposeBlockers = {
      excludeStatuses: RELEASED_STATUSES,
      excludeSessionId: session.id,
    };
    const clash =
      (await this.findOverlappingSession(
        { coachId },
        proposedStart,
        proposedEnd,
        proposeBlockers,
      )) ??
      (await this.findOverlappingSession(
        { employeeId: session.employeeId },
        proposedStart,
        proposedEnd,
        proposeBlockers,
      ));
    if (clash) {
      throw new BadRequestException(
        'This time overlaps another coaching session. Please choose a different one.',
      );
    }

    // First proposal records where to revert to; a re-propose keeps it.
    if (session.status !== CoachingSessionStatus.PENDING_EMPLOYEE_APPROVAL) {
      session.statusBeforeProposal = session.status;
      session.status = CoachingSessionStatus.PENDING_EMPLOYEE_APPROVAL;
    }
    session.proposedDate = proposedDate;
    session.proposedStartTime = proposedStartTime;
    session.proposedEndTime = proposedEndTime;
    session.proposalNote = dto.note?.trim() || null;
    session.proposalReturnedAt = null;
    session.employeeProposalNote = null;
    const saved = await this.sessionRepo.save(session);

    const [employee, coach] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.employeeId } }),
      this.userRepo.findOne({ where: { id: coachId } }),
    ]);
    if (employee && coach) {
      this.emailService
        .sendSessionTimeProposedNotification({
          employeeEmail: employee.email,
          employeeName: employee.fullName,
          coachName: coach.fullName,
          sessionNumber: session.sessionNumber,
          currentScheduledAt: session.scheduledAt,
          proposedAt: proposedStart,
          note: saved.proposalNote,
          requestId,
        })
        .catch(() => {});

      this.notificationsService
        .create(session.employeeId, {
          title: 'New Session Time Proposed',
          message: `${coach.fullName} proposed a new time for Session ${session.sessionNumber}. Please review and respond.`,
          type: NotificationType.INFO,
          requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
    }

    return saved;
  }

  /**
   * Employee accepts the coach's proposed time — the session moves to the new
   * time and becomes SCHEDULED. The old slot is released, a backing slot row
   * is created for the new time, and the calendar event is recreated.
   * Any in-flight cancellation request is resolved by the agreement.
   */
  async acceptProposedTime(
    requestId: string,
    sessionId: string,
    callerId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== CoachingSessionStatus.PENDING_EMPLOYEE_APPROVAL) {
      throw new BadRequestException(
        'This session has no pending time proposal',
      );
    }
    if (callerId !== session.employeeId) {
      throw new ForbiddenException(
        'Only the employee can respond to a proposed session time',
      );
    }
    if (
      !session.proposedDate ||
      !session.proposedStartTime ||
      !session.proposedEndTime
    ) {
      throw new BadRequestException(
        'This session has no pending time proposal',
      );
    }

    const newStart = wallClockToUtc(
      session.proposedDate,
      session.proposedStartTime,
    );
    if (newStart < new Date()) {
      throw new BadRequestException(
        'The proposed time has already passed — please ask your coach for a new one.',
      );
    }
    let newEnd = wallClockToUtc(session.proposedDate, session.proposedEndTime);
    if (Number.isNaN(newEnd.getTime()) || newEnd <= newStart) {
      newEnd = new Date(newStart.getTime() + DEFAULT_SESSION_MINUTES * 60_000);
    }

    // Authoritative re-checks before locking the new time in (mirrors confirm:
    // pending bookings don't block, sessions that hold their time do).
    // This is the time the session actually ends up at, so its verification
    // state replaces whatever the original booking recorded.
    ({ checkFailed: session.outlookCheckFailed } =
      await this.assertNoOutlookConflict(
        session.coachId,
        session.proposedDate,
        session.proposedStartTime,
        session.proposedEndTime,
      ));
    const acceptBlockers = {
      excludeStatuses: [
        ...RELEASED_STATUSES,
        CoachingSessionStatus.PENDING_COACH_APPROVAL,
      ],
      excludeSessionId: session.id,
    };
    const clash =
      (await this.findOverlappingSession(
        { coachId: session.coachId },
        newStart,
        newEnd,
        acceptBlockers,
      )) ??
      (await this.findOverlappingSession(
        { employeeId: session.employeeId },
        newStart,
        newEnd,
        acceptBlockers,
      ));
    if (clash) {
      throw new BadRequestException(
        'This time now overlaps another session. Please ask your coach for a new one.',
      );
    }

    // Create the backing slot row for the new time first, so a failure leaves
    // the session untouched at its original time.
    const newSlot = await this.availabilityRepo.save(
      this.availabilityRepo.create({
        coachId: session.coachId,
        availableDate: session.proposedDate,
        startTime: session.proposedStartTime,
        endTime: session.proposedEndTime,
        isBooked: true,
        isActive: true,
      }),
    );

    const oldAvailabilityId = session.availabilityId;
    const hadCalendarEvent = !!session.graphEventId;

    session.scheduledAt = newStart;
    session.availabilityId = newSlot.id;
    session.status = CoachingSessionStatus.SCHEDULED;
    this.clearProposalFields(session);
    // Agreeing on a new time settles any in-flight cancellation request.
    session.cancelRequestedById = null;
    session.cancelReason = null;
    session.statusBeforeCancellation = null;

    let saved: CoachingSession;
    try {
      saved = await this.sessionRepo.save(session);
    } catch (err) {
      // A concurrent booking won the race for this exact coach/time —
      // enforced by the partial unique index on (coachId, scheduledAt).
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        await this.availabilityRepo.delete(newSlot.id).catch(() => {});
        throw new BadRequestException(
          'This time is no longer available. Please ask your coach for a new one.',
        );
      }
      throw err;
    }

    // Only after the session is safely on its new time, release the old slot.
    if (oldAvailabilityId) {
      await this.availabilityRepo.update(oldAvailabilityId, {
        isBooked: false,
      });
    }

    const [coach, employee] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.coachId } }),
      this.userRepo.findOne({ where: { id: session.employeeId } }),
    ]);

    // Recreate the calendar event at the new time (Graph has no update API
    // here — cancel + create). Best-effort, like every other calendar touch.
    if (hadCalendarEvent) {
      await this.removeSessionFromCalendar(saved);
      saved.graphEventId = null;
      saved.teamsJoinUrl = null;
      saved.calendarSyncStatus = null;
      saved = await this.sessionRepo.save(saved);
    }
    await this.syncSessionToCalendar(saved, coach, employee);

    if (coach && employee) {
      this.emailService
        .sendProposalAcceptedNotification({
          coachEmail: coach.email,
          coachName: coach.fullName,
          employeeName: employee.fullName,
          sessionNumber: saved.sessionNumber,
          scheduledAt: saved.scheduledAt,
        })
        .catch(() => {});

      this.notificationsService
        .create(saved.coachId, {
          title: 'Proposed Session Time Accepted',
          message: `${employee.fullName} accepted your proposed time for Session ${saved.sessionNumber}. The session is now scheduled.`,
          type: NotificationType.SUCCESS,
          requestId,
          metadata: { deeplink: '/coach/sessions' },
        })
        .catch(() => {});
    }

    return saved;
  }

  /**
   * Employee rejects the coach's proposed time. The outcome depends on where
   * the proposal came from (statusBeforeProposal):
   * - pending_coach_approval → DECLINED (slot released, employee can re-book)
   * - scheduled → back to SCHEDULED at the original, untouched time
   * - pending_cancellation → CANCELLED (the cancellation proceeds, full cleanup)
   */
  async rejectProposedTime(
    requestId: string,
    sessionId: string,
    callerId: string,
    dto: RejectProposalDto,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== CoachingSessionStatus.PENDING_EMPLOYEE_APPROVAL) {
      throw new BadRequestException(
        'This session has no pending time proposal',
      );
    }
    if (callerId !== session.employeeId) {
      throw new ForbiddenException(
        'Only the employee can respond to a proposed session time',
      );
    }

    const origin =
      session.statusBeforeProposal ?? CoachingSessionStatus.SCHEDULED;
    let outcome: 'declined' | 'reverted' | 'cancelled';

    if (origin === CoachingSessionStatus.PENDING_COACH_APPROVAL) {
      // The underlying booking request dies with the proposal.
      session.status = CoachingSessionStatus.DECLINED;
      if (session.availabilityId) {
        await this.availabilityRepo.update(session.availabilityId, {
          isBooked: false,
        });
      }
      outcome = 'declined';
    } else if (origin === CoachingSessionStatus.PENDING_CANCELLATION) {
      // The cancellation the proposal tried to avert now proceeds.
      session.status = CoachingSessionStatus.CANCELLED;
      await this.removeSessionFromCalendar(session);
      session.graphEventId = null;
      session.teamsJoinUrl = null;
      session.calendarSyncStatus = null;
      if (session.availabilityId) {
        await this.availabilityRepo.update(session.availabilityId, {
          isBooked: false,
        });
      }
      session.cancelRequestedById = null;
      session.cancelReason = null;
      session.statusBeforeCancellation = null;
      outcome = 'cancelled';
    } else {
      // Confirmed session stays exactly as it was.
      session.status = CoachingSessionStatus.SCHEDULED;
      outcome = 'reverted';
    }

    this.clearProposalFields(session);
    const saved = await this.sessionRepo.save(session);

    const [coach, employee] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.coachId } }),
      this.userRepo.findOne({ where: { id: session.employeeId } }),
    ]);
    if (coach && employee) {
      const reason = dto.reason?.trim() || null;
      this.emailService
        .sendProposalRejectedNotification({
          coachEmail: coach.email,
          coachName: coach.fullName,
          employeeName: employee.fullName,
          sessionNumber: saved.sessionNumber,
          outcome,
          reason,
          requestId,
        })
        .catch(() => {});

      const outcomeCopy =
        outcome === 'declined'
          ? 'The booking request has been declined.'
          : outcome === 'cancelled'
            ? 'The session has been cancelled.'
            : 'The session stays at its original time.';
      this.notificationsService
        .create(saved.coachId, {
          title: 'Proposed Session Time Rejected',
          message: `${employee.fullName} rejected your proposed time for Session ${saved.sessionNumber}. ${outcomeCopy}`,
          type: NotificationType.WARNING,
          requestId,
          metadata: { deeplink: '/coach/sessions' },
        })
        .catch(() => {});
    }

    return saved;
  }

  /**
   * Employee sends the proposal back, asking the coach for a different time.
   * The session stays PENDING_EMPLOYEE_APPROVAL — proposalReturnedAt flips
   * whose turn it is, and the coach re-proposes (or withdraws).
   */
  async requestAnotherTime(
    requestId: string,
    sessionId: string,
    callerId: string,
    dto: RequestNewTimeDto,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== CoachingSessionStatus.PENDING_EMPLOYEE_APPROVAL) {
      throw new BadRequestException(
        'This session has no pending time proposal',
      );
    }
    if (callerId !== session.employeeId) {
      throw new ForbiddenException(
        'Only the employee can respond to a proposed session time',
      );
    }
    if (session.proposalReturnedAt) {
      throw new BadRequestException(
        'You already asked for a different time — waiting for the coach to propose one.',
      );
    }

    session.proposalReturnedAt = new Date();
    session.employeeProposalNote = dto.note?.trim() || null;
    const saved = await this.sessionRepo.save(session);

    const [coach, employee] = await Promise.all([
      this.userRepo.findOne({ where: { id: session.coachId } }),
      this.userRepo.findOne({ where: { id: session.employeeId } }),
    ]);
    if (coach && employee) {
      this.emailService
        .sendNewTimeRequestedNotification({
          coachEmail: coach.email,
          coachName: coach.fullName,
          employeeName: employee.fullName,
          sessionNumber: saved.sessionNumber,
          note: saved.employeeProposalNote,
        })
        .catch(() => {});

      this.notificationsService
        .create(saved.coachId, {
          title: 'Different Session Time Requested',
          message: `${employee.fullName} asked for a different time for Session ${saved.sessionNumber}. Please propose a new one.`,
          type: NotificationType.INFO,
          requestId,
          metadata: { deeplink: '/coach/sessions' },
        })
        .catch(() => {});
    }

    return saved;
  }

  /**
   * Coach withdraws their pending proposal — the session reverts to whatever
   * it was before (pending booking, scheduled, or pending cancellation; any
   * in-flight cancellation fields were left untouched, so that flow resumes).
   */
  async withdrawProposedTime(
    requestId: string,
    sessionId: string,
    coachId: string,
  ): Promise<CoachingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tokenRequestId: requestId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== CoachingSessionStatus.PENDING_EMPLOYEE_APPROVAL) {
      throw new BadRequestException(
        'This session has no pending time proposal',
      );
    }
    if (session.coachId !== coachId) {
      throw new ForbiddenException(
        'Only the assigned coach can withdraw this proposal',
      );
    }

    session.status =
      session.statusBeforeProposal ?? CoachingSessionStatus.SCHEDULED;
    this.clearProposalFields(session);
    const saved = await this.sessionRepo.save(session);

    const [coach, employee] = await Promise.all([
      this.userRepo.findOne({ where: { id: coachId } }),
      this.userRepo.findOne({ where: { id: session.employeeId } }),
    ]);
    if (coach && employee) {
      this.emailService
        .sendProposalWithdrawnNotification({
          employeeEmail: employee.email,
          employeeName: employee.fullName,
          coachName: coach.fullName,
          sessionNumber: saved.sessionNumber,
          requestId,
        })
        .catch(() => {});

      this.notificationsService
        .create(saved.employeeId, {
          title: 'Session Time Proposal Withdrawn',
          message: `${coach.fullName} withdrew their proposed time for Session ${saved.sessionNumber}.`,
          type: NotificationType.INFO,
          requestId,
          metadata: { deeplink: `/coaching/${requestId}/sessions` },
        })
        .catch(() => {});
    }

    return saved;
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
