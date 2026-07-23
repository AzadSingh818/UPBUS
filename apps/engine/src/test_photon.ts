import fetch from 'node-fetch';

async function testPhoton(stopName: string) {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(stopName + ', Uttar Pradesh, India')}&limit=1`;
    console.log(`Querying Photon for: "${stopName}"`);
    console.log(`URL: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    console.log('Status:', res.status);
    const data = await res.json() as any;
    if (data && data.features && data.features.length > 0) {
      const geometry = data.features[0].geometry;
      const properties = data.features[0].properties;
      console.log('Resolved:', properties.name, properties.state, 'Coords:', geometry.coordinates);
    } else {
      console.log('No features returned.');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

async function run() {
  await testPhoton('BAREILLY');
  await testPhoton('KAUSHAMBI');
}

run();
