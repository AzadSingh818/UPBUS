const fs = require('fs');

// 1. db/index.ts
let dbIndex = fs.readFileSync('src/db/index.ts', 'utf8');

// The `mockDb` object starts at `const mockDb = {` and ends before `function executeMockQuery`
const mockDbStart = dbIndex.indexOf('const mockDb = {');
const mockDbEnd = dbIndex.indexOf('function executeMockQuery');

if (mockDbStart !== -1 && mockDbEnd !== -1) {
  const replacement = "const mockDb = require('./data.json');\n\n";
  dbIndex = dbIndex.substring(0, mockDbStart) + replacement + dbIndex.substring(mockDbEnd);
  fs.writeFileSync('src/db/index.ts', dbIndex);
  console.log('Modified src/db/index.ts');
}

// 2. ingestion/adapter.ts
let adapter = fs.readFileSync('src/ingestion/adapter.ts', 'utf8');

const stopsStart = adapter.indexOf('const STOPS: Record<string, { lat: number; lng: number }> = {');
// The arrays end before `let ingestionTimer`
const arraysEnd = adapter.indexOf('let ingestionTimer: NodeJS.Timeout | null = null;');

if (stopsStart !== -1 && arraysEnd !== -1) {
  const replacement = "const { STOPS, simulatedBuses } = require('./simulation_data.json');\n\n";
  adapter = adapter.substring(0, stopsStart) + replacement + adapter.substring(arraysEnd);
  fs.writeFileSync('src/ingestion/adapter.ts', adapter);
  console.log('Modified src/ingestion/adapter.ts');
}
