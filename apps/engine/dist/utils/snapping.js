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
exports.getRouteStopCoordinates = getRouteStopCoordinates;
exports.snapToRoute = snapToRoute;
const turf = __importStar(require("@turf/turf"));
const db_1 = require("../db");
/**
 * Fetch ordered stop coordinates for a route from the database
 */
function getRouteStopCoordinates(routeId) {
    if (!db_1.mockDb || !db_1.mockDb.route_stops || !db_1.mockDb.stops) {
        return [];
    }
    const rsList = db_1.mockDb.route_stops
        .filter((rs) => Number(rs.route_id) === Number(routeId))
        .sort((a, b) => a.sequence_no - b.sequence_no);
    return rsList
        .map((rs) => {
        const stop = db_1.mockDb.stops.find((s) => Number(s.id) === Number(rs.stop_id));
        return stop ? [Number(stop.latitude), Number(stop.longitude)] : null;
    })
        .filter((c) => c !== null);
}
/**
 * Snap raw coordinates to the nearest point on the route's path (sequence of stops)
 */
function snapToRoute(lat, lng, routeId) {
    try {
        const stopCoords = getRouteStopCoordinates(routeId);
        if (!stopCoords || stopCoords.length < 2) {
            return { latitude: lat, longitude: lng };
        }
        // Turf lineString expects coordinates in [Longitude, Latitude] format
        const line = turf.lineString(stopCoords.map(c => [c[1], c[0]]));
        const pt = turf.point([lng, lat]);
        const snapped = turf.nearestPointOnLine(line, pt);
        const coords = snapped.geometry.coordinates;
        return { latitude: coords[1], longitude: coords[0] };
    }
    catch (error) {
        // Return original coordinate as safe fallback
        return { latitude: lat, longitude: lng };
    }
}
