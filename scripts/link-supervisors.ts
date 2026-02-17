import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import * as XLSX from 'xlsx';

async function linkSupervisors() {
  try {
    // Initialize database connection
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    // Read Excel file
    const workbook = XLSX.readFile('employee_list.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`📄 Found ${data.length} employees in Excel file`);

    const userRepository = AppDataSource.getRepository(User);
    
    // Get all users from database
    const allUsers = await userRepository.find();
    console.log(`👥 Found ${allUsers.length} users in database`);

    // Create a map of full names to user IDs for quick lookup
    const nameToUserMap = new Map<string, User>();
    allUsers.forEach(user => {
      const fullName = `${user.firstName} ${user.lastName}`.trim();
      nameToUserMap.set(fullName, user);
      
      // Also try with middle name
      if (user.middleName) {
        const fullNameWithMiddle = `${user.firstName} ${user.middleName} ${user.lastName}`.trim();
        nameToUserMap.set(fullNameWithMiddle, user);
      }
    });

    let updated = 0;
    let notFound = 0;
    let skipped = 0;
    const notFoundSupervisors: Set<string> = new Set();

    for (const row of data) {
      const employee: any = row;
      const employeeId = employee['Employee ID'];
      const supervisorName = employee['Immediate Supervisor'];

      // Skip if no supervisor specified
      if (!supervisorName || supervisorName.trim() === '') {
        skipped++;
        continue;
      }

      // Find the employee in database
      const user = await userRepository.findOne({
        where: { employeeId },
      });

      if (!user) {
        console.log(`⚠️  Employee ${employeeId} not found in database`);
        continue;
      }

      // Find the supervisor by name
      const supervisor = nameToUserMap.get(supervisorName.trim());

      if (!supervisor) {
        notFound++;
        notFoundSupervisors.add(supervisorName.trim());
        continue;
      }

      // Don't allow self-supervision
      if (supervisor.id === user.id) {
        console.log(`⚠️  Skipping self-supervision for ${employeeId}`);
        skipped++;
        continue;
      }

      // Update the supervisor relationship
      user.immediateSupervisorId = supervisor.id;
      await userRepository.save(user);
      updated++;

      if (updated % 50 === 0) {
        console.log(`✅ Updated ${updated} supervisor relationships...`);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped (no supervisor): ${skipped}`);
    console.log(`❌ Supervisor not found: ${notFound}`);

    if (notFoundSupervisors.size > 0) {
      console.log('\n🔍 Supervisors not found in database:');
      notFoundSupervisors.forEach(name => console.log(`   - ${name}`));
    }

    await AppDataSource.destroy();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

linkSupervisors();
