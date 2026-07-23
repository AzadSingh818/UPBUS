import { buildGraph, findPathsDFS } from './engine/graph';

async function run() {
  await buildGraph();
  
  const from = 'Muzaffar';
  const to = 'Bijnor';
  console.log(`Searching paths from "${from}" to "${to}"...`);
  
  const paths = findPathsDFS(from, to, 2);
  console.log(`Found ${paths.length} paths:`);
  
  paths.forEach((p, idx) => {
    console.log(`\nPath #${idx + 1}: Distance = ${p.totalDistanceKm.toFixed(1)} km, Transfers = ${p.totalTransfers}`);
    p.legs.forEach((l, lIdx) => {
      console.log(`  Leg ${lIdx + 1}: ${l.fromStopName} -> ${l.toStopName} via "${l.routeName}" (${l.distanceKm.toFixed(1)} km)`);
    });
  });
}

run();
