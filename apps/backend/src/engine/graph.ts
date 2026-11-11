// Use dynamic require so TypeScript does not load and parse massive JSON at compile time
const mockDb: any = require('../db/data.json');
import { query } from '../db';
import { haversineDistanceKm } from './geoUtils';

export interface GraphEdge {
  fromStopId: number;
  toStopId: number;
  routeId: number;
  routeCode: string;
  routeName: string;
  distanceKm: number;
  fromSequenceNo: number;
  toSequenceNo: number;
  // Dynamic Edge Weight for OATS (Optimizing Traffic Flow)
  trafficMultiplier: number;
  effectiveCost: number;
}

export interface PathLegRoute {
  routeId: number;
  routeCode: string;
  routeName: string;
  source: string;
  destination: string;
}

export interface PathLeg {
  routeId: number;
  routeName: string;
  routeCode: string;
  fromStopId: number;
  fromStopName: string;
  toStopId: number;
  toStopName: string;
  distanceKm: number;
  stops: { stopId: number; name: string; sequenceNo: number; latitude: number; longitude: number }[];
  allRoutes?: PathLegRoute[];
}

export interface JourneyPath {
  legs: PathLeg[];
  totalDistanceKm: number;
  totalEffectiveCost: number; // For OATS routing
  totalTransfers: number;
}

// Global graph cache
let graph: Map<number, GraphEdge[]> = new Map();
let stopsMap: Map<number, any> = new Map();
let routeStopsMap: Map<number, any[]> = new Map(); // route_id -> stops
let cachedRoutes: any[] = [];
const dfsPathCache = new Map<string, { timestamp: number; paths: JourneyPath[] }>();
const DFS_CACHE_TTL_MS = 60000;

/**
 * Initializes the graph from DB/Mock DB
 */
export async function buildGraph() {
  graph.clear();
  stopsMap.clear();
  routeStopsMap.clear();
  dfsPathCache.clear();

  // Load stops from database/mock
  const stopsRes = await query('SELECT id, stop_code, name, latitude, longitude FROM stops');
  const stops = stopsRes.rows;
  for (const s of stops) {
    stopsMap.set(s.id, {
      ...s,
      latitude: parseFloat(s.latitude),
      longitude: parseFloat(s.longitude)
    });
    graph.set(s.id, []);
  }

  // Load route_stops and routes from database/mock
  const routeStopsRes = await query('SELECT route_id, stop_id, sequence_no, distance_from_start_km FROM route_stops');
  const routeStops = routeStopsRes.rows;

  const routesRes = await query('SELECT id, route_code, route_name, source, destination, distance_km FROM routes');
  const routes = routesRes.rows;
  cachedRoutes = routes;

  const routeMap = new Map(routes.map((r: any) => [r.id, r]));

  // Group by route
  const byRoute: Record<number, any[]> = {};
  for (const rs of routeStops) {
    if (!byRoute[rs.route_id]) byRoute[rs.route_id] = [];
    byRoute[rs.route_id].push(rs);
  }

  // Build edges
  for (const routeIdStr of Object.keys(byRoute)) {
    const routeId = parseInt(routeIdStr, 10);
    const rStops = byRoute[routeId].sort((a, b) => a.sequence_no - b.sequence_no);
    routeStopsMap.set(routeId, rStops);

    const routeInfo = routeMap.get(routeId);
    if (!routeInfo) continue;

    for (let i = 0; i < rStops.length - 1; i++) {
      const u = rStops[i];

      // Add edges from this stop to ALL subsequent stops on the same route
      for (let j = i + 1; j < rStops.length; j++) {
        const v = rStops[j];

        const distU = parseFloat(u.distance_from_start_km) || 0;
        const distV = parseFloat(v.distance_from_start_km) || 0;

        const distanceKm = Math.abs(distV - distU);
        
        // OATS (Optimizing Traffic Flow): Dynamic Edge Weighting
        // In a full production setup, this would fetch from a live traffic Redis cache.
        // For now, we simulate edge weighting based on distance scale and basic time of day.
        const hour = new Date().getHours();
        let trafficMultiplier = 1.0;
        if ((hour >= 8 && hour < 11) || (hour >= 17 && hour < 20)) {
          trafficMultiplier = 1.4; // 40% more cost during peaks
        } else if (hour >= 22 || hour < 5) {
          trafficMultiplier = 0.8; // Free flow at night
        }
        
        const effectiveCost = distanceKm * trafficMultiplier;

        graph.get(u.stop_id)?.push({
          fromStopId: u.stop_id,
          toStopId: v.stop_id,
          routeId: routeId,
          routeCode: routeInfo.route_code,
          routeName: routeInfo.route_name,
          distanceKm: distanceKm,
          fromSequenceNo: u.sequence_no,
          toSequenceNo: v.sequence_no,
          trafficMultiplier,
          effectiveCost
        });
      }
    }
  }

  console.log(`[Graph Engine] Built graph with ${graph.size} stops and edges.`);
}

/**
 * Finds all paths between two query strings using DFS + Backtracking.
 */
export function findPathsDFS(fromQuery: string, toQuery: string, maxTransfers: number = 2): JourneyPath[] {
  fromQuery = fromQuery.toLowerCase().trim();
  toQuery = toQuery.toLowerCase().trim();

  const cacheKey = `${fromQuery}_${toQuery}_${maxTransfers}`;
  const cached = dfsPathCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < DFS_CACHE_TTL_MS)) {
    return cached.paths;
  }

  let initialStartNodes: number[] = [];
  const initialEndNodes: Set<number> = new Set();

  const isStopMatch = (stopName: string, queryStr: string) => {
    const sName = stopName.toLowerCase().trim();
    const qStr = queryStr.toLowerCase().trim();
    
    if (sName.includes(qStr)) return true;
    
    const cleanS = sName.replace(/\s+(bus station|bus stand|depot|terminal|isbt|kasba|village)$/gi, '').trim();
    const cleanQ = qStr.replace(/\s+(bus station|bus stand|depot|terminal|isbt|kasba|village)$/gi, '').trim();
    
    if (cleanS.length >= 3 && cleanQ.length >= 3) {
      if (cleanS.includes(cleanQ) || cleanQ.includes(cleanS)) return true;
    }
    
    return false;
  };

  for (const [id, stop] of stopsMap.entries()) {
    if (isStopMatch(stop.name, fromQuery)) initialStartNodes.push(id);
    if (isStopMatch(stop.name, toQuery)) initialEndNodes.add(id);
  }

  // Expand startNodes and endNodes to include nearby terminal nodes (within 2 km)
  // Strictly filter by queryStr so that disparate cities with bad geocodes do not cross-pollinate.
  const expandNearbyNodes = (nodeIds: number[], queryStr: string): number[] => {
    const expanded = new Set<number>(nodeIds);
    for (const id of nodeIds) {
      const stop = stopsMap.get(id);
      if (!stop) continue;
      for (const [otherId, otherStop] of stopsMap.entries()) {
        if (expanded.has(otherId)) continue;
        const dist = haversineDistanceKm(
          { lat: stop.latitude, lng: stop.longitude },
          { lat: otherStop.latitude, lng: otherStop.longitude }
        );
        if (dist <= 2.0 && isStopMatch(otherStop.name, queryStr)) { // Same terminal complex & same query scope
          expanded.add(otherId);
        }
      }
    }
    return Array.from(expanded);
  };

  const startNodes = expandNearbyNodes(initialStartNodes, fromQuery);
  const endNodesArray = expandNearbyNodes(Array.from(initialEndNodes), toQuery);
  
  // Guarantee mutual exclusivity: Target nodes must not overlap with start nodes
  const startSet = new Set<number>(startNodes);
  const targetNodesArray = endNodesArray.filter(id => !startSet.has(id));
  const expandedEndNodes = new Set<number>(targetNodesArray);

  // Compute geographical center of destination targets for A* distance heuristic guidance
  let targetCenterLat = 0;
  let targetCenterLng = 0;
  let targetCenterCount = 0;
  for (const tId of expandedEndNodes) {
    const s = stopsMap.get(tId);
    if (s && s.latitude && s.longitude) {
      targetCenterLat += s.latitude;
      targetCenterLng += s.longitude;
      targetCenterCount++;
    }
  }
  const hasTargetCenter = targetCenterCount > 0;
  const avgTargetLat = hasTargetCenter ? targetCenterLat / targetCenterCount : 0;
  const avgTargetLng = hasTargetCenter ? targetCenterLng / targetCenterCount : 0;

  const results: JourneyPath[] = [];
  const state = { steps: 0 };

  for (const start of startNodes) {
    dfs(start, expandedEndNodes, maxTransfers, [], new Set([start]), results, state, hasTargetCenter ? { lat: avgTargetLat, lng: avgTargetLng } : undefined);
  }

  // Filter out any fake micro-legs (under 1.5 km transfers within the same city hub)
  const cleanedResults: JourneyPath[] = [];
  for (const res of results) {
    const validLegs = res.legs.filter(l => l.distanceKm > 1.2 || res.legs.length === 1);
    if (validLegs.length > 0) {
      let totalDist = 0;
      validLegs.forEach(l => totalDist += l.distanceKm);
      cleanedResults.push({
        ...res,
        legs: validLegs,
        totalDistanceKm: totalDist,
        totalTransfers: validLegs.length - 1
      });
    }
  }

  // Sort results by transfers, then OATS dynamic cost
  cleanedResults.sort((a, b) => {
    if (a.totalTransfers !== b.totalTransfers) return a.totalTransfers - b.totalTransfers;
    return a.totalEffectiveCost - b.totalEffectiveCost;
  });

  const uniquePaths = filterUniquePaths(cleanedResults);

  // Prioritize primary corridor routes matching the exact origin/destination city pair
  const isPrimaryCorridor = (p: JourneyPath) => {
    if (p.legs.length !== 1) return false;
    const leg = p.legs[0];
    const rInfo = cachedRoutes.find((r: any) => r.id === leg.routeId);
    if (!rInfo) return false;
    const src = (rInfo.source || '').toLowerCase();
    const dest = (rInfo.destination || '').toLowerCase();
    const cleanFrom = fromQuery.replace(/\s+(bus station|bus stand|depot|terminal|isbt|kasba|village)$/gi, '').trim();
    const cleanTo = toQuery.replace(/\s+(bus station|bus stand|depot|terminal|isbt|kasba|village)$/gi, '').trim();
    
    const srcMatches = src.includes(cleanFrom) || cleanFrom.includes(src);
    const destMatches = dest.includes(cleanTo) || cleanTo.includes(dest);
    
    return srcMatches && destMatches;
  };

  let finalPaths: JourneyPath[] = [];

  const primaryCorridors = uniquePaths.filter(isPrimaryCorridor);
  if (primaryCorridors.length > 0) {
    finalPaths = primaryCorridors.slice(0, 10);
  } else {
    const hasDirectRoute = uniquePaths.some(p => p.totalTransfers === 0);
    if (hasDirectRoute) {
      finalPaths = uniquePaths.filter(p => p.totalTransfers === 0).slice(0, 10);
    } else {
      finalPaths = uniquePaths.slice(0, 10);
    }
  }

  if (dfsPathCache.size > 500) {
    const firstKey = dfsPathCache.keys().next().value;
    if (firstKey) dfsPathCache.delete(firstKey);
  }
  dfsPathCache.set(cacheKey, { timestamp: Date.now(), paths: finalPaths });

  return finalPaths;
}

function dfs(
  current: number,
  targets: Set<number>,
  maxTransfers: number,
  path: GraphEdge[],
  visited: Set<number>,
  results: JourneyPath[],
  state: { steps: number },
  targetCenter?: { lat: number; lng: number }
) {
  if (state.steps++ > 25000) return;

  if (targets.has(current)) {
    const journey = buildJourneyPath(path);
    const startId = path.length > 0 ? path[0].fromStopId : current;
    const startStop = stopsMap.get(startId);
    const targetStop = stopsMap.get(current);
    let geodesic = 0;
    if (startStop && targetStop) {
      geodesic = haversineDistanceKm(
        { lat: startStop.latitude, lng: startStop.longitude },
        { lat: targetStop.latitude, lng: targetStop.longitude }
      );
    }
    const maxAllowedDistance = Math.max(geodesic * 2.5, geodesic + 80);
    if (journey.totalDistanceKm <= maxAllowedDistance) {
      results.push(journey);
    }
    return; // Truncate search immediately upon reaching destination stop!
  }

  // Calculate current transfers
  let transfers = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i].routeId !== path[i - 1].routeId) transfers++;
  }

  if (path.length > maxTransfers + 1) return;

  let edges = graph.get(current) || [];

  // A* Heuristic: Sort edges prioritizing those that bring us closer to the destination target center
  if (targetCenter && edges.length > 1) {
    edges = [...edges].sort((a, b) => {
      // Prioritize edges directly landing on targets first
      const aIsTarget = targets.has(a.toStopId) ? 1 : 0;
      const bIsTarget = targets.has(b.toStopId) ? 1 : 0;
      if (aIsTarget !== bIsTarget) return bIsTarget - aIsTarget;

      const sa = stopsMap.get(a.toStopId);
      const sb = stopsMap.get(b.toStopId);
      const da = sa ? haversineDistanceKm({ lat: sa.latitude, lng: sa.longitude }, targetCenter) : 9999;
      const db = sb ? haversineDistanceKm({ lat: sb.latitude, lng: sb.longitude }, targetCenter) : 9999;
      return da - db;
    });
  }

  for (const edge of edges) {
    // Optimization: The graph has direct edges between ALL pairs of stops on a route.
    // Taking two consecutive edges on the same route is redundant and causes combinatorial explosion.
    if (path.length > 0 && edge.routeId === path[path.length - 1].routeId) {
      continue;
    }

    if (!visited.has(edge.toStopId)) {
      visited.add(edge.toStopId);
      path.push(edge);
      dfs(edge.toStopId, targets, maxTransfers, path, visited, results, state, targetCenter);
      path.pop();
      visited.delete(edge.toStopId);
    }
  }
}

function buildJourneyPath(edges: GraphEdge[]): JourneyPath {
  const legs: PathLeg[] = [];
  let totalDistanceKm = 0;
  let totalEffectiveCost = 0;

  if (edges.length === 0) return { legs, totalDistanceKm, totalEffectiveCost, totalTransfers: 0 };

  let currentLegEdges = [edges[0]];

  for (let i = 1; i < edges.length; i++) {
    if (edges[i].routeId === currentLegEdges[0].routeId) {
      // In our graph, since we add edges to ALL subsequent stops,
      // multiple edges on the SAME route might just be skipped.
      // E.g., A -> B, B -> C on Route 1. We could just have used A -> C directly.
      // To prevent A->B and B->C from appearing as two edges if A->C exists,
      // DFS usually finds the A->C edge!
      currentLegEdges.push(edges[i]);
    } else {
      legs.push(createLeg(currentLegEdges));
      currentLegEdges = [edges[i]];
    }
  }
  legs.push(createLeg(currentLegEdges));

  legs.forEach(l => totalDistanceKm += l.distanceKm);
  edges.forEach(e => totalEffectiveCost += e.effectiveCost);

  return {
    legs,
    totalDistanceKm,
    totalEffectiveCost,
    totalTransfers: legs.length - 1
  };
}

function createLeg(edges: GraphEdge[]): PathLeg {
  // Collapse multiple edges of the same route into one continuous leg
  const firstEdge = edges[0];
  const lastEdge = edges[edges.length - 1];

  const routeId = firstEdge.routeId;
  const routeCode = firstEdge.routeCode;
  const routeName = firstEdge.routeName;

  const fromStopId = firstEdge.fromStopId;
  const toStopId = lastEdge.toStopId;
  const fromSequenceNo = firstEdge.fromSequenceNo;
  const toSequenceNo = lastEdge.toSequenceNo;

  const fromStopName = stopsMap.get(fromStopId)?.name || 'Unknown';
  const toStopName = stopsMap.get(toStopId)?.name || 'Unknown';

  let distanceKm = 0;
  edges.forEach(e => distanceKm += e.distanceKm);

  // Extract all intermediate stops from routeStopsMap
  const rStops = routeStopsMap.get(routeId) || [];
  const legStops = rStops
    .filter(rs => rs.sequence_no >= fromSequenceNo && rs.sequence_no <= toSequenceNo)
    .map(rs => {
      const s = stopsMap.get(rs.stop_id);
      return {
        stopId: s.id,
        name: s.name,
        sequenceNo: rs.sequence_no,
        latitude: parseFloat(s.latitude) || 0,
        longitude: parseFloat(s.longitude) || 0
      };
    });

  return {
    routeId,
    routeName,
    routeCode,
    fromStopId,
    fromStopName,
    toStopId,
    toStopName,
    distanceKm,
    stops: legStops
  };
}

function filterUniquePaths(paths: JourneyPath[]): JourneyPath[] {
  const seen = new Map<string, JourneyPath>();
  const routeMap = new Map<number, any>(cachedRoutes.map((r: any) => [r.id, r]));

  for (const p of paths) {
    // Unique key is based on the sequence of Route IDs used
    // This prevents generating 10 variations of the same journey that just transfer at a different nearby village
    const key = p.legs.map(l => l.routeId).join('-');

    if (!seen.has(key) || p.totalDistanceKm < seen.get(key)!.totalDistanceKm) {
      for (const leg of p.legs) {
        const rInfo = routeMap.get(leg.routeId);
        leg.allRoutes = [{
          routeId: leg.routeId,
          routeCode: leg.routeCode,
          routeName: leg.routeName,
          source: rInfo?.source || '',
          destination: rInfo?.destination || ''
        }];
      }
      seen.set(key, p);
    }
  }

  return Array.from(seen.values());
}

export const getGraph = () => graph;
export const getStopsMap = () => stopsMap;
export const getRouteStopsMap = () => routeStopsMap;

/**
 * Ensure a specific route's edges are present in the live in-memory graph.
 * Called by NewBusDiscoveryService when it auto-matches a new bus to a route.
 *
 * - If the route is already in the graph (routeStopsMap has its stops), this is a no-op.
 * - If the route is new/not yet loaded, it fetches its stops from DB and adds edges.
 */
export async function addLiveRouteEdges(routeId: number): Promise<void> {
  // Check if this route is already in the graph
  if (routeStopsMap.has(routeId)) {
    // Edges already exist — nothing to do
    return;
  }

  try {
    // Fetch route info
    const routeRes = await query(
      'SELECT id, route_code, route_name FROM routes WHERE id = $1',
      [routeId]
    );
    if (routeRes.rows.length === 0) {
      console.warn(`[Graph Engine] addLiveRouteEdges: route ${routeId} not found in DB`);
      return;
    }
    const routeInfo = routeRes.rows[0];

    // Fetch its route_stops with coordinates
    const rsRes = await query(
      `SELECT rs.stop_id, rs.sequence_no, rs.distance_from_start_km,
              s.latitude, s.longitude, s.name
       FROM route_stops rs
       JOIN stops s ON s.id = rs.stop_id
       WHERE rs.route_id = $1
       ORDER BY rs.sequence_no ASC`,
      [routeId]
    );

    if (rsRes.rows.length === 0) {
      console.warn(`[Graph Engine] addLiveRouteEdges: no stops for route ${routeId}`);
      return;
    }

    const rStops = rsRes.rows;

    // Register stops in stopsMap if not already there
    for (const rs of rStops) {
      if (!stopsMap.has(rs.stop_id)) {
        stopsMap.set(rs.stop_id, {
          id: rs.stop_id,
          latitude: parseFloat(rs.latitude),
          longitude: parseFloat(rs.longitude),
          name: rs.name,
        });
        graph.set(rs.stop_id, []);
      }
    }

    // Add edges between all stops on this route
    let newEdgesAdded = 0;
    for (let i = 0; i < rStops.length - 1; i++) {
      const u = rStops[i];
      const distU = parseFloat(u.distance_from_start_km) || 0;

      for (let j = i + 1; j < rStops.length; j++) {
        const v = rStops[j];
        const distV = parseFloat(v.distance_from_start_km) || 0;

        graph.get(u.stop_id)?.push({
          fromStopId: u.stop_id,
          toStopId: v.stop_id,
          routeId,
          routeCode: routeInfo.route_code,
          routeName: routeInfo.route_name,
          distanceKm: Math.abs(distV - distU),
          fromSequenceNo: u.sequence_no,
          toSequenceNo: v.sequence_no,
          trafficMultiplier: 1.0,
          effectiveCost: Math.abs(distV - distU)
        });
        newEdgesAdded++;
      }
    }

    // Cache this route's stops in routeStopsMap
    routeStopsMap.set(routeId, rStops);

    console.log(
      `[Graph Engine] Live route connected: "${routeInfo.route_name}" ` +
      `(routeId=${routeId}) — ${rStops.length} stops, ${newEdgesAdded} edges added to graph.`
    );
  } catch (err) {
    console.error(`[Graph Engine] addLiveRouteEdges error for routeId=${routeId}:`, err);
  }
}

