import { mockDb } from './db';

const townsToCheck = [
  { name: 'Ambehta Peer', dbQuery: 'Ambehta Peer', osmQuery: 'Ambahata, Saharanpur' },
  { name: 'Nakur', dbQuery: 'Nakur', osmQuery: 'Nakur, Saharanpur' },
  { name: 'Gangoh', dbQuery: 'Gangoh', osmQuery: 'Gangoh, Saharanpur' },
  { name: 'Khera Afgan', dbQuery: 'Khera', osmQuery: 'Khera Afgan, Saharanpur' },
  { name: 'Sarsawa', dbQuery: 'Sarsawa', osmQuery: 'Sarsawa, Saharanpur' },
  { name: 'Rampur Maniharan', dbQuery: 'Rampur', osmQuery: 'Rampur Maniharan, Saharanpur' },
  { name: 'Nanauta', dbQuery: 'Nanauta', osmQuery: 'Nanauta, Saharanpur' },
  { name: 'Deoband', dbQuery: 'Deoband', osmQuery: 'Deoband, Saharanpur' },
  { name: 'Shamli', dbQuery: 'Shamli', osmQuery: 'Shamli, Uttar Pradesh' },
  { name: 'Chutmalpur', dbQuery: 'Chutmalpur', osmQuery: 'Chutmalpur, Saharanpur' },
  { name: 'Gagalheri', dbQuery: 'Gagalheri', osmQuery: 'Gagalheri, Saharanpur' },
  { name: 'Behat', dbQuery: 'Behat', osmQuery: 'Behat, Saharanpur' }
];

async function checkTowns() {
  console.log('--- VERIFYING MAJOR TOWNS ---');
  for (const town of townsToCheck) {
    const stop = mockDb.stops.find((s: any) => s.name.toLowerCase().includes(town.dbQuery.toLowerCase()));
    if (!stop) {
      console.log(`Stop not found in DB for: ${town.name}`);
      continue;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(town.osmQuery)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UPBus-App-Agent/1.0' }
      });
      const data: any = await res.json();

      if (data && data.length > 0) {
        const item = data[0];
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        console.log(`Town: ${town.name}`);
        console.log(`  DB Coordinates:  (${stop.latitude}, ${stop.longitude})`);
        console.log(`  OSM Coordinates: (${lat}, ${lon})`);
        console.log(`  Difference:      Lat: ${(stop.latitude - lat).toFixed(4)}, Lng: ${(stop.longitude - lon).toFixed(4)}`);
      } else {
        console.log(`No OSM coordinates found for ${town.name}`);
      }
      await new Promise(r => setTimeout(r, 1000)); // rate limit sleep
    } catch (e: any) {
      console.error(`Error checking ${town.name}:`, e.message);
    }
  }
}

checkTowns();
