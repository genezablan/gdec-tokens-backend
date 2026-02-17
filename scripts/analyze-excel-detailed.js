const XLSX = require('xlsx');

const workbook = XLSX.readFile('employee_list.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet);

console.log('=== Unique Values Analysis ===\n');

console.log('Employee Types:');
const employeeTypes = [...new Set(data.map(row => row['Employee Type']))];
console.log(employeeTypes);
console.log('');

console.log('Employee Status:');
const employeeStatus = [...new Set(data.map(row => row['Employee Status']))];
console.log(employeeStatus);
console.log('');

console.log('Departments:');
const departments = [...new Set(data.map(row => row['Department']))];
departments.forEach(d => console.log(`  - ${d}`));
console.log('');

console.log('Locations:');
const locations = [...new Set(data.map(row => row['Location']))];
locations.forEach(l => console.log(`  - ${l}`));
console.log('');

console.log('Coach Access:');
const coachAccess = [...new Set(data.map(row => row['Coach']))];
console.log(coachAccess);
console.log('Count with Coach Access:', data.filter(row => row['Coach'] === 'with Coach Access').length);
console.log('');

console.log('Gender:');
const genders = [...new Set(data.map(row => row['Gender']))];
console.log(genders);
console.log('');

console.log('Sample Employee IDs:');
console.log(data.slice(0, 10).map(row => row['Employee ID']));
