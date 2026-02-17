import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import { UserRole } from '../src/common/enums';

async function verifyData() {
  try {
    await AppDataSource.initialize();
    
    const userRepository = AppDataSource.getRepository(User);
    
    // Get sample users with their supervisors
    const users = await userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.immediateSupervisor', 'supervisor')
      .orderBy('user.employeeId', 'ASC')
      .take(10)
      .getMany();

    console.log('\n📋 Sample Employee → Supervisor Relationships:\n');
    users.forEach(user => {
      const supervisorName = user.immediateSupervisor 
        ? `${user.immediateSupervisor.firstName} ${user.immediateSupervisor.lastName}` 
        : 'No supervisor';
      console.log(`${user.employeeId} | ${user.fullName} → ${supervisorName}`);
    });

    // Get count of users by role
    const allUsers = await userRepository.find();
    const roleStats = {
      employees: allUsers.filter(u => u.hasRole(UserRole.EMPLOYEE)).length,
      coaches: allUsers.filter(u => u.isCoach()).length,
      approvers: allUsers.filter(u => u.canApprove()).length,
      admins: allUsers.filter(u => u.isAdmin()).length,
    };

    console.log('\n📊 User Statistics:');
    console.log(`Total Users: ${allUsers.length}`);
    console.log(`With Supervisor: ${allUsers.filter(u => u.immediateSupervisorId).length}`);
    console.log(`Employees: ${roleStats.employees}`);
    console.log(`Coaches: ${roleStats.coaches}`);
    console.log(`Approvers: ${roleStats.approvers}`);
    console.log(`Admins: ${roleStats.admins}`);

    await AppDataSource.destroy();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verifyData();
