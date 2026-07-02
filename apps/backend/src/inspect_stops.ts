import { mockDb } from './db';

// Check what all route stops look like for the Ambehta Peer destination routes
// Search for routes that start or end near Phandpuri -> Ambehta Peer

console.log('=== All routes from/to Phandpuri or Ambehta area ===');
const routeStopsTable = (mockDb as any).route_stops;

// Find route_stops for stop 110 (Phandpuri) and 112 (Ambehta Peer)
const phandpuriStopIds = routeStopsTable.filter((rs: any) => rs.stop_id === 110);
const ambehtaStopIds = routeStopsTable.filter((rs: any) => rs.stop_id === 112);

console.log(`Phandpuri (110) in route_stops: ${phandpuriStopIds.length} entries`);
const pRouteIds = [...new Set(phandpuriStopIds.map((rs: any) => rs.route_id))];
console.log(`Route IDs: ${JSON.stringify(pRouteIds)}`);

console.log(`\nAmbehta Peer (112) in route_stops: ${ambehtaStopIds.length} entries`);
const aRouteIds = [...new Set(ambehtaStopIds.map((rs: any) => rs.route_id))];
console.log(`Route IDs: ${JSON.stringify(aRouteIds)}`);

// Find the common routes
const commonRouteIds = pRouteIds.filter(id => aRouteIds.includes(id));
console.log(`\nRoutes containing BOTH stops: ${JSON.stringify(commonRouteIds)}`);

commonRouteIds.forEach((rid: any) => {
  const route = mockDb.routes.find((r: any) => r.id === rid);
  console.log(`\nRoute [${rid}] "${route?.route_name}" (${route?.route_code})`);
  const stops = routeStopsTable
    .filter((rs: any) => rs.route_id === rid)
    .sort((a: any, b: any) => a.sequence_no - b.sequence_no);
  stops.forEach((rs: any) => {
    const stop = mockDb.stops.find((s: any) => s.id === rs.stop_id);
    console.log(`  [seq ${rs.sequence_no}] Stop [${rs.stop_id}] "${stop?.name}" -> (${stop?.latitude}, ${stop?.longitude})`);
  });
});

// Check the Saharanpur Depot coordinates accuracy
const sreDepot = mockDb.stops.find((s: any) => s.id === 19);
console.log('\nSaharanpur Depot:', JSON.stringify(sreDepot));
// Real coords: Saharanpur city center ~29.9857°N 77.5041°E
// Depot is slightly south of city, so ~29.964 could be ok
// But search shows it's mapped ~5km away. Let us check
