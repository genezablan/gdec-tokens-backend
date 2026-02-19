/**
 * seed-coach-roles.ts
 *
 * Assigns the `coach` role to employees.
 *
 * Modes:
 *   --all-managers   Grant coach role to ALL users with employeeType = 'Manager'
 *   <id|email> ...   Grant coach role to specific users by employeeId or email
 *
 * Usage:
 *   npm run seed:coach-roles -- --all-managers
 *   npm run seed:coach-roles -- GDC-010 GDC-025
 *   npm run seed:coach-roles -- juan.delacruz@greatdealscorp.com
 */

import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import { UserRole, EmployeeType } from '../src/common/enums/user.enum';

async function seedCoachRoles() {
  const args = process.argv.slice(2);
  const allManagers = args.includes('--all-managers');
  const identifiers = args.filter((a) => a !== '--all-managers');

  if (!allManagers && identifiers.length === 0) {
    console.error('❌ No arguments provided.');
    console.error('   Usage:');
    console.error('     npm run seed:coach-roles -- --all-managers');
    console.error('     npm run seed:coach-roles -- GDC-010 GDC-025');
    process.exit(1);
  }

  await AppDataSource.initialize();
  console.log('✅ Database connected');

  const userRepo = AppDataSource.getRepository(User);
  let updated = 0;
  let alreadySet = 0;
  let notFound = 0;

  // ─── Mode 1: all managers ────────────────────────────────────────────────────
  if (allManagers) {
    const managers = await userRepo.find({ where: { employeeType: EmployeeType.MANAGER } });
    console.log(`📋 Found ${managers.length} users with employeeType = Manager`);

    for (const user of managers) {
      if (user.roles.includes(UserRole.COACH)) {
        alreadySet++;
        continue;
      }
      user.roles = [...user.roles, UserRole.COACH];
      await userRepo.save(user);
      console.log(`✅ ${user.firstName} ${user.lastName} (${user.employeeId}) → roles: [${user.roles.join(', ')}]`);
      updated++;
    }
  }

  // ─── Mode 2: specific identifiers ────────────────────────────────────────────
  for (const identifier of identifiers) {
    const isEmail = identifier.includes('@');
    const user = await userRepo.findOne({
      where: isEmail ? { email: identifier } : { employeeId: identifier },
    });

    if (!user) {
      console.log(`⚠️  Not found: ${identifier}`);
      notFound++;
      continue;
    }

    if (user.roles.includes(UserRole.COACH)) {
      console.log(`ℹ️  ${user.firstName} ${user.lastName} (${user.employeeId}) already has coach role — skipping`);
      alreadySet++;
      continue;
    }

    user.roles = [...user.roles, UserRole.COACH];
    await userRepo.save(user);
    console.log(`✅ ${user.firstName} ${user.lastName} (${user.employeeId}) → roles: [${user.roles.join(', ')}]`);
    updated++;
  }

  console.log(`\n🎉 Done. ${updated} assigned, ${alreadySet} already had coach role, ${notFound} not found.`);
  await AppDataSource.destroy();
}

seedCoachRoles().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
