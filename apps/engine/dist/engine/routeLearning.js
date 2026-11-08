"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.visitedStopsMap = void 0;
exports.recordLiveLocation = recordLiveLocation;
exports.completeTripAndLearnRoute = completeTripAndLearnRoute;
const db_1 = require("../db");
const graph_1 = require("./graph");
const adminMonitor_1 = require("../services/adminMonitor");
// In-memory cache of stops to avoid querying the DB on every single ping
let stopsCache = [];
let lastStopsFetch = 0;
async function getStops() {
    const now = Date.now();
    if (stopsCache.length === 0 || now - lastStopsFetch > 60000) {
        try {
            const res = await (0, db_1.query)('SELECT id, name, latitude, longitude FROM stops');
            stopsCache = res.rows.map(s => ({
                id: s.id,
                name: s.name,
                latitude: parseFloat(s.latitude),
                longitude: parseFloat(s.longitude)
            }));
            lastStopsFetch = now;
        }
        catch (err) {
            console.error('[Route Learning] Error loading stops cache:', err);
        }
    }
    return stopsCache;
}
// Earth radius in km
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Map tracking visited stops for active trips
// TTL-tracked: entries older than 4 hours are automatically evicted to prevent memory leak
exports.visitedStopsMap = new Map();
const visitedStopsLastSeen = new Map(); // tripId → last active timestamp
const TRIP_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours max per trip
const MAX_TRIPS_IN_MEMORY = 5000; // Hard cap — never store more than 5000 trips at once
// Periodic cleanup: evict stale trips every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - TRIP_TTL_MS;
    let evicted = 0;
    for (const [tripId, lastSeen] of visitedStopsLastSeen.entries()) {
        if (lastSeen < cutoff) {
            exports.visitedStopsMap.delete(tripId);
            visitedStopsLastSeen.delete(tripId);
            evicted++;
        }
    }
    if (evicted > 0) {
        console.log(`[Route Learning] Evicted ${evicted} stale trip(s) from memory. Active trips: ${exports.visitedStopsMap.size}`);
    }
}, 5 * 60 * 1000);
/**
 * Record a live bus GPS update and detect if a stop is visited.
 */
async function recordLiveLocation(tripId, busId, latitude, longitude, speed) {
    if (isNaN(latitude) || isNaN(longitude))
        return;
    const stops = await getStops();
    const thresholdKm = 0.2; // 200 meters proximity geofence for learning stops
    let closestStop = null;
    let minDistance = Infinity;
    for (const stop of stops) {
        const dist = haversineKm(latitude, longitude, stop.latitude, stop.longitude);
        if (dist <= thresholdKm && dist < minDistance) {
            minDistance = dist;
            closestStop = stop;
        }
    }
    if (closestStop) {
        let visited = exports.visitedStopsMap.get(tripId);
        if (!visited) {
            // Hard cap: if at limit, skip adding new trips to avoid OOM
            if (exports.visitedStopsMap.size >= MAX_TRIPS_IN_MEMORY)
                return;
            visited = [];
            exports.visitedStopsMap.set(tripId, visited);
        }
        // Refresh TTL on every activity
        visitedStopsLastSeen.set(tripId, Date.now());
        // Add stop if different from the last recorded stop (avoid duplicate consecutive records)
        if (visited.length === 0 || visited[visited.length - 1] !== closestStop.id) {
            visited.push(closestStop.id);
            console.log(`[Route Learning] Trip ${tripId} visited stop: ${closestStop.name} (Stop ID: ${closestStop.id})`);
            adminMonitor_1.adminMonitor.addLog({
                type: 'LEARNING',
                busId,
                message: `Trip ${tripId} visited stop: ${closestStop.name} (Stop ID: ${closestStop.id})`
            });
            // Run AI Route Prediction asynchronously
            predictRouteForTrip(tripId, busId, visited).catch(err => {
                console.error('[Route Prediction] Error predicting route:', err);
            });
        }
        // Auto-detect trip completion when the destination stop is reached
        try {
            const tripRes = await (0, db_1.query)('SELECT route_id FROM trips WHERE id = $1', [tripId]);
            if (tripRes.rowCount && tripRes.rowCount > 0) {
                const routeId = tripRes.rows[0].route_id;
                const routeStopsRes = await (0, db_1.query)('SELECT stop_id FROM route_stops WHERE route_id = $1 ORDER BY sequence_no ASC', [routeId]);
                if (routeStopsRes.rowCount && routeStopsRes.rowCount > 0) {
                    const destStopId = routeStopsRes.rows[routeStopsRes.rows.length - 1].stop_id;
                    if (closestStop.id === destStopId && visited.length >= 2) {
                        console.log(`[Route Learning] Trip ${tripId} reached destination stop ID ${destStopId}. Auto-completing trip and learning route...`);
                        await completeTripAndLearnRoute(tripId);
                    }
                }
            }
        }
        catch (err) {
            console.error('[Route Learning] Error checking destination stop:', err);
        }
    }
}
/**
 * Manually or automatically complete a trip, compare sequence of stops with existing routes,
 * learn new route variant if different, rebuild graph, and mark trip as completed.
 */
async function completeTripAndLearnRoute(tripId) {
    const visited = exports.visitedStopsMap.get(tripId);
    if (!visited || visited.length < 2) {
        console.log(`[Route Learning] Trip ${tripId} has less than 2 visited stops. Cannot learn route.`);
        exports.visitedStopsMap.delete(tripId);
        return;
    }
    try {
        const tripRes = await (0, db_1.query)(`SELECT t.route_id, r.route_code, r.route_name, r.source, r.destination 
       FROM trips t
       JOIN routes r ON t.route_id = r.id
       WHERE t.id = $1`, [tripId]);
        if (tripRes.rowCount === 0) {
            console.log(`[Route Learning] Trip ${tripId} not found in database.`);
            exports.visitedStopsMap.delete(tripId);
            return;
        }
        const { route_code, source, destination } = tripRes.rows[0];
        const stopsRes = await (0, db_1.query)('SELECT id, name, latitude, longitude FROM stops');
        const stopsById = new Map(stopsRes.rows.map(s => [s.id, s]));
        const traversedStops = visited.map(id => stopsById.get(id)).filter(Boolean);
        if (traversedStops.length < 2) {
            exports.visitedStopsMap.delete(tripId);
            return;
        }
        const startStop = traversedStops[0];
        const endStop = traversedStops[traversedStops.length - 1];
        console.log(`[Route Learning] Trip ${tripId} traversed sequence: ${traversedStops.map(s => s.name).join(' -> ')}`);
        // Check against ALL existing routes to prevent duplicates (Bidirectional & Subset checking)
        const existingRoutesRes = await (0, db_1.query)('SELECT id, route_code, route_name FROM routes');
        let isExistingRouteMatched = false;
        let matchedRouteCode = '';
        // Helper to check if array 'sub' is an ordered subset of array 'full'
        const isSubsequence = (sub, full) => {
            let subIdx = 0;
            for (let i = 0; i < full.length && subIdx < sub.length; i++) {
                if (full[i] === sub[subIdx]) {
                    subIdx++;
                }
            }
            return subIdx === sub.length;
        };
        for (const route of existingRoutesRes.rows) {
            const rsRes = await (0, db_1.query)('SELECT stop_id FROM route_stops WHERE route_id = $1 ORDER BY sequence_no ASC', [route.id]);
            const existingSequence = rsRes.rows.map(r => r.stop_id);
            const forwardMatch = isSubsequence(visited, existingSequence);
            const reverseMatch = isSubsequence(visited, [...existingSequence].reverse());
            if (forwardMatch || reverseMatch) {
                isExistingRouteMatched = true;
                matchedRouteCode = route.route_code;
                break;
            }
        }
        if (isExistingRouteMatched) {
            console.log(`[Route Learning] Traversed sequence for Trip ${tripId} matches existing route: ${matchedRouteCode}. No new route needed.`);
        }
        else {
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
                totalDistance += haversineKm(parseFloat(traversedStops[i].latitude), parseFloat(traversedStops[i].longitude), parseFloat(traversedStops[i + 1].latitude), parseFloat(traversedStops[i + 1].longitude));
            }
            totalDistance = parseFloat(totalDistance.toFixed(2));
            // Insert new route
            const insertRouteRes = await (0, db_1.query)(`INSERT INTO routes (route_code, route_name, source, destination, distance_km)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`, [newRouteCode, newRouteName, startStop.name, endStop.name, totalDistance]);
            const newRouteId = insertRouteRes.rows[0].id;
            // Insert stops mappings
            let cumulativeDist = 0;
            for (let i = 0; i < traversedStops.length; i++) {
                if (i > 0) {
                    cumulativeDist += haversineKm(parseFloat(traversedStops[i - 1].latitude), parseFloat(traversedStops[i - 1].longitude), parseFloat(traversedStops[i].latitude), parseFloat(traversedStops[i].longitude));
                }
                await (0, db_1.query)(`INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
           VALUES ($1, $2, $3, $4)`, [newRouteId, traversedStops[i].id, i + 1, parseFloat(cumulativeDist.toFixed(2))]);
            }
            console.log(`[Route Learning] Successfully learned new route variant: ${newRouteCode} - ${newRouteName} (${totalDistance} km)`);
            // Rebuild the in-memory graph
            await (0, graph_1.buildGraph)();
        }
        // Set trip status to completed
        await (0, db_1.query)("UPDATE trips SET status = $1 WHERE id = $2", ['completed', tripId]);
    }
    catch (err) {
        console.error(`[Route Learning] Error processing route data for trip ${tripId}:`, err);
    }
    finally {
        exports.visitedStopsMap.delete(tripId);
    }
}
// ─── AI ROUTE PREDICTION ────────────────────────────────────────────────────────
let cachedPredictiveRoutes = [];
let lastPredictiveRoutesFetch = 0;
async function getPredictiveRoutes() {
    const now = Date.now();
    if (cachedPredictiveRoutes.length === 0 || now - lastPredictiveRoutesFetch > 300000) { // 5 minutes cache
        try {
            const routesRes = await (0, db_1.query)('SELECT id, route_name, route_code FROM routes WHERE id != 1');
            const stopsRes = await (0, db_1.query)('SELECT route_id, stop_id FROM route_stops ORDER BY route_id, sequence_no ASC');
            const routesMap = new Map();
            for (const r of routesRes.rows) {
                routesMap.set(r.id, { ...r, stops: [] });
            }
            for (const s of stopsRes.rows) {
                if (routesMap.has(s.route_id)) {
                    routesMap.get(s.route_id).stops.push(s.stop_id);
                }
            }
            cachedPredictiveRoutes = Array.from(routesMap.values());
            lastPredictiveRoutesFetch = now;
        }
        catch (err) {
            console.error('[Route Prediction] Error loading routes cache:', err);
        }
    }
    return cachedPredictiveRoutes;
}
async function predictRouteForTrip(tripId, busId, visitedStopIds) {
    if (visitedStopIds.length < 3)
        return; // Need at least 3 stops to confidently predict a route
    // Check if trip is still unassigned (route_id = 1)
    const tripRes = await (0, db_1.query)('SELECT route_id, registration_no FROM trips t JOIN buses b ON t.bus_id = b.id WHERE t.id = $1', [tripId]);
    if (tripRes.rowCount === 0 || tripRes.rows[0].route_id !== 1)
        return;
    const regNo = tripRes.rows[0].registration_no;
    const routes = await getPredictiveRoutes();
    const matchedRoutes = routes.filter(r => {
        let vIdx = 0;
        for (const stopId of r.stops) {
            if (stopId === visitedStopIds[vIdx]) {
                vIdx++;
                if (vIdx === visitedStopIds.length)
                    return true;
            }
        }
        return false;
    });
    if (matchedRoutes.length > 0) {
        // If multiple matches, pick the one with the fewest total stops (closest to the sequence)
        matchedRoutes.sort((a, b) => a.stops.length - b.stops.length);
        const bestMatch = matchedRoutes[0];
        console.log(`[Route Prediction] Trip ${tripId} predicted to be on route: ${bestMatch.route_name}`);
        // Update the trip with the new predicted route
        await (0, db_1.query)('UPDATE trips SET route_id = $1 WHERE id = $2', [bestMatch.id, tripId]);
        // Broadcast to Admin Monitor dynamically to avoid circular dependencies
        Promise.resolve().then(() => __importStar(require('../services/adminMonitor'))).then(({ adminMonitor }) => {
            adminMonitor.updateBus(busId, regNo, {
                routeName: bestMatch.route_name,
                routeCode: bestMatch.route_code
            });
            adminMonitor.addLog({
                type: 'LEARNING',
                busId: busId,
                regNo: regNo,
                status: 'success',
                message: `AI predicted route: ${bestMatch.route_name} based on ${visitedStopIds.length} stops visited.`
            });
        });
    }
}
