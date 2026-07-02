import { mockDb } from './db';

console.log('=========================================');
console.log('SEEDER DIRECT MOCK DB INSPECTION RESULTS');
console.log('=========================================');
console.log(`Total Stops in Mock DB: ${mockDb.stops?.length || 0}`);
console.log(`Total Routes in Mock DB: ${mockDb.routes?.length || 0}`);

const autoRoutes = mockDb.routes?.filter((r: any) => r.route_code?.startsWith('R_AUTO_')) || [];
const autoStops = mockDb.stops?.filter((s: any) => s.stop_code?.startsWith('S_AUTO_')) || [];

console.log(`Discovered Auto-Routes count: ${autoRoutes.length}`);
console.log(`Discovered Auto-Stops count: ${autoStops.length}`);

if (autoRoutes.length > 0) {
  console.log('\n--- Sample Discovered Routes ---');
  autoRoutes.slice(0, 10).forEach((r: any) => {
    console.log(`- [${r.route_code}] ${r.route_name} (${r.distance_km} km)`);
  });
}

if (autoStops.length > 0) {
  console.log('\n--- Sample Discovered Stops ---');
  autoStops.slice(0, 10).forEach((s: any) => {
    console.log(`- [${s.stop_code}] ${s.name} (${s.latitude}, ${s.longitude})`);
  });
}
console.log('=========================================');
