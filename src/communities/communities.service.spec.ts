import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { CommunityRole } from '../common/enums';

/**
 * Adding members is the one community action that changes someone else's
 * membership without their say-so, so the guards around it carry the weight:
 * only an admin may do it, and a batch reports what happened per person rather
 * than failing whole because one id was stale.
 *
 * The last-admin rule matters because demotion became a one-click button. A
 * community with no admin can't add members, approve requests, or promote
 * anyone back — only a platform admin could unstick it.
 */

const ADMIN = { id: 'admin-uuid' } as never;
const COMMUNITY = { id: 'team', name: 'Team', privacy: 'private' };

const repoStub = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn((v: unknown) => v),
  save: jest.fn(async (v: unknown) => v),
  delete: jest.fn().mockResolvedValue({ affected: 0 }),
});

const buildService = () => {
  const communityRepo = repoStub();
  const memberRepo = repoStub();
  const requestRepo = repoStub();
  const userRepo = repoStub();
  const resourceRepo = repoStub();
  const access = {
    getCommunityOrThrow: jest.fn().mockResolvedValue(COMMUNITY),
    assertCommunityAdmin: jest.fn().mockResolvedValue(undefined),
    // updateMemberRole returns the refreshed member list, which re-reads it.
    assertCanViewContent: jest.fn().mockResolvedValue(undefined),
  };
  const mapper = { mapMember: jest.fn((m: unknown) => m) };
  const notifier = { addedToCommunity: jest.fn() };

  const service = new CommunitiesService(
    communityRepo as never,
    memberRepo as never,
    requestRepo as never,
    userRepo as never,
    resourceRepo as never,
    access as never,
    mapper as never,
    notifier as never,
    { presignAvatars: jest.fn(async (v: unknown) => v) } as never,
  );
  return { service, memberRepo, requestRepo, userRepo, access, notifier };
};

/** Everyone asked for exists and is active unless a test says otherwise. */
const activeUsers = (userRepo: ReturnType<typeof repoStub>, ids: string[]) =>
  userRepo.find.mockResolvedValue(ids.map((id) => ({ id })));

describe('CommunitiesService.addMembers', () => {
  it('adds a non-member outright — no invitation to accept', async () => {
    const { service, memberRepo, userRepo, notifier } = buildService();
    activeUsers(userRepo, ['alice']);

    const result = await service.addMembers(ADMIN, 'team', ['alice']);

    expect(result).toEqual({
      added: ['alice'],
      alreadyMember: [],
      notFound: [],
    });
    expect(memberRepo.save).toHaveBeenCalledWith([
      { communityId: 'team', userId: 'alice', role: CommunityRole.MEMBER },
    ]);
    expect(notifier.addedToCommunity).toHaveBeenCalled();
  });

  it('reports a partial batch instead of failing it', async () => {
    const { service, memberRepo, userRepo } = buildService();
    activeUsers(userRepo, ['alice', 'bob']); // 'ghost' is inactive/deleted
    memberRepo.find.mockResolvedValue([{ userId: 'bob' }]);

    const result = await service.addMembers(ADMIN, 'team', [
      'alice',
      'bob',
      'ghost',
    ]);

    expect(result).toEqual({
      added: ['alice'],
      alreadyMember: ['bob'],
      notFound: ['ghost'],
    });
    // Only the genuinely new person is written.
    expect(memberRepo.save).toHaveBeenCalledWith([
      { communityId: 'team', userId: 'alice', role: CommunityRole.MEMBER },
    ]);
  });

  it('adding someone who is already in changes nothing', async () => {
    const { service, memberRepo, userRepo, notifier } = buildService();
    activeUsers(userRepo, ['bob']);
    memberRepo.find.mockResolvedValue([{ userId: 'bob' }]);

    const result = await service.addMembers(ADMIN, 'team', ['bob']);

    expect(result.alreadyMember).toEqual(['bob']);
    expect(memberRepo.save).not.toHaveBeenCalled();
    expect(notifier.addedToCommunity).not.toHaveBeenCalled();
  });

  it('can add someone straight in as a co-admin', async () => {
    const { service, memberRepo, userRepo } = buildService();
    activeUsers(userRepo, ['alice']);

    await service.addMembers(ADMIN, 'team', ['alice'], CommunityRole.ADMIN);

    expect(memberRepo.save).toHaveBeenCalledWith([
      { communityId: 'team', userId: 'alice', role: CommunityRole.ADMIN },
    ]);
  });

  it('clears a pending join request — it is moot once they are in', async () => {
    const { service, requestRepo, userRepo } = buildService();
    activeUsers(userRepo, ['alice']);

    await service.addMembers(ADMIN, 'team', ['alice']);

    expect(requestRepo.delete).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: 'team' }),
    );
  });

  it('rejects a non-admin before touching anything', async () => {
    const { service, memberRepo, userRepo, access } = buildService();
    activeUsers(userRepo, ['alice']);
    access.assertCommunityAdmin.mockRejectedValue(new ForbiddenException());

    await expect(service.addMembers(ADMIN, 'team', ['alice'])).rejects.toThrow(
      ForbiddenException,
    );
    expect(memberRepo.save).not.toHaveBeenCalled();
  });
});

describe('CommunitiesService.updateMemberRole', () => {
  it('refuses to demote the last admin', async () => {
    const { service, memberRepo } = buildService();
    memberRepo.findOne.mockResolvedValue({
      communityId: 'team',
      userId: 'admin-uuid',
      role: CommunityRole.ADMIN,
    });
    memberRepo.count.mockResolvedValue(1);

    await expect(
      service.updateMemberRole(
        ADMIN,
        'team',
        'admin-uuid',
        CommunityRole.MEMBER,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(memberRepo.save).not.toHaveBeenCalled();
  });

  it('allows demotion once a second admin exists', async () => {
    const { service, memberRepo } = buildService();
    const member = {
      communityId: 'team',
      userId: 'admin-uuid',
      role: CommunityRole.ADMIN,
    };
    memberRepo.findOne.mockResolvedValue(member);
    memberRepo.count.mockResolvedValue(2);

    await service.updateMemberRole(
      ADMIN,
      'team',
      'admin-uuid',
      CommunityRole.MEMBER,
    );

    expect(member.role).toBe(CommunityRole.MEMBER);
    expect(memberRepo.save).toHaveBeenCalledWith(member);
  });

  it('promoting is never blocked by the last-admin rule', async () => {
    const { service, memberRepo } = buildService();
    const member = {
      communityId: 'team',
      userId: 'bob',
      role: CommunityRole.MEMBER,
    };
    memberRepo.findOne.mockResolvedValue(member);
    memberRepo.count.mockResolvedValue(1);

    await service.updateMemberRole(ADMIN, 'team', 'bob', CommunityRole.ADMIN);

    expect(member.role).toBe(CommunityRole.ADMIN);
    expect(memberRepo.count).not.toHaveBeenCalled();
  });
});
