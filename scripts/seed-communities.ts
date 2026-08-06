/**
 * seed-communities.ts
 *
 * Seeds the default `1GDEC` community so the Community feature is usable out of
 * the box. Every active employee is auto-joined. Idempotent: re-running upserts
 * metadata and never duplicates members/resources.
 *
 * The first platform admin (or, failing that, the first user) is made the
 * community admin.
 *
 * Usage:
 *   npm run seed:communities
 */

import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import { Community } from '../src/entities/community.entity';
import { CommunityMember } from '../src/entities/community-member.entity';
import { CommunityResource } from '../src/entities/community-resource.entity';
import {
  CommunityPrivacy,
  CommunityRole,
  ResourceType,
  UserRole,
} from '../src/common/enums';
import { ArrayContains } from 'typeorm';

interface SeedCommunity {
  id: string;
  name: string;
  description: string;
  about?: string;
  privacy: CommunityPrivacy;
  topics: string[];
  resources?: { type: ResourceType; label: string; url: string }[];
  /** Auto-join every active user (for company-wide spaces). */
  joinAll?: boolean;
}

const COMMUNITIES: SeedCommunity[] = [
  {
    id: 'general',
    name: '1GDEC',
    description: 'Company-wide announcements, wins and watercooler chat.',
    about: 'The home community everyone belongs to.',
    privacy: CommunityPrivacy.PUBLIC,
    topics: ['Announcements', 'Kudos', 'Events'],
    joinAll: true,
  },
];

async function seed() {
  await AppDataSource.initialize();
  console.log('✅ Database connected');

  const userRepo = AppDataSource.getRepository(User);
  const communityRepo = AppDataSource.getRepository(Community);
  const memberRepo = AppDataSource.getRepository(CommunityMember);
  const resourceRepo = AppDataSource.getRepository(CommunityResource);

  const admin =
    (await userRepo.findOne({ where: { roles: ArrayContains([UserRole.ADMIN]) } })) ??
    (await userRepo.findOne({ where: {} }));
  if (!admin) {
    console.error('❌ No users found — seed users first.');
    process.exit(1);
  }
  console.log(`👤 Community admin: ${admin.fullName} (${admin.email})`);

  for (const c of COMMUNITIES) {
    const existing = await communityRepo.findOne({ where: { id: c.id } });
    if (existing) {
      existing.name = c.name;
      existing.description = c.description;
      existing.about = c.about ?? existing.about;
      existing.privacy = c.privacy;
      existing.topics = c.topics;
      await communityRepo.save(existing);
      console.log(`♻️  Updated community '${c.id}'`);
    } else {
      await communityRepo.save(
        communityRepo.create({
          id: c.id,
          name: c.name,
          slug: c.id,
          description: c.description,
          about: c.about ?? null,
          privacy: c.privacy,
          topics: c.topics,
        }),
      );
      console.log(`✅ Created community '${c.id}'`);
    }

    // Resources (replace).
    if (c.resources?.length) {
      await resourceRepo.delete({ communityId: c.id });
      await resourceRepo.save(
        c.resources.map((r, i) =>
          resourceRepo.create({ communityId: c.id, ...r, sortOrder: i }),
        ),
      );
    }

    // Ensure the admin is a community admin.
    await upsertMember(memberRepo, c.id, admin.id, CommunityRole.ADMIN);

    // Company-wide spaces: auto-join every active user.
    if (c.joinAll) {
      const activeUsers = await userRepo.find({ where: { isActive: true } });
      let added = 0;
      for (const u of activeUsers) {
        if (u.id === admin.id) continue;
        const created = await upsertMember(
          memberRepo,
          c.id,
          u.id,
          CommunityRole.MEMBER,
        );
        if (created) added++;
      }
      console.log(`   👥 '${c.id}': ${added} members added (${activeUsers.length} active users)`);
    }
  }

  console.log('\n🎉 Community seed complete.');
  await AppDataSource.destroy();
}

/** Insert a membership if absent. Returns true if a new row was created. */
async function upsertMember(
  repo: ReturnType<typeof AppDataSource.getRepository<CommunityMember>>,
  communityId: string,
  userId: string,
  role: CommunityRole,
): Promise<boolean> {
  const existing = await repo.findOne({ where: { communityId, userId } });
  if (existing) {
    if (role === CommunityRole.ADMIN && existing.role !== CommunityRole.ADMIN) {
      existing.role = role;
      await repo.save(existing);
    }
    return false;
  }
  await repo.save(repo.create({ communityId, userId, role }));
  return true;
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
