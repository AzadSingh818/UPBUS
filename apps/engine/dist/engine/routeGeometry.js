"use strict";
// src/engine/routeGeometry.ts
/**
 * Route Geometry Engine – handles prefix‑sum distances along a route (official stops + village waypoints).
 * Provides:
 *   - buildRouteGeometries(waypointsData) – called at startup, reads data.json and waypoints.json.
 *   - computeBusPositionOnRoute(routeId, lat, lng) – returns the bus's cumulative distance along the route.
 *   - getWaypointETAs(routeId, busDistKm, busSpeedKmph, closestSeq) – returns upcoming village WaypointETAs.
 *   - dumpGeometrySummary() – debugging summary.
 *   - getRouteGeometry(routeId) – for debug endpoint.
 */
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
exports.RouteGeometryEngine = void 0;
exports.buildRouteGeometries = buildRouteGeometries;
exports.getRouteGeometry = getRouteGeometry;
exports.dumpGeometrySummary = dumpGeometrySummary;
exports.computeBusPositionOnRoute = computeBusPositionOnRoute;
exports.getWaypointETAs = getWaypointETAs;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/** Internal store – map route_id → geometry */
const geometries = new Map();
/** Helper – haversine distance km */
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
/**
 * Build geometry for all routes.
 * waypointsData is the content of apps/backend/src/db/waypoints.json (or null).
 * The function extracts official stops from data.json and interleaves village waypoints
 * according to their projection order (t) that we stored during fetching.
 */
function buildRouteGeometries(waypointsData) {
    let dataPath = path.join(__dirname, '../db/data.json');
    if (!fs.existsSync(dataPath) || fs.statSync(dataPath).size === 0) {
        dataPath = path.resolve(__dirname, '../../../backend/src/db/data.json');
    }
    let data;
    try {
        data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
    catch (err) {
        console.warn('[RouteGeometry] Reading fallback backend data.json due to engine data.json contention...');
        const fallbackPath = path.resolve(__dirname, '../../../backend/src/db/data.json');
        data = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
    }
    const stopsById = {};
    for (const s of data.stops)
        stopsById[s.id] = s;
    const routeStopsByRoute = {};
    for (const rs of data.route_stops) {
        if (!routeStopsByRoute[rs.route_id])
            routeStopsByRoute[rs.route_id] = [];
        routeStopsByRoute[rs.route_id].push(rs);
    }
    const wpIndex = new Map();
    if (waypointsData && waypointsData.route_waypoints) {
        for (const rw of waypointsData.route_waypoints) {
            const key = `${rw.route_id}|${rw.between_stop_seqs[0]}-${rw.between_stop_seqs[1]}`;
            wpIndex.set(key, rw.waypoints);
        }
    }
    const sortStops = (arr) => arr.sort((a, b) => a.sequence_no - b.sequence_no);
    for (const route of data.routes) {
        const stopSeqs = sortStops(routeStopsByRoute[route.id] || []);
        const points = [];
        const prefixKm = [];
        let cumulative = 0;
        for (let i = 0; i < stopSeqs.length; i++) {
            const rs = stopSeqs[i];
            const stop = stopsById[rs.stop_id];
            if (!stop)
                continue;
            const stopPt = {
                type: 'stop',
                name: stop.name,
                latitude: parseFloat(stop.latitude),
                longitude: parseFloat(stop.longitude),
                seq: rs.sequence_no
            };
            if (points.length) {
                cumulative += haversine(points[points.length - 1].latitude, points[points.length - 1].longitude, stopPt.latitude, stopPt.longitude);
            }
            points.push(stopPt);
            prefixKm.push(cumulative);
            if (i < stopSeqs.length - 1) {
                const nextSeq = stopSeqs[i + 1].sequence_no;
                const key = `${route.id}|${rs.sequence_no}-${nextSeq}`;
                const wps = wpIndex.get(key) || [];
                for (const wp of wps) {
                    const vp = {
                        type: 'village',
                        name: wp.name,
                        latitude: wp.lat,
                        longitude: wp.lng
                    };
                    cumulative += haversine(points[points.length - 1].latitude, points[points.length - 1].longitude, vp.latitude, vp.longitude);
                    points.push(vp);
                    prefixKm.push(cumulative);
                }
            }
        }
        geometries.set(route.id, { points, prefixKm, totalKm: cumulative });
    }
}
/** Retrieve geometry for a route – used by debug endpoint */
function getRouteGeometry(routeId) {
    return geometries.get(routeId);
}
/** Dump a lightweight summary for all routes */
function dumpGeometrySummary() {
    const summary = {};
    for (const [id, geom] of geometries.entries()) {
        summary[id] = {
            totalPoints: geom.points.length,
            totalKm: Number(geom.totalKm.toFixed(2))
        };
    }
    return summary;
}
/**
 * Compute the bus's position along a route.
 * Returns the cumulative distance (km) of the nearest point on the polyline.
 */
function computeBusPositionOnRoute(routeId, lat, lng) {
    const geom = geometries.get(routeId);
    if (!geom)
        return null;
    const pts = geom.points;
    if (pts.length < 2)
        return null;
    let bestDist = Infinity;
    let bestCum = 0;
    let bestSeq = -1;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.longitude - a.longitude;
        const dy = b.latitude - a.latitude;
        const lenSq = dx * dx + dy * dy;
        let t = 0;
        if (lenSq !== 0) {
            t = ((lng - a.longitude) * dx + (lat - a.latitude) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
        }
        const projLat = a.latitude + t * dy;
        const projLng = a.longitude + t * dx;
        const d = haversine(lat, lng, projLat, projLng);
        if (d < bestDist) {
            bestDist = d;
            const segLen = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
            bestCum = geom.prefixKm[i] + t * segLen;
            bestSeq = a.seq ?? -1;
        }
    }
    return { busDistKm: bestCum, closestSeq: bestSeq };
}
/**
 * Given a bus's distance along the route, speed, and the index of the nearest official stop,
 * compute upcoming village waypoints (type === 'village') and their ETA.
 */
function getWaypointETAs(routeId, busDistKm, speedKmph, closestSeq) {
    const geom = geometries.get(routeId);
    if (!geom)
        return [];
    const result = [];
    for (let i = 0; i < geom.points.length; i++) {
        const pt = geom.points[i];
        if (pt.type !== 'village')
            continue;
        const distFromBus = geom.prefixKm[i] - busDistKm;
        if (distFromBus <= 0)
            continue;
        const eta = speedKmph > 0 ? Math.round((distFromBus / speedKmph) * 60) : Infinity;
        result.push({ name: pt.name, distanceFromBusKm: Number(distFromBus.toFixed(2)), etaMinutes: eta });
    }
    return result;
}
exports.RouteGeometryEngine = {
    buildRouteGeometries,
    computeBusPositionOnRoute,
    getWaypointETAs,
    dumpGeometrySummary,
    getRouteGeometry
};
