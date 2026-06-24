const fs = require('fs');

const code = fs.readFileSync('src/ingestion/adapter.ts', 'utf8');

function extractObject(code, startText) {
  const startIndex = code.indexOf(startText);
  if (startIndex !== -1) {
    let depth = 0;
    let endIndex = -1;
    let foundStart = false;
    
    for (let i = startIndex; i < code.length; i++) {
      if (code[i] === '{' || code[i] === '[') {
        depth++;
        foundStart = true;
      } else if (code[i] === '}' || code[i] === ']') {
        depth--;
        if (foundStart && depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }
    if (endIndex !== -1) {
      return code.substring(startIndex, endIndex);
    }
  }
  return null;
}

// Just match all PATH_* variables
const pathMatches = [...code.matchAll(/const (PATH_R_[A-Z_]+) = interpolatePath\((\[.*?\]), (\d+)\);/gs)];
// We can't easily eval `STOPS` if we don't have it.
// Let's just create a modified version of the file that exports these variables and run it.

let exportCode = code.replace(/export interface/g, 'interface')
                     .replace(/export async function/g, 'async function')
                     .replace(/import .* from .*/g, '');

exportCode += `
const fs = require('fs');
fs.writeFileSync('src/ingestion/simulation_data.json', JSON.stringify({ STOPS, simulatedBuses }, null, 2));
console.log('Successfully wrote src/ingestion/simulation_data.json');
`;

fs.writeFileSync('temp_sim.ts', exportCode);
