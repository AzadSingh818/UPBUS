/**
 * fetch_osm_villages.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time script to fetch real village/hamlet/town names from OpenStreetMap
 * Overpass API for every stop-pair corridor on every UP bus route.
 *
 * Usage:
 *   npx ts-node scripts/fetch_osm_villages.ts
 *
 * Output:
 *   apps/backend/src/db/waypoints.json
 *
 * Strategy:
 *   For each route: for each consecutive stop pair (A → B):
 *     1. Compute a bounding box expanded ±CORRIDOR_DEG around the segment
 *     2. Query Overpass for villages/hamlets/towns in that box
 *     3. Filter to only nodes within CORRIDOR_KM of the straight line
 *     4. Sort by projection onto the A→B vector
 *     5. Store name + lat + lng + osm_id
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

/** Lateral corridor width (km) each side of the stop-pair line */
const CORRIDOR_KM = 2.5;

/** Degrees expansion for bounding box (roughly 2.5 km ≈ 0.025°) */
const CORRIDOR_DEG = 0.025;

/** Delay between Overpass requests (ms) to avoid rate limiting */
const REQUEST_DELAY_MS = 2000;

/** Max waypoints to store per stop-pair segment */
const MAX_WAYPOINTS_PER_SEGMENT = 12;

/** Overpass API endpoints (we rotate on 429) */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter'
];
let endpointIdx = 0;

// ── Load data.json ────────────────────────────────────────────────────────────

const dataPath = path.join(__dirname, '../src/db/data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const stopsById: Record<number, any> = {};
for (const s of data.stops) {
  stopsById[s.id] = s;
}

const routeStopsByRoute: Record<number, any[]> = {};
for (const rs of data.route_stops) {
  if (!routeStopsByRoute[rs.route_id]) routeStopsByRoute[rs.route_id] = [];
  routeStopsByRoute[rs.route_id].push(rs);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Perpendicular distance from point P to line segment (A→B) in km.
 * Returns also the projected fraction t along A→B (0=at A, 1=at B).
 */
function pointToSegmentDistanceKm(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number
): { dist: number; t: number } {
  const dx = bLng - aLng;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { dist: haversineKm(pLat, pLng, aLat, aLng), t: 0 };

  let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestLat = aLat + t * dy;
  const closestLng = aLng + t * dx;
  return { dist: haversineKm(pLat, pLng, closestLat, closestLng), t };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchOverpass(queryStr: string, retries = 3): Promise<any> {
  const fetch = (await import('node-fetch')).default;
  for (let attempt = 0; attempt < retries; attempt++) {
    const url = OVERPASS_ENDPOINTS[endpointIdx % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        // Overpass accepts raw QL as plain text body
        body: queryStr,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
      if (res.status === 429 || res.status === 503) {
        // Rate limited — rotate endpoint and wait longer
        endpointIdx++;
        console.log(`    ⏳ Rate limited (${res.status}), waiting 8s...`);
        await sleep(8000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e: any) {
      if (attempt < retries - 1) {
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
  throw new Error('All retries failed');
}

// ── Main fetch logic ──────────────────────────────────────────────────────────

interface Waypoint {
  name: string;
  lat: number;
  lng: number;
  osm_id: number;
  t: number; // projection fraction along the A→B segment (for ordering)
}

interface RouteWaypoints {
  route_id: number;
  route_code: string;
  between_stop_seqs: [number, number]; // [fromSeq, toSeq]
  waypoints: Omit<Waypoint, 't'>[];
}

async function fetchWaypointsForSegment(
  aLat: number, aLng: number,
  bLat: number, bLng: number
): Promise<Waypoint[]> {
  // Dynamic corridor: scale with segment length but cap at 0.15° (~16 km)
  const segDist = haversineKm(aLat, aLng, bLat, bLng);
  const corridorDeg = Math.min(CORRIDOR_DEG + segDist * 0.001, 0.15);
  const corridorKm = Math.min(CORRIDOR_KM + segDist * 0.05, 8);
  const timeout = segDist > 50 ? 60 : 30;

  const minLat = Math.min(aLat, bLat) - corridorDeg;
  const maxLat = Math.max(aLat, bLat) + corridorDeg;
  const minLng = Math.min(aLng, bLng) - corridorDeg;
  const maxLng = Math.max(aLng, bLng) + corridorDeg;

  const query = `[out:json][timeout:${timeout}];
(
  node["place"~"^(village|town|hamlet|suburb)$"](${minLat},${minLng},${maxLat},${maxLng});
);
out body;`;

  let result: any;
  try {
    result = await fetchOverpass(query);
  } catch (e) {
    console.error('  Overpass error:', e);
    return [];
  }

  const nodes: any[] = result.elements || [];
  const waypoints: Waypoint[] = [];

  for (const node of nodes) {
    const name: string = node.tags?.name || node.tags?.['name:en'] || '';
    if (!name || name.trim() === '') continue;
    // Skip if name looks like "Kasba" generic or if unnamed
    if (name.toLowerCase() === 'kasba') continue;

    const { dist, t } = pointToSegmentDistanceKm(node.lat, node.lon, aLat, aLng, bLat, bLng);
    if (dist > corridorKm) continue;

    waypoints.push({
      name: name.trim(),
      lat: parseFloat(node.lat.toFixed(6)),
      lng: parseFloat(node.lon.toFixed(6)),
      osm_id: node.id,
      t
    });
  }

  // Sort by projection fraction t (0=near A, 1=near B)
  waypoints.sort((a, b) => a.t - b.t);

  // Deduplicate by name (keep first occurrence along segment)
  const seen = new Set<string>();
  const deduped: Waypoint[] = [];
  for (const wp of waypoints) {
    const key = wp.name.toLowerCase().replace(/\s+/g, '');
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(wp);
    }
  }

  return deduped.slice(0, MAX_WAYPOINTS_PER_SEGMENT);
}

async function main() {
  console.log('🌍 Fetching real villages from OpenStreetMap Overpass API...');
  console.log(`   Routes: ${data.routes.length}, Total route_stops: ${data.route_stops?.length ?? 0}`);
  console.log('');

  const allRouteWaypoints: RouteWaypoints[] = [];
  let totalWaypoints = 0;
  let requestCount = 0;

  for (const route of data.routes) {
    const rStops = (routeStopsByRoute[route.id] || [])
      .sort((a: any, b: any) => a.sequence_no - b.sequence_no);

    if (rStops.length < 2) continue;

    for (let i = 0; i < rStops.length - 1; i++) {
      const fromRs = rStops[i];
      const toRs = rStops[i + 1];
      const fromStop = stopsById[fromRs.stop_id];
      const toStop = stopsById[toRs.stop_id];

      if (!fromStop || !toStop) continue;

      // Skip segments involving placeholder "Kasba (Village)" fake stops
      const isPlaceholder = fromStop.name.toLowerCase().includes('kasba') ||
                            toStop.name.toLowerCase().includes('kasba');

      const aLat = parseFloat(fromStop.latitude);
      const aLng = parseFloat(fromStop.longitude);
      const bLat = parseFloat(toStop.latitude);
      const bLng = parseFloat(toStop.longitude);

      const segDist = haversineKm(aLat, aLng, bLat, bLng);
      process.stdout.write(
        `  Route ${route.route_code} | Seg ${fromRs.sequence_no}→${toRs.sequence_no} ` +
        `(${fromStop.name.slice(0, 20)} → ${toStop.name.slice(0, 20)}) ` +
        `${segDist.toFixed(1)} km ... `
      );

      if (isPlaceholder) {
        console.log(`[SKIP - placeholder stop]`);
        allRouteWaypoints.push({
          route_id: route.id,
          route_code: route.route_code,
          between_stop_seqs: [fromRs.sequence_no, toRs.sequence_no],
          waypoints: []
        });
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      const waypoints = await fetchWaypointsForSegment(aLat, aLng, bLat, bLng);
      requestCount++;

      console.log(`${waypoints.length} villages`);
      totalWaypoints += waypoints.length;

      allRouteWaypoints.push({
        route_id: route.id,
        route_code: route.route_code,
        between_stop_seqs: [fromRs.sequence_no, toRs.sequence_no],
        waypoints: waypoints.map(({ t, ...rest }) => rest)
      });
    }
  }


  const output = {
    _meta: {
      generated: new Date().toISOString(),
      source: 'OpenStreetMap Overpass API',
      total_routes: data.routes.length,
      total_segments: allRouteWaypoints.length,
      total_waypoints: totalWaypoints,
      requests_made: requestCount
    },
    route_waypoints: allRouteWaypoints
  };

  const outPath = path.join(__dirname, '../src/db/waypoints.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('');
  console.log(`✅ Done! ${totalWaypoints} real villages fetched across ${allRouteWaypoints.length} segments.`);
  console.log(`   Output: ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
