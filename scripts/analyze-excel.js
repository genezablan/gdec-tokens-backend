const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
const workbook = XLSX.readFile('employee_list.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const data = XLSX.utils.sheet_to_json(worksheet);

console.log('Total employees:', data.length);
console.log('\n=== First 3 rows ===');
console.log(JSON.stringify(data.slice(0, 3), null, 2));

console.log('\n=== Column Names ===');
if (data.length > 0) {
  console.log(Object.keys(data[0]));
}

console.log('\n=== Data Types Analysis ===');
if (data.length > 0) {
  const columns = Object.keys(data[0]);
  columns.forEach(col => {
    const sample = data[0][col];
    const type = typeof sample;
    const maxLength = Math.max(...data.map(row => String(row[col] || '').length));
    console.log(`${col}: ${type} (max length: ${maxLength})`);
  });
}
