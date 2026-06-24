const fs = require('fs');

let code = fs.readFileSync('src/ingestion/adapter.ts', 'utf8');

// remove imports
code = code.replace(/import .*? from '.*?';/g, '');

// Stub query to avoid undefined error
code = 'const query: any = async () => ({ rows: [] });\n' + code;

// change export interfaces to interface
code = code.replace(/export interface/g, 'interface');
code = code.replace(/export async/g, 'async');
code = code.replace(/export function/g, 'function');

// Now append code to write data
code += `
const fs = require('fs');
fs.writeFileSync('src/ingestion/simulation_data.json', JSON.stringify({ STOPS, simulatedBuses }, null, 2));
console.log('Successfully wrote src/ingestion/simulation_data.json');
`;

fs.writeFileSync('temp_sim4.ts', code);
