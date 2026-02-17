const xlsx = require('xlsx');

const wb = xlsx.readFile('employee_list.xlsx');
const opsGmail = xlsx.utils.sheet_to_json(wb.Sheets['Ops Gmail']);
const mainSheet = xlsx.utils.sheet_to_json(wb.Sheets['Employee List For TD Token']);

const opsIds = new Set(opsGmail.map(r => r['Employee ID']));
const mainIds = new Set(mainSheet.map(r => r['Employee ID']));

const overlap = [...opsIds].filter(id => mainIds.has(id));
const opsOnly = [...opsIds].filter(id => !mainIds.has(id));

console.log('📊 Sheet Comparison:');
console.log('Ops Gmail employees:', opsIds.size);
console.log('Main sheet employees:', mainIds.size);
console.log('Overlap (in both sheets):', overlap.length);
console.log('Ops Gmail only (new):', opsOnly.length);

if (opsOnly.length > 0) {
  console.log('\n🆕 New employee IDs in Ops Gmail:');
  console.log(opsOnly.join(', '));
  
  console.log('\n📝 Sample new employees:');
  opsGmail
    .filter(r => opsOnly.includes(r['Employee ID']))
    .slice(0, 5)
    .forEach(emp => {
      console.log(`${emp['Employee ID']} - ${emp['First Name']} ${emp['Last Name']} (${emp['Email']})`);
    });
}

if (overlap.length > 0) {
  console.log('\n🔄 Overlapping employees (might have updated info):');
  console.log('First 10:', overlap.slice(0, 10).join(', '));
}
