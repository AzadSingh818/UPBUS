import fs from 'fs';
import path from 'path';

const inputPath = path.join(__dirname, '../src/db/data_aws_dist.json');
const outputPath = path.join(__dirname, '../src/db/data.json');

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Helper to check if array 'sub' is an ordered subset of array 'full'
const isSubsequence = (sub: number[], full: number[]) => {
  let subIdx = 0;
  for (let i = 0; i < full.length && subIdx < sub.length; i++) {
    if (full[i] === sub[subIdx]) {
      subIdx++;
    }
  }
  return subIdx === sub.length;
};

const routes = data.routes;
const routeStops = data.route_stops;

// Map route_id to its sequence of stop_ids
const routeSequences = new Map<number, number[]>();
routes.forEach((r: any) => routeSequences.set(r.id, []));

routeStops.sort((a: any, b: any) => a.sequence_no - b.sequence_no);
for (const rs of routeStops) {
  if (routeSequences.has(rs.route_id)) {
    routeSequences.get(rs.route_id)!.push(rs.stop_id);
  }
}

// deduplicate
const uniqueRoutes: any[] = [];
const uniqueRouteStops: any[] = [];

for (const route of routes) {
  // Always keep manually seeded routes
  if (!route.route_code.includes('_VAR_')) {
    uniqueRoutes.push(route);
    continue;
  }

  const seq = routeSequences.get(route.id)!;
  if (seq.length < 2) continue; // remove invalid routes

  let isDuplicate = false;
  for (const existingRoute of uniqueRoutes) {
    const existingSeq = routeSequences.get(existingRoute.id)!;
    
    const forwardMatch = isSubsequence(seq, existingSeq);
    const reverseMatch = isSubsequence(seq, [...existingSeq].reverse());

    if (forwardMatch || reverseMatch) {
      isDuplicate = true;
      break;
    }
  }

  if (!isDuplicate) {
    uniqueRoutes.push(route);
  }
}

// keep only route_stops for unique routes
const uniqueRouteIds = new Set(uniqueRoutes.map(r => r.id));
for (const rs of routeStops) {
  if (uniqueRouteIds.has(rs.route_id)) {
    uniqueRouteStops.push(rs);
  }
}

data.routes = uniqueRoutes;
data.route_stops = uniqueRouteStops;

fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');

console.log(`Original routes: ${routes.length}, Unique routes: ${uniqueRoutes.length}`);
console.log(`Cleaned data saved to ${outputPath}`);
