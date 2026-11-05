process.noDeprecation = true;
import { startIngestion, stopIngestion } from './ingestion/adapter_live';
import { startRouteSeeder, stopRouteSeeder } from './engine/routeSeeder';
import { runRouteDeduplicationCycle } from './engine/routeDeduplicationEngine';
import { buildGraph } from './engine/graph';
import { buildRouteGeometries } from './engine/routeGeometry';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('[Engine] Starting Background Engine for UPBus (Live Tracker & Route Learning)...');
  
  // Handle global uncaught exceptions to prevent crashing the entire worker silently
  process.on('uncaughtException', (err) => {
    console.error('[Engine] ❌ Uncaught Exception:', err);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Engine] ❌ Unhandled Rejection at:', promise, 'reason:', reason);
  });

  // Load Graph and Route Geometries
  await buildGraph();
  
  const waypointsPath = path.join(__dirname, 'db/waypoints.json');
  if (fs.existsSync(waypointsPath)) {
    const waypointsData = JSON.parse(fs.readFileSync(waypointsPath, 'utf8'));
    buildRouteGeometries(waypointsData);
    console.log('[Engine] Route geometries with village waypoints loaded.');
  } else {
    buildRouteGeometries(null);
  }

  // Boot GPS Ingestion Engine (fetches buses from external source)
  startIngestion();

  // Boot Autonomous Route Seeder (learns routes over time)
  startRouteSeeder();

  // Boot Master-Mapping Route Deduplication Engine
  runRouteDeduplicationCycle().catch(err => console.error('[Engine] Error running initial route dedup cycle:', err));
  setInterval(() => {
    runRouteDeduplicationCycle().catch(err => console.error('[Engine] Error running scheduled route dedup cycle:', err));
  }, 5 * 60 * 1000);
}

// Graceful Shutdown
const shutdown = () => {
  console.log('[Engine] Shutting down background workers...');
  stopIngestion();
  stopRouteSeeder();
  setTimeout(() => {
    console.log('[Engine] Stopped.');
    process.exit(0);
  }, 1000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(console.error);
