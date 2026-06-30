import * as fs from 'fs';
import * as path from 'path';
import { query } from '../src/db';

const geocodedJsonPath = "C:/Users/Azad Singh/.gemini/antigravity-ide/brain/d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c/scratch/bus_stations_geocoded.json";
const dataJsonPath = path.join(__dirname, '../src/db/data.json');

function toTitleCase(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function slugify(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

const keywords = ['bus stand', 'bus station', 'depot', 'terminal', 'junction', 'village', 'town', 'mandir', 'isbt', 'peer'];

async function main() {
  console.log('--- STARTING DATABASE SEEDING ---');
  
  if (!fs.existsSync(geocodedJsonPath)) {
    console.error(`Error: Geocoded stations file not found at ${geocodedJsonPath}`);
    process.exit(1);
  }
  
  const geocodedData = JSON.parse(fs.readFileSync(geocodedJsonPath, 'utf8'));
  console.log(`Loaded ${geocodedData.length} stations from geocoded JSON.`);
  
  if (geocodedData.length === 0) {
    console.warn('No stations to seed.');
    process.exit(0);
  }
  
  // 1. Seed data.json (Mock Fallback)
  let dataJson: any = { stops: [], routes: [], route_stops: [], buses: [], trips: [], bus_live_state: [] };
  if (fs.existsSync(dataJsonPath)) {
    dataJson = JSON.parse(fs.readFileSync(dataJsonPath, 'utf8'));
  }
  
  const existingStops = dataJson.stops || [];
  const existingNamesLower = new Set(existingStops.map((s: any) => s.name.toLowerCase()));
  const existingCodes = new Set(existingStops.map((s: any) => s.stop_code));
  
  let maxId = existingStops.reduce((max: number, s: any) => s.id > max ? s.id : max, 0);
  let mockInsertedCount = 0;
  let dbInsertedCount = 0;
  
  for (const s of geocodedData) {
    const rawName = s.name.trim();
    let titleCased = toTitleCase(rawName);
    
    // Normalize: Append "Bus Station" if no standard transport suffix is present
    const lowerName = titleCased.toLowerCase();
    const hasKeyword = keywords.some(kw => lowerName.includes(kw));
    const finalName = hasKeyword ? titleCased : `${titleCased} Bus Station`;
    
    const stopCode = `S_${slugify(finalName)}`;
    
    // Skip if already in data.json
    if (existingNamesLower.has(finalName.toLowerCase()) || existingCodes.has(stopCode)) {
      continue;
    }
    
    maxId++;
    const newStop = {
      id: maxId,
      stop_code: stopCode,
      name: finalName,
      latitude: s.latitude,
      longitude: s.longitude
    };
    
    existingStops.push(newStop);
    existingNamesLower.add(finalName.toLowerCase());
    existingCodes.add(stopCode);
    mockInsertedCount++;
  }
  
  dataJson.stops = existingStops;
  fs.writeFileSync(dataJsonPath, JSON.stringify(dataJson, null, 2), 'utf8');
  console.log(`Mock DB data.json updated: Added ${mockInsertedCount} new stops. Total stops: ${existingStops.length}`);
  
  // 2. Seed PostgreSQL Live DB
  console.log('Inserting into PostgreSQL...');
  for (const s of geocodedData) {
    const rawName = s.name.trim();
    let titleCased = toTitleCase(rawName);
    const lowerName = titleCased.toLowerCase();
    const hasKeyword = keywords.some(kw => lowerName.includes(kw));
    const finalName = hasKeyword ? titleCased : `${titleCased} Bus Station`;
    const stopCode = `S_${slugify(finalName)}`;
    
    try {
      const res = await query(
        `INSERT INTO stops (stop_code, name, latitude, longitude)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (stop_code) DO NOTHING`,
        [stopCode, finalName, s.latitude, s.longitude]
      );
      if (res.rowCount && res.rowCount > 0) {
        dbInsertedCount++;
      }
    } catch (dbErr: any) {
      console.error(`DB Error inserting stop '${finalName}' (${stopCode}):`, dbErr.message);
    }
  }
  
  console.log(`PostgreSQL database updated: Seeded ${dbInsertedCount} new stops.`);
  console.log('--- SEEDING COMPLETED SUCCESSFULLY ---');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
