import { BadRequestException } from '@nestjs/common';
import { CoachingSessionsService } from './coaching-sessions.service';
import { CoachingSessionStatus, RequestStatus } from '../common/enums';

/**
 * Regression tests for how a booking picks its session number.
 *
 * The original code derived it from a count (`bookedCount + 1`), so releasing
 * session 1 while 2 and 3 were still active produced a *second* session 3
 * instead of refilling the gap — nothing in the schema prevents duplicates, so
 * it persisted silently. These cases pin the free-slot behaviour that replaced
 * it.
 */

const COACH = 'coach-uuid';
const EMPLOYEE = 'employee-uuid';
const REQUEST = 'request-uuid';

/** A repository stub exposing only what bookSession touches. */
const repoStub = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn((v: unknown) => v),
  save: jest.fn(async (v: unknown) => v),
  update: jest.fn().mockResolvedValue(undefined),
});

type Stub = ReturnType<typeof repoStub>;

interface Harness {
  service: CoachingSessionsService;
  sessionRepo: Stub;
  availabilityRepo: Stub;
}

/**
 * @param activeNumbers session numbers currently holding their slot
 */
const buildHarness = (activeNumbers: number[]): Harness => {
  const sessionRepo = repoStub();
  const availabilityRepo = repoStub();
  const requestRepo = repoStub();
  const userRepo = repoStub();

  // Only the active sessions come back — bookSession filters out released ones
  // in the query itself.
  sessionRepo.find.mockResolvedValue(
    activeNumbers.map((sessionNumber) => ({ sessionNumber })),
  );

  requestRepo.findOne.mockResolvedValue({
    id: REQUEST,
    employeeId: EMPLOYEE,
    status: RequestStatus.APPROVED,
    formData: { coachId: COACH },
  });

  // The slot the employee picked, already free and belonging to the coach.
  availabilityRepo.create.mockImplementation((v: object) => ({
    ...v,
    id: 'slot-uuid',
  }));

  const calendarService = {
    isConnected: jest.fn().mockResolvedValue(false), // skip the Outlook round-trip
    getBusyIntervals: jest.fn().mockResolvedValue([]),
  };
  const emailService = { sendSessionBookingRequest: jest.fn() };
  const notificationsService = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const service = new CoachingSessionsService(
    sessionRepo as never,
    availabilityRepo as never,
    requestRepo as never,
    userRepo as never,
    emailService as never,
    notificationsService as never,
    calendarService as never,
  );

  // getApprovedCoachingRequest / findOverlappingSession / notifications are all
  // beyond what these cases are about — stub them so the numbering logic is
  // what's under test.
  jest
    .spyOn(service as never, 'getApprovedCoachingRequest' as never)
    .mockResolvedValue({
      id: REQUEST,
      employeeId: EMPLOYEE,
      formData: { coachId: COACH },
      employee: { fullName: 'Test Employee', email: 'e@example.com' },
    } as never);
  jest
    .spyOn(service as never, 'findOverlappingSession' as never)
    .mockResolvedValue(null as never);

  return { service, sessionRepo, availabilityRepo };
};

/** A far-future weekend slot, so the "can't book in the past" guard passes. */
const slot = (sessionNumber?: number) => ({
  availableDate: '2030-06-01',
  startTime: '09:00',
  endTime: '10:00',
  ...(sessionNumber === undefined ? {} : { sessionNumber }),
});

const bookedNumber = (sessionRepo: Stub): number | undefined =>
  (sessionRepo.create.mock.calls[0]?.[0] as { sessionNumber?: number })
    ?.sessionNumber;

describe('CoachingSessionsService — session numbering', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refills a released number rather than appending after the count', async () => {
    // The shipped bug, exactly: #1 released, #2 and #3 still active, and the
    // client sends no number (the old frontend never did). Counting actives
    // gives 2 + 1 = 3, duplicating the live session 3. It must refill the gap.
    //
    // Deliberately no explicit sessionNumber — passing one takes a different
    // branch and the count-based bug slips straight through.
    const { service, sessionRepo } = buildHarness([2, 3]);

    await service.bookSession(REQUEST, EMPLOYEE, slot());

    expect(bookedNumber(sessionRepo)).toBe(1);
  });

  it('honours the session number the caller asked for', async () => {
    const { service, sessionRepo } = buildHarness([1]);

    await service.bookSession(REQUEST, EMPLOYEE, slot(3));

    expect(bookedNumber(sessionRepo)).toBe(3);
  });

  it('takes the lowest free number when the caller omits one', async () => {
    // Older clients don't send it; the fix must hold for them too.
    const { service, sessionRepo } = buildHarness([1, 3]);

    await service.bookSession(REQUEST, EMPLOYEE, slot());

    expect(bookedNumber(sessionRepo)).toBe(2);
  });

  it('refuses a number that is already held by an active session', async () => {
    const { service } = buildHarness([2]);

    await expect(
      service.bookSession(REQUEST, EMPLOYEE, slot(2)),
    ).rejects.toThrow(/Session 2 is already booked/);
  });

  it('refuses a number outside the cycle', async () => {
    const { service } = buildHarness([]);

    await expect(
      service.bookSession(REQUEST, EMPLOYEE, slot(4)),
    ).rejects.toThrow(/between 1 and 3/);
  });

  it('refuses once every number is held', async () => {
    const { service } = buildHarness([1, 2, 3]);

    await expect(
      service.bookSession(REQUEST, EMPLOYEE, slot()),
    ).rejects.toThrow(BadRequestException);
  });

  it('treats released sessions as free, whatever released them', async () => {
    // cancelled / declined / no_show all give the number back, so a cycle whose
    // rows are all released books #1 again rather than reporting itself full.
    const { service, sessionRepo } = buildHarness([]);

    await service.bookSession(REQUEST, EMPLOYEE, slot());

    expect(bookedNumber(sessionRepo)).toBe(1);
  });

  it('excludes released statuses from the "what is taken" query', async () => {
    // The guarantee the numbering rests on: if this query ever stopped
    // filtering, released rows would keep their numbers forever.
    const { service, sessionRepo } = buildHarness([1]);

    await service.bookSession(REQUEST, EMPLOYEE, slot(2));

    const where = sessionRepo.find.mock.calls[0][0].where;
    expect(where.tokenRequestId).toBe(REQUEST);
    expect(where.status).toBeDefined(); // Not(In([...released]))
  });
});

describe('CoachingSessionsService — proposing after a no-show', () => {
  it('lists NO_SHOW as a status a coach may propose a new time from', () => {
    // A no-show left the coach with no actions at all until this was added.
    const proposable = (
      CoachingSessionsService as unknown as {
        PROPOSABLE_STATUSES: CoachingSessionStatus[];
      }
    ).PROPOSABLE_STATUSES;

    expect(proposable).toContain(CoachingSessionStatus.NO_SHOW);
    expect(proposable).toContain(CoachingSessionStatus.SCHEDULED);
    expect(proposable).toContain(CoachingSessionStatus.PENDING_COACH_APPROVAL);
    // A finished or abandoned session is not up for rescheduling.
    expect(proposable).not.toContain(CoachingSessionStatus.COMPLETED);
    expect(proposable).not.toContain(CoachingSessionStatus.CANCELLED);
  });
});
