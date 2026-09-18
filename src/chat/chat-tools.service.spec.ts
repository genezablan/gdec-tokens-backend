import { ChatToolsService } from './chat-tools.service';

/**
 * Admin profile edits through chat are the only writes the assistant can make,
 * and the model decides when to call the tools. The guard that matters is
 * server-side: a proposal can only be applied by a *later* chat request, so the
 * model cannot propose and save in the same turn without the admin replying.
 */

const ADMIN_ID = 'admin-uuid';
const TARGET_ID = 'target-uuid';

const makeTarget = () => ({
  id: TARGET_ID,
  employeeId: '202301-15',
  fullName: 'Jacquilyn Ayag',
  firstName: 'Jacquilyn',
  lastName: 'Ayag',
  email: 'HR.OPS-IR@greatdealscorp.com',
  department: 'HR',
  position: 'Associate',
});

const buildService = (opts: { emailTakenBy?: string } = {}) => {
  let target = makeTarget();
  const users = {
    // An email lookup is the uniqueness check; anything else is the target by id.
    findOne: jest.fn(({ where }: { where: { email?: unknown } }) =>
      Promise.resolve(
        where.email
          ? opts.emailTakenBy
            ? { id: 'other', fullName: opts.emailTakenBy }
            : null
          : { ...target },
      ),
    ),
    save: jest.fn(async (u: ReturnType<typeof makeTarget>) => {
      target = { ...u };
      return u;
    }),
  };
  const service = new ChatToolsService(
    {} as never,
    {} as never,
    {} as never,
    users as never,
  );
  return {
    service,
    users,
    current: () => target,
    mutate: (patch: object) => (target = { ...target, ...patch }),
  };
};

const NEW_EMAIL = { email: 'j.ayag@greatdealscorp.com' };

describe('ChatToolsService admin profile edits', () => {
  it('proposes without writing, then saves when confirmed in a later turn', async () => {
    const { service, users, current } = buildService();

    const proposal = await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );
    expect(proposal).toMatchObject({
      status: 'awaiting_confirmation',
      changes: [
        {
          field: 'email',
          from: 'HR.OPS-IR@greatdealscorp.com',
          to: NEW_EMAIL.email,
        },
      ],
    });
    expect(users.save).not.toHaveBeenCalled();

    const result = await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2');
    expect(result).toMatchObject({ status: 'saved' });
    expect(current().email).toBe(NEW_EMAIL.email);
  });

  it('refuses to confirm in the same turn as the proposal', async () => {
    const { service, users } = buildService();
    await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );

    const result = await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-1');
    expect(result).toHaveProperty('error');
    expect(users.save).not.toHaveBeenCalled();

    // The proposal survives, so the admin's "yes" next turn still works.
    expect(
      await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2'),
    ).toMatchObject({ status: 'saved' });
  });

  it('lets an identical re-proposal in the confirming turn still confirm', async () => {
    const { service, current } = buildService();
    await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );

    // Admin says "yes"; the model re-proposes, then confirms, all in turn 2.
    await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-2',
      TARGET_ID,
      NEW_EMAIL,
    );
    expect(
      await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2'),
    ).toMatchObject({ status: 'saved' });
    expect(current().email).toBe(NEW_EMAIL.email);
  });

  it('treats a different re-proposal as new, needing another reply', async () => {
    const { service, users } = buildService();
    await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );
    await service.proposeEmployeeUpdate(ADMIN_ID, 'turn-2', TARGET_ID, {
      email: 'other@greatdealscorp.com',
    });

    expect(
      await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2'),
    ).toHaveProperty('error');
    expect(users.save).not.toHaveBeenCalled();
  });

  it('refuses when nothing was proposed, or another admin proposed it', async () => {
    const { service, users } = buildService();
    expect(
      await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2'),
    ).toHaveProperty('error');

    await service.proposeEmployeeUpdate(
      'someone-else',
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );
    expect(
      await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2'),
    ).toHaveProperty('error');
    expect(users.save).not.toHaveBeenCalled();
  });

  it('refuses an expired proposal', async () => {
    const { service, users } = buildService();
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );
    now.mockReturnValue(1_000_000 + 11 * 60 * 1000);

    expect(
      await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2'),
    ).toHaveProperty('error');
    expect(users.save).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('refuses if the record changed after the proposal', async () => {
    const { service, users, mutate } = buildService();
    await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );
    mutate({ email: 'edited-elsewhere@greatdealscorp.com' });

    expect(
      await service.confirmEmployeeUpdate(ADMIN_ID, 'turn-2'),
    ).toHaveProperty('error');
    expect(users.save).not.toHaveBeenCalled();
  });

  it('rejects an email that already belongs to someone else', async () => {
    const { service } = buildService({ emailTakenBy: 'Someone Else' });
    const result = await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      NEW_EMAIL,
    );
    expect(result).toEqual({ error: expect.stringContaining('Someone Else') });
  });

  it('drops fields that already match and refuses a no-op', async () => {
    const { service } = buildService();
    const result = await service.proposeEmployeeUpdate(
      ADMIN_ID,
      'turn-1',
      TARGET_ID,
      {
        department: 'HR',
      },
    );
    expect(result).toHaveProperty('error');
  });
});
