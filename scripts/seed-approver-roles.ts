/**
 * seed-approver-roles.ts
 *
 * Assigns the `approver` role to every user who is set as an
 * immediateSupervisorId for at least one employee.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-approver-roles.ts
 */

import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import { UserRole } from '../src/common/enums/user.enum';

async function seedApproverRoles() {
  await AppDataSource.initialize();
  console.log('✅ Database connected');

  const userRepo = AppDataSource.getRepository(User);

  // Find all distinct supervisor IDs referenced by employees
  const rows = await userRepo
    .createQueryBuilder('user')
    .select('DISTINCT user.immediateSupervisorId', 'supervisorId')
    .where('user.immediateSupervisorId IS NOT NULL')
    .getRawMany<{ supervisorId: string }>();

  const supervisorIds = rows.map((r) => r.supervisorId).filter(Boolean);
  console.log(`📋 Found ${supervisorIds.length} distinct supervisors`);

  let updated = 0;
  let alreadySet = 0;

  for (const id of supervisorIds) {
    const supervisor = await userRepo.findOne({ where: { id } });
    if (!supervisor) {
      console.log(`⚠️  Supervisor ${id} not found in users table — skipping`);
      continue;
    }

    if (supervisor.roles.includes(UserRole.APPROVER)) {
      alreadySet++;
      continue;
    }

    supervisor.roles = [...supervisor.roles, UserRole.APPROVER];
    await userRepo.save(supervisor);
    console.log(
      `✅ ${supervisor.firstName} ${supervisor.lastName} (${supervisor.employeeId}) → roles: [${supervisor.roles.join(', ')}]`,
    );
    updated++;
  }

  console.log(`\n🎉 Done. ${updated} supervisors updated, ${alreadySet} already had approver role.`);
  await AppDataSource.destroy();
}

seedApproverRoles().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
