import { TokenRequestsService } from './token-requests.service';
import { RequestStatus, DevelopmentOptionType } from '../common/enums';

/**
 * Approval routing: only an option flagged `requiresHrApproval` escalates past
 * the manager. The flag is read live rather than snapshotted, so a policy change
 * applies to requests already in flight — including the ones already sitting in
 * the HR queue, which used to be stranded there forever.
 */

const MANAGER = 'manager-uuid';
const EMPLOYEE = 'employee-uuid';

/** Chainable stub for the HR-approver lookup on the escalation path. */
const queryBuilderStub = (rows: unknown[] = []) => {
  const qb: Record<string, unknown> = {};
  for (const m of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'select',
    'take',
  ]) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(rows);
  return qb;
};

const repoStub = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn((v: unknown) => v),
  save: jest.fn(async (v: unknown) => v),
  update: jest.fn().mockResolvedValue(undefined),
  createQueryBuilder: jest.fn(() => queryBuilderStub()),
  manager: {
    transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
      cb({
        getRepository: () => ({ save: jest.fn(async (v: unknown) => v) }),
      }),
    ),
  },
});

const buildService = () => {
  const requestRepo = repoStub();
  const userRepo = repoStub();
  const optionRepo = repoStub();
  const tokenBalancesService = {
    deductTokens: jest.fn().mockResolvedValue({ used: 2, remaining: 4 }),
    refundTokens: jest.fn().mockResolvedValue({}),
  };
  const emailService = {
    sendApprovalNotification: jest.fn().mockResolvedValue(undefined),
    sendHrReviewNotification: jest.fn().mockResolvedValue(undefined),
  };
  const notificationsService = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TokenRequestsService(
    requestRepo as never,
    userRepo as never,
    optionRepo as never,
    tokenBalancesService as never,
    emailService as never,
    notificationsService as never,
  );
  return { service, requestRepo, tokenBalancesService, emailService };
};

const pendingRequest = (requiresHrApproval: boolean, over = {}) => ({
  id: 'req-uuid',
  employeeId: EMPLOYEE,
  managerId: MANAGER,
  year: 2026,
  tokenCost: 2,
  type: DevelopmentOptionType.COACHING,
  status: RequestStatus.PENDING,
  developmentOption: {
    id: 'opt-uuid',
    name: 'Internal Coaching',
    requiresHrApproval,
  },
  employee: {
    id: EMPLOYEE,
    firstName: 'Test',
    lastName: 'User',
    email: 'e@example.com',
    fullName: 'Test User',
  },
  ...over,
});

describe('TokenRequestsService — approval routing', () => {
  it('finalizes at the manager when the option does not require HR', async () => {
    const { service, requestRepo, tokenBalancesService } = buildService();
    const request = pendingRequest(false);
    requestRepo.findOne.mockResolvedValue(request);

    await service.managerApprove('req-uuid', MANAGER);

    expect(request.status).toBe(RequestStatus.APPROVED);
    expect(tokenBalancesService.deductTokens).toHaveBeenCalledWith(
      EMPLOYEE,
      2026,
      2,
    );
  });

  it('escalates to HR when the option requires it, spending nothing yet', async () => {
    const { service, requestRepo, tokenBalancesService } = buildService();
    const request = pendingRequest(true, {
      type: DevelopmentOptionType.LEARNING_SUBSIDY,
    });
    requestRepo.findOne.mockResolvedValue(request);

    await service.managerApprove('req-uuid', MANAGER);

    expect(request.status).toBe(RequestStatus.MANAGER_APPROVED);
    expect(tokenBalancesService.deductTokens).not.toHaveBeenCalled();
  });

  it('refuses an approver who is not the assigned manager', async () => {
    const { service, requestRepo } = buildService();
    requestRepo.findOne.mockResolvedValue(pendingRequest(false));

    await expect(
      service.managerApprove('req-uuid', 'somebody-else'),
    ).rejects.toThrow(/not the assigned manager/);
  });

  it('refuses to approve a request that is not pending', async () => {
    const { service, requestRepo } = buildService();
    requestRepo.findOne.mockResolvedValue(
      pendingRequest(false, { status: RequestStatus.APPROVED }),
    );

    await expect(service.managerApprove('req-uuid', MANAGER)).rejects.toThrow(
      /not pending/,
    );
  });
});

describe('TokenRequestsService — HR requirement removed mid-flight', () => {
  it('finalizes requests left waiting on an HR step that no longer exists', async () => {
    // Turning the flag off used to leave these in the HR queue forever: manager
    // approval is now the last step, so nothing would ever move them.
    const { service, requestRepo, tokenBalancesService } = buildService();
    const stranded = pendingRequest(false, {
      status: RequestStatus.MANAGER_APPROVED,
    });
    requestRepo.find.mockResolvedValue([stranded]);

    const result = await service.finalizeRequestsNoLongerAwaitingHr('opt-uuid');

    expect(result).toEqual({ finalized: 1, skipped: 0 });
    expect(stranded.status).toBe(RequestStatus.APPROVED);
    expect(tokenBalancesService.deductTokens).toHaveBeenCalled();
  });

  it('only touches requests actually awaiting HR for that option', async () => {
    const { service, requestRepo } = buildService();

    await service.finalizeRequestsNoLongerAwaitingHr('opt-uuid');

    expect(requestRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          developmentOptionId: 'opt-uuid',
          status: RequestStatus.MANAGER_APPROVED,
        }),
      }),
    );
  });

  it('skips one it cannot finalize and carries on with the rest', async () => {
    // An employee whose balance no longer covers the request shouldn't block
    // everyone else's from being resolved.
    const { service, requestRepo, tokenBalancesService } = buildService();
    requestRepo.find.mockResolvedValue([
      pendingRequest(false, {
        id: 'a',
        status: RequestStatus.MANAGER_APPROVED,
      }),
      pendingRequest(false, {
        id: 'b',
        status: RequestStatus.MANAGER_APPROVED,
      }),
    ]);
    tokenBalancesService.deductTokens
      .mockRejectedValueOnce(new Error('Insufficient token balance'))
      .mockResolvedValueOnce({ used: 2, remaining: 0 });

    const result = await service.finalizeRequestsNoLongerAwaitingHr('opt-uuid');

    expect(result).toEqual({ finalized: 1, skipped: 1 });
  });

  it('does nothing when no request is waiting', async () => {
    const { service, tokenBalancesService } = buildService();

    const result = await service.finalizeRequestsNoLongerAwaitingHr('opt-uuid');

    expect(result).toEqual({ finalized: 0, skipped: 0 });
    expect(tokenBalancesService.deductTokens).not.toHaveBeenCalled();
  });
});

/**
 * Learning subsidy is capped per year, not just per request. Two requests of
 * 3 + 1 tokens each satisfy the per-request `maxTokens` check while totalling 4
 * for the year, and the general balance check cannot catch it because the annual
 * allocation (6) is larger than the subsidy cap (3). That combination reached
 * production, so the aggregate check is pinned down here.
 */
describe('TokenRequestsService — learning subsidy yearly cap', () => {
  /** Query-builder stub for the SUM(tokenCost) aggregate. */
  const rawQbStub = (total: number) => {
    const qb: Record<string, unknown> = {};
    for (const m of ['where', 'andWhere', 'select']) qb[m] = jest.fn(() => qb);
    qb.getRawOne = jest.fn().mockResolvedValue({ total: String(total) });
    return qb;
  };

  /** Cap check with `alreadyUsed` tokens on the year, asking for `required` more. */
  const callCap = (alreadyUsed: number, required: number, exclude?: string) => {
    const { service, requestRepo } = buildService();
    const qb = rawQbStub(alreadyUsed);
    requestRepo.createQueryBuilder = jest.fn(() => qb);
    const run = () =>
      (
        service as unknown as {
          assertLearningSubsidyYearlyCap: (
            ...a: unknown[]
          ) => Promise<void>;
        }
      ).assertLearningSubsidyYearlyCap(EMPLOYEE, 2026, required, 3, 1000, exclude);
    return { qb, run };
  };

  it('allows a request that lands exactly on the cap', async () => {
    await expect(callCap(2, 1).run()).resolves.toBeUndefined();
  });

  it('rejects the request that would push the year total past the cap', async () => {
    await expect(callCap(3, 1).run()).rejects.toThrow(
      /already used your full 2026 learning subsidy allowance of 3 tokens/,
    );
  });

  it('tells the employee how much of the allowance is actually left', async () => {
    await expect(callCap(2, 3).run()).rejects.toThrow(/1 token \(₱1,000\) left this year/);
  });

  it('counts in-flight requests, so a pending one holds its share', async () => {
    const { qb, run } = callCap(0, 1);
    await run();
    expect(qb.andWhere).toHaveBeenCalledWith('r.status NOT IN (:...excluded)', {
      excluded: [RequestStatus.CANCELLED, RequestStatus.REJECTED],
    });
  });

  it('excludes the request being edited so a resubmit is not double-counted', async () => {
    const { qb, run } = callCap(0, 3, 'req-uuid');
    await run();
    expect(qb.andWhere).toHaveBeenCalledWith('r.id != :excludeRequestId', {
      excludeRequestId: 'req-uuid',
    });
  });
});
