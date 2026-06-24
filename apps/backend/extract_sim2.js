const fs = require('fs');

let code = fs.readFileSync('src/ingestion/adapter.ts', 'utf8');

// remove imports
code = code.replace(/import .*? from '.*?';/g, '');
// remove functions that use query
code = code.replace(/export async function ingestLocation[\s\S]*?}\n\n/g, '');
code = code.replace(/async function runSimulationStep[\s\S]*?}\n\n/g, '');
code = code.replace(/export function startIngestion[\s\S]*?}\n\n/g, '');
code = code.replace(/export function stopIngestion[\s\S]*?}\n/g, '');
// change export interfaces to interface
code = code.replace(/export interface/g, 'interface');

// Now append code to write data
code += `
const fs = require('fs');
fs.writeFileSync('src/ingestion/simulation_data.json', JSON.stringify({ STOPS, simulatedBuses }, null, 2));
console.log('Successfully wrote src/ingestion/simulation_data.json');
`;

fs.writeFileSync('temp_sim2.ts', code);
