import { query } from '../db';
import { buildGraph } from './graph';

// In-memory cache of stops to avoid querying the DB on every single ping
let stopsCache: any[] = [];
let lastStopsFetch = 0;

async function getStops() {
  const now = Date.now();
  if (stopsCache.length === 0 || now - lastStopsFetch > 60000) {
    try {
      const res = await query('SELECT id, name, latitude, longitude FROM stops');
      stopsCache = res.rows.map(s => ({
        id: s.id,
        name: s.name,
        latitude: parseFloat(s.latitude),
        longitude: parseFloat(s.longitude)
      }));
      lastStopsFetch = now;
    } catch (err) {
      console.error('[Route Learning] Error loading stops cache:', err);
    }
  }
  return stopsCache;
}

// Earth radius in km
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

// Map tracking visited stops for active trips
export const visitedStopsMap = new Map<number, number[]>();

/**
 * Record a live bus GPS update and detect if a stop is visited.
 */
export async function recordLiveLocation(tripId: number, latitude: number, longitude: number, speed: number) {
  if (isNaN(latitude) || isNaN(longitude)) return;

  const stops = await getStops();
  const thresholdKm = 0.2; // 200 meters proximity geofence for learning stops
  
  let closestStop: any = null;
  let minDistance = Infinity;

  for (const stop of stops) {
    const dist = haversineKm(latitude, longitude, stop.latitude, stop.longitude);
    if (dist <= thresholdKm && dist < minDistance) {
      minDistance = dist;
      closestStop = stop;
    }
  }

  if (closestStop) {
    let visited = visitedStopsMap.get(tripId);
    if (!visited) {
      visited = [];
      visitedStopsMap.set(tripId, visited);
    }

    // Add stop if different from the last recorded stop (avoid duplicate consecutive records)
    if (visited.length === 0 || visited[visited.length - 1] !== closestStop.id) {
      visited.push(closestStop.id);
      console.log(`[Route Learning] Trip ${tripId} visited stop: ${closestStop.name} (Stop ID: ${closestStop.id})`);
    }

    // Auto-detect trip completion when the destination stop is reached
    try {
      const tripRes = await query('SELECT route_id FROM trips WHERE id = $1', [tripId]);
      if (tripRes.rowCount && tripRes.rowCount > 0) {
        const routeId = tripRes.rows[0].route_id;
        const routeStopsRes = await query(
          'SELECT stop_id FROM route_stops WHERE route_id = $1 ORDER BY sequence_no ASC',
          [routeId]
        );
        if (routeStopsRes.rowCount && routeStopsRes.rowCount > 0) {
          const destStopId = routeStopsRes.rows[routeStopsRes.rows.length - 1].stop_id;
          if (closestStop.id === destStopId && visited.length >= 2) {
            console.log(`[Route Learning] Trip ${tripId} reached destination stop ID ${destStopId}. Auto-completing trip and learning route...`);
            await completeTripAndLearnRoute(tripId);
          }
        }
      }
    } catch (err) {
      console.error('[Route Learning] Error checking destination stop:', err);
    }
  }
}

/**
 * Manually or automatically complete a trip, compare sequence of stops with existing routes,
 * learn new route variant if different, rebuild graph, and mark trip as completed.
 */
export async function completeTripAndLearnRoute(tripId: number) {
  const visited = visitedStopsMap.get(tripId);
  if (!visited || visited.length < 2) {
    console.log(`[Route Learning] Trip ${tripId} has less than 2 visited stops. Cannot learn route.`);
    visitedStopsMap.delete(tripId);
    return;
  }

  try {
    const tripRes = await query(
      `SELECT t.route_id, r.route_code, r.route_name, r.source, r.destination 
       FROM trips t
       JOIN routes r ON t.route_id = r.id
       WHERE t.id = $1`,
      [tripId]
    );

    if (tripRes.rowCount === 0) {
      console.log(`[Route Learning] Trip ${tripId} not found in database.`);
      visitedStopsMap.delete(tripId);
      return;
    }

    const { route_code, source, destination } = tripRes.rows[0];

    const stopsRes = await query('SELECT id, name, latitude, longitude FROM stops');
    const stopsById = new Map<number, any>(stopsRes.rows.map(s => [s.id, s]));

    const traversedStops = visited.map(id => stopsById.get(id)).filter(Boolean);
    if (traversedStops.length < 2) {
      visitedStopsMap.delete(tripId);
      return;
    }

    const startStop = traversedStops[0];
    const endStop = traversedStops[traversedStops.length - 1];

    console.log(`[Route Learning] Trip ${tripId} traversed sequence: ${traversedStops.map(s => s.name).join(' -> ')}`);

    // Fetch all routes between these same source/destination endpoints
    const existingRoutesRes = await query(
      'SELECT id, route_code, route_name FROM routes WHERE source = $1 AND destination = $2',
      [startStop.name, endStop.name]
    );

    let isExistingRouteMatched = false;
    let matchedRouteCode = '';

    for (const route of existingRoutesRes.rows) {
      const rsRes = await query(
        'SELECT stop_id FROM route_stops WHERE route_id = $1 ORDER BY sequence_no ASC',
        [route.id]
      );
      const existingSequence = rsRes.rows.map(r => r.stop_id);

      if (existingSequence.length === visited.length && existingSequence.every((val, index) => val === visited[index])) {
        isExistingRouteMatched = true;
        matchedRouteCode = route.route_code;
        break;
      }
    }

    if (isExistingRouteMatched) {
      console.log(`[Route Learning] Traversed sequence for Trip ${tripId} matches existing route: ${matchedRouteCode}. No new route needed.`);
    } else {
      console.log(`[Route Learning] Traversed sequence is a new path! Creating new route variant...`);

      const randomSuffix = Math.floor(100 + Math.random() * 900);
      const newRouteCode = `${route_code}_VAR_${randomSuffix}`;

      // Build route name using major intermediate stops
      const intermediateNames = traversedStops.slice(1, -1).map(s => s.name.split(',')[0].trim());
      let newRouteName = `${startStop.name} - ${endStop.name}`;
      if (intermediateNames.length > 0) {
        newRouteName += ` (via ${intermediateNames.slice(0, 3).join(', ')}${intermediateNames.length > 3 ? '...' : ''})`;
      }

      let totalDistance = 0;
      for (let i = 0; i < traversedStops.length - 1; i++) {
        totalDistance += haversineKm(
          parseFloat(traversedStops[i].latitude),
          parseFloat(traversedStops[i].longitude),
          parseFloat(traversedStops[i + 1].latitude),
          parseFloat(traversedStops[i + 1].longitude)
        );
      }
      totalDistance = parseFloat(totalDistance.toFixed(2));

      // Insert new route
      const insertRouteRes = await query(
        `INSERT INTO routes (route_code, route_name, source, destination, distance_km)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [newRouteCode, newRouteName, startStop.name, endStop.name, totalDistance]
      );

      const newRouteId = insertRouteRes.rows[0].id;

      // Insert stops mappings
      let cumulativeDist = 0;
      for (let i = 0; i < traversedStops.length; i++) {
        if (i > 0) {
          cumulativeDist += haversineKm(
            parseFloat(traversedStops[i - 1].latitude),
            parseFloat(traversedStops[i - 1].longitude),
            parseFloat(traversedStops[i].latitude),
            parseFloat(traversedStops[i].longitude)
          );
        }
        await query(
          `INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
           VALUES ($1, $2, $3, $4)`,
          [newRouteId, traversedStops[i].id, i + 1, parseFloat(cumulativeDist.toFixed(2))]
        );
      }

      console.log(`[Route Learning] Successfully learned new route variant: ${newRouteCode} - ${newRouteName} (${totalDistance} km)`);
      
      // Rebuild the in-memory graph
      await buildGraph();
    }

    // Set trip status to completed
    await query("UPDATE trips SET status = $1 WHERE id = $2", ['completed', tripId]);

  } catch (err) {
    console.error(`[Route Learning] Error completing trip ${tripId}:`, err);
  } finally {
    visitedStopsMap.delete(tripId);
  }
}
