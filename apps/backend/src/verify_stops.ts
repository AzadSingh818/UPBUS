import { mockDb } from './db';

// Helper function to calculate distance using Haversine formula
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function verifyStops() {
  // Filter stops in the region (Latitude 29.4 to 30.3, Longitude 77.0 to 77.9)
  const regionalStops = mockDb.stops.filter((s: any) => 
    s.latitude >= 29.4 && s.latitude <= 30.3 && 
    s.longitude >= 77.0 && s.longitude <= 77.9
  );

  console.log(`Verifying ${regionalStops.length} stops in the Saharanpur/Muzaffarnagar region...`);

  for (const stop of regionalStops) {
    // Avoid checking generic placeholder names
    if (stop.name.toLowerCase().includes('village') || stop.name.toLowerCase().includes('kasba')) {
      continue;
    }

    try {
      // Query Nominatim for the stop name + "Saharanpur" or "Uttar Pradesh"
      const query = stop.name.toLowerCase().includes('saharanpur') || stop.name.toLowerCase().includes('muzaffar')
        ? stop.name 
        : `${stop.name}, Saharanpur`;

      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UPBus-App-Agent/1.0' }
      });
      const data: any = await res.json();

      if (data && data.length > 0) {
        const item = data[0];
        const gLat = parseFloat(item.lat);
        const gLng = parseFloat(item.lon);
        const dist = getDistanceKm(stop.latitude, stop.longitude, gLat, gLng);

        if (dist > 1.5) {
          console.log(`⚠️ MISMATCH detected for Stop [${stop.id}] "${stop.name}":`);
          console.log(`   DB Coordinates:  (${stop.latitude}, ${stop.longitude})`);
          console.log(`   OSM Coordinates: (${gLat}, ${gLng})`);
          console.log(`   Distance:        ${dist.toFixed(2)} km`);
          console.log(`   Display Name:    ${item.display_name}\n`);
        } else {
          console.log(`✅ Stop "${stop.name}" is accurate (Distance: ${dist.toFixed(2)} km)`);
        }
      } else {
        // Try a fallback search with "Uttar Pradesh" instead of "Saharanpur"
        const queryFallback = `${stop.name}, Uttar Pradesh`;
        const resFallback = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryFallback)}&format=json&limit=1`, {
          headers: { 'User-Agent': 'UPBus-App-Agent/1.0' }
        });
        const dataFallback: any = await resFallback.json();
        if (dataFallback && dataFallback.length > 0) {
          const item = dataFallback[0];
          const gLat = parseFloat(item.lat);
          const gLng = parseFloat(item.lon);
          const dist = getDistanceKm(stop.latitude, stop.longitude, gLat, gLng);
          if (dist > 1.5) {
            console.log(`⚠️ MISMATCH detected for Stop [${stop.id}] "${stop.name}" (fallback):`);
            console.log(`   DB Coordinates:  (${stop.latitude}, ${stop.longitude})`);
            console.log(`   OSM Coordinates: (${gLat}, ${gLng})`);
            console.log(`   Distance:        ${dist.toFixed(2)} km`);
            console.log(`   Display Name:    ${item.display_name}\n`);
          } else {
            console.log(`✅ Stop "${stop.name}" is accurate (Distance: ${dist.toFixed(2)} km)`);
          }
        } else {
          console.log(`ℹ️ No geocoding result found for "${stop.name}"`);
        }
      }
      // Sleep 1 second to respect Nominatim rate limit
      await new Promise(r => setTimeout(r, 1000));
    } catch (err: any) {
      console.error(`Error geocoding stop "${stop.name}":`, err.message);
    }
  }
}

verifyStops();
