import { BadRequestException } from '@nestjs/common';
import { TokenBalancesService } from './token-balances.service';
import { RequestStatus, DevelopmentOptionType } from '../common/enums';

/**
 * The token history breakdown rests on one invariant: a year's `used` equals the
 * sum of that year's approved requests. Tokens only move on final approval and
 * on undoing one, and an approved request can't be cancelled — so if these
 * drift, the "where did my tokens go" view silently stops adding up.
 */

const USER = 'user-uuid';

const repoStub = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn((v: unknown) => v),
  save: jest.fn(async (v: unknown) => v),
});

const balance = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'balance-uuid',
  userId: USER,
  year: 2026,
  allocated: 6,
  boostTokens: 4,
  used: 7,
  ...over,
});

const buildService = () => {
  const balanceRepo = repoStub();
  const requestRepo = repoStub();
  const userRepo = repoStub();
  const emailService = { sendTokenBalanceAdjustedEmail: jest.fn() };

  const service = new TokenBalancesService(
    balanceRepo as never,
    requestRepo as never,
    userRepo as never,
    emailService as never,
  );
  return { service, balanceRepo, requestRepo };
};

const approvedRequest = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'req-' + Math.random().toString(36).slice(2, 8),
  year: 2026,
  status: RequestStatus.APPROVED,
  type: DevelopmentOptionType.COACHING,
  tokenCost: 2,
  developmentOption: { name: 'Internal Coaching' },
  hrApprovedAt: new Date('2026-07-30T06:00:00Z'),
  managerApprovedAt: new Date('2026-07-29T06:00:00Z'),
  ...over,
});

describe('TokenBalancesService — history usage breakdown', () => {
  it('lists the approved requests behind a year, and they sum to `used`', async () => {
    const { service, balanceRepo, requestRepo } = buildService();
    balanceRepo.find.mockResolvedValue([balance({ used: 5 })]);
    requestRepo.find.mockResolvedValue([
      approvedRequest({ tokenCost: 2 }),
      approvedRequest({
        tokenCost: 3,
        developmentOption: { name: 'Learning Subsidy' },
      }),
    ]);

    const [year] = await service.getHistory(USER);

    expect(year.usage).toHaveLength(2);
    const total = year.usage.reduce((sum, u) => sum + u.tokenCost, 0);
    expect(total).toBe(year.used); // the invariant the UI relies on
  });

  it('only asks the database for APPROVED requests', async () => {
    // A pending or manager-approved request hasn't spent anything yet; counting
    // one would overstate the breakdown against `used`.
    const { service, balanceRepo, requestRepo } = buildService();
    balanceRepo.find.mockResolvedValue([balance()]);

    await service.getHistory(USER);

    expect(requestRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RequestStatus.APPROVED }),
      }),
    );
  });

  it('groups usage by the year the tokens came out of', async () => {
    const { service, balanceRepo, requestRepo } = buildService();
    balanceRepo.find.mockResolvedValue([
      balance({ year: 2026, used: 2 }),
      balance({ id: 'b2', year: 2025, used: 3 }),
    ]);
    requestRepo.find.mockResolvedValue([
      approvedRequest({ year: 2026, tokenCost: 2 }),
      approvedRequest({ year: 2025, tokenCost: 3 }),
    ]);

    const history = await service.getHistory(USER);

    const y2026 = history.find((h) => h.year === 2026)!;
    const y2025 = history.find((h) => h.year === 2025)!;
    expect(y2026.usage.map((u) => u.tokenCost)).toEqual([2]);
    expect(y2025.usage.map((u) => u.tokenCost)).toEqual([3]);
  });

  it('falls back to managerApprovedAt when the option skipped HR', async () => {
    // Options that don't require HR are finalized by the manager, leaving
    // hrApprovedAt null — the row would otherwise show no date at all.
    const { service, balanceRepo, requestRepo } = buildService();
    balanceRepo.find.mockResolvedValue([balance({ used: 2 })]);
    requestRepo.find.mockResolvedValue([
      approvedRequest({
        hrApprovedAt: null,
        managerApprovedAt: new Date('2026-06-23T01:00:00Z'),
      }),
    ]);

    const [year] = await service.getHistory(USER);

    expect(year.usage[0].spentAt).toEqual(new Date('2026-06-23T01:00:00Z'));
  });

  it('orders newest first and keeps undated entries last', async () => {
    // Postgres sorts NULLs first on DESC, which would float undated rows to the
    // top of the list; they belong at the bottom.
    const { service, balanceRepo, requestRepo } = buildService();
    balanceRepo.find.mockResolvedValue([balance({ used: 6 })]);
    requestRepo.find.mockResolvedValue([
      approvedRequest({
        hrApprovedAt: new Date('2026-01-01T00:00:00Z'),
        managerApprovedAt: null,
      }),
      approvedRequest({ hrApprovedAt: null, managerApprovedAt: null }),
      approvedRequest({
        hrApprovedAt: new Date('2026-09-01T00:00:00Z'),
        managerApprovedAt: null,
      }),
    ]);

    const [year] = await service.getHistory(USER);

    expect(year.usage.map((u) => u.spentAt?.toISOString() ?? null)).toEqual([
      '2026-09-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      null,
    ]);
  });

  it('names the option, falling back to a readable type if it was deleted', async () => {
    const { service, balanceRepo, requestRepo } = buildService();
    balanceRepo.find.mockResolvedValue([balance({ used: 4 })]);
    requestRepo.find.mockResolvedValue([
      approvedRequest({ developmentOption: { name: 'Internal Coaching' } }),
      approvedRequest({
        developmentOption: null,
        type: DevelopmentOptionType.TASK_OFFLOADING,
      }),
    ]);

    const [year] = await service.getHistory(USER);
    const names = year.usage.map((u) => u.optionName).sort();

    expect(names).toEqual(['Internal Coaching', 'Task Offloading']);
  });

  it('reports a year with no approved requests as empty, not missing', async () => {
    const { service, balanceRepo } = buildService();
    balanceRepo.find.mockResolvedValue([balance({ used: 0 })]);

    const [year] = await service.getHistory(USER);

    expect(year.usage).toEqual([]);
    expect(year.remaining).toBe(10); // 6 allocated + 4 boost - 0 used
  });
});

describe('TokenBalancesService — deduction', () => {
  it('refuses to spend more than the balance holds', async () => {
    const { service, balanceRepo } = buildService();
    balanceRepo.findOne.mockResolvedValue(
      balance({ allocated: 6, boostTokens: 0, used: 5 }),
    );

    // 6 + 0 - 5 = 1 available, asking for 2.
    await expect(service.deductTokens(USER, 2026, 2)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('counts boost tokens as spendable', async () => {
    const { service, balanceRepo } = buildService();
    balanceRepo.findOne.mockResolvedValue(
      balance({ allocated: 6, boostTokens: 4, used: 8 }),
    );

    // 6 + 4 - 8 = 2 available; without boost this would wrongly throw.
    const result = await service.deductTokens(USER, 2026, 2);

    expect(result.used).toBe(10);
    expect(result.remaining).toBe(0);
  });
});
