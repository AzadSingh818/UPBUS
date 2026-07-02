async function testNominatim() {
  const queries = ['Ambahata, Saharanpur', 'Ambahata'];
  for (const query of queries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UPBus-App-Agent/1.0' }
      });
      const data: any = await res.json();
      console.log(`--- Nominatim Result for "${query}": ---`);
      data.forEach((item: any) => {
        console.log(`Display: ${item.display_name}, Lat: ${item.lat}, Lng: ${item.lon}`);
      });
    } catch (err: any) {
      console.error(`Error for ${query}:`, err.message);
    }
  }
}

testNominatim();
