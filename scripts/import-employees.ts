import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import { UserRole, EmployeeType, EmployeeStatus, Gender, AuthProvider } from '../src/common/enums';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcrypt';

async function importEmployees() {
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
    
    // Default password for all users
    const defaultPassword = await bcrypt.hash('TempPass123!', 10);

    let imported = 0;
    let skipped = 0;
    const errors: any[] = [];

    for (const row of data) {
      const employee: any = row;
      
      try {
        // Check if user already exists
        const existingUser = await userRepository.findOne({
          where: { employeeId: employee['Employee ID'] },
        });

        if (existingUser) {
          console.log(`⏭️  Skipping ${employee['Employee ID']} - already exists`);
          skipped++;
          continue;
        }

        // Determine roles
        const roles = [UserRole.EMPLOYEE];
        if (employee['Coach'] === 'with Coach Access') {
          roles.push(UserRole.COACH);
        }

        // Parse contact number
        let contact = employee['Contact'];
        if (contact && contact.includes(':')) {
          contact = contact.split(':')[1].trim();
        }

        // Create user object
        const userData = {
          employeeId: employee['Employee ID'],
          email: employee['Email for Dev Token Web/App'],
          password: defaultPassword,
          authProvider: AuthProvider.LOCAL,
          firstName: employee['First Name'],
          middleName: employee['Middle Name'] || undefined,
          lastName: employee['Last Name'],
          gender: employee['Gender'] as Gender,
          department: employee['Department'],
          location: employee['Location'],
          position: employee['Position'],
          employeeType: employee['Employee Type'] as EmployeeType,
          employeeStatus: employee['Employee Status'] as EmployeeStatus,
          immediateSupervisorId: undefined, // Will be set in second pass
          contact: contact || undefined,
          separationDate: employee['Separation Date'] === 'Not yet set' ? undefined : new Date(employee['Separation Date']),
          roles: roles,
          isActive: true,
          isPasswordChanged: false,
        };

        const user = userRepository.create(userData);
        await userRepository.save(user);
        imported++;
        console.log(`✅ Imported ${employee['Employee ID']} - ${employee['First Name']} ${employee['Last Name']}`);

      } catch (error) {
        console.error(`❌ Error importing ${employee['Employee ID']}:`, error.message);
        errors.push({ employeeId: employee['Employee ID'], error: error.message });
      }
    }

    console.log('\n📊 Import Summary:');
    console.log(`   Imported: ${imported}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors:');
      errors.forEach(e => console.log(`   ${e.employeeId}: ${e.error}`));
    }

    console.log('\n✅ Import completed!');
    console.log(`\n🔐 Default password for all users: TempPass123!`);

  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    await AppDataSource.destroy();
  }
}

importEmployees();
