import fetch from 'node-fetch';

async function geocodeOverpass(stopName: string): Promise<{ lat: number; lng: number } | null> {
  const query = `
[out:json][timeout:5];
(
  node["place"]["name"="${stopName}"](23.8,77.0,31.5,84.8);
  node["place"]["name:en"="${stopName}"](23.8,77.0,31.5,84.8);
  relation["boundary"="administrative"]["name"="${stopName}"](23.8,77.0,31.5,84.8);
);
out center;
  `.trim();

  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'upbus-backend/1.0 (UP Bus Live Tracker)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!res.ok) {
        console.log(`Endpoint ${endpoint} returned status ${res.status}`);
        continue;
      }
      const data = await res.json() as any;
      console.log(`Overpass response elements count for "${stopName}":`, data?.elements?.length);
      if (data?.remark) {
        console.log('Overpass remark:', data.remark);
      }
      if (data && Array.isArray(data.elements) && data.elements.length > 0) {
        // Find best match (prefer node, or relation center)
        const el = data.elements[0];
        let lat = el.lat;
        let lon = el.lon;
        if (lat === undefined && el.center) {
          lat = el.center.lat;
          lon = el.center.lon;
        }
        if (lat !== undefined && lon !== undefined) {
          return { lat, lng: lon };
        }
      }
    } catch (e: any) {
      console.warn(`Error at ${endpoint}:`, e.message);
    }
  }
  return null;
}

async function run() {
  const bareilly = await geocodeOverpass('Bareilly');
  console.log('Bareilly resolved:', bareilly);

  const kaushambi = await geocodeOverpass('Kaushambi');
  console.log('Kaushambi resolved:', kaushambi);

  const moradabad = await geocodeOverpass('Moradabad');
  console.log('Moradabad resolved:', moradabad);
}

run();
