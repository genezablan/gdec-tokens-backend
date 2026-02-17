import { AppDataSource } from '../src/data-source';
import { User } from '../src/entities/user.entity';
import { UserRole, EmployeeType, EmployeeStatus, Gender, AuthProvider } from '../src/common/enums';
import * as XLSX from 'xlsx';
import * as bcrypt from 'bcrypt';

async function importOpsGmail() {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    // Read Excel file
    const workbook = XLSX.readFile('employee_list.xlsx');
    const opsGmailSheet = workbook.Sheets['Ops Gmail'];
    const opsGmailData = XLSX.utils.sheet_to_json(opsGmailSheet);

    console.log(`📄 Found ${opsGmailData.length} employees in Ops Gmail sheet`);

    const userRepository = AppDataSource.getRepository(User);
    const defaultPassword = await bcrypt.hash('TempPass123!', 10);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: any[] = [];

    for (const row of opsGmailData) {
      const employee: any = row;

      try {
        // Check if user already exists
        const existingUser = await userRepository.findOne({
          where: { employeeId: employee['Employee ID'] },
        });

        // Determine email - prefer Active Email Address, fallback to Email
        const email = employee['Active Email Address'] || employee['Email'];

        if (existingUser) {
          // Update email if different
          if (existingUser.email !== email && email) {
            existingUser.email = email;
            await userRepository.save(existingUser);
            console.log(`🔄 Updated email for ${existingUser.employeeId}: ${email}`);
            updated++;
          } else {
            skipped++;
          }
          continue;
        }

        // New employee - import
        // Parse contact number
        let contact = employee['Contact'];
        if (contact && typeof contact === 'string') {
          if (contact.includes(':')) {
            contact = contact.split(':')[1].trim();
          }
        }

        // Parse separation date
        let separationDate: Date | undefined = undefined;
        if (employee['Separation Date'] && employee['Separation Date'] !== 'Not yet set') {
          if (typeof employee['Separation Date'] === 'number') {
            // Excel date serial number
            const date = new Date((employee['Separation Date'] - 25569) * 86400 * 1000);
            separationDate = date;
          } else {
            separationDate = new Date(employee['Separation Date']);
          }
        }

        const userData = {
          employeeId: employee['Employee ID'],
          email: email,
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
          immediateSupervisorId: undefined, // Will be set later
          contact: contact || undefined,
          separationDate: separationDate,
          roles: [UserRole.EMPLOYEE], // Default role
          isActive: employee['Employee Status'] !== 'Resigned',
          isPasswordChanged: false,
        };

        const user = userRepository.create(userData);
        await userRepository.save(user);
        console.log(`✅ Imported ${employee['Employee ID']} - ${employee['First Name']} ${employee['Last Name']}`);
        imported++;

      } catch (error) {
        console.error(`❌ Error processing ${employee['Employee ID']}:`, error.message);
        errors.push({ employeeId: employee['Employee ID'], error: error.message });
      }
    }

    console.log('\n📊 Summary:');
    console.log(`✅ Imported new: ${imported}`);
    console.log(`🔄 Updated emails: ${updated}`);
    console.log(`⏭️  Skipped (no changes): ${skipped}`);
    console.log(`❌ Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(e => console.log(`   ${e.employeeId}: ${e.error}`));
    }

    await AppDataSource.destroy();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

importOpsGmail();
