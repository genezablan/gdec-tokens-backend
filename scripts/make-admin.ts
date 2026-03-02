/**
 * make-admin.ts
 *
 * Grants the `admin` role to a user by email.
 * Existing roles are preserved — admin is simply added if not already present.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register scripts/make-admin.ts <email>
 *
 * Example:
 *   npx ts-node -r tsconfig-paths/register scripts/make-admin.ts juan.dela.cruz@greatdealscorp.com
 */

import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import { UserRole } from '../src/common/enums/user.enum';

async function makeAdmin() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Usage: npx ts-node -r tsconfig-paths/register scripts/make-admin.ts <email>');
    process.exit(1);
  }

  await AppDataSource.initialize();
  console.log('✅ Database connected');

  const userRepo = AppDataSource.getRepository(User);

  const user = await userRepo.findOne({ where: { email } });

  if (!user) {
    console.error(`❌ No user found with email: ${email}`);
    await AppDataSource.destroy();
    process.exit(1);
  }

  const roles = (user.roles as string[]) || [];

  if (roles.includes(UserRole.ADMIN)) {
    console.log(`ℹ️  ${user.firstName} ${user.lastName} (${email}) is already an admin.`);
    await AppDataSource.destroy();
    process.exit(0);
  }

  user.roles = [...roles, UserRole.ADMIN] as UserRole[];
  await userRepo.save(user);

  console.log(`✅ Admin role granted to ${user.firstName} ${user.lastName} (${email})`);
  console.log(`   Roles now: ${user.roles.join(', ')}`);

  await AppDataSource.destroy();
}

makeAdmin().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
