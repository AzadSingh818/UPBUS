"use strict";
/**
 * villageFilter.ts
 * Pure distance-filtering logic: given a list of candidate villages and a
 * route polyline, return only those within maxDistanceKm.
 *
 * Deliberately isolated from ETA / live-distance logic (see eta.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_DISTANCE_KM = void 0;
exports.filterVillagesByDistance = filterVillagesByDistance;
const geoUtils_1 = require("../engine/geoUtils");
exports.DEFAULT_MAX_DISTANCE_KM = 5;
/**
 * Filter villages to those within maxDistanceKm of the given polyline.
 *
 * @param villages  Candidate villages (from Overpass cache)
 * @param polyline  Ordered route coordinates (stops + optional waypoints)
 * @param maxDistanceKm  Maximum perpendicular distance to include (default: DEFAULT_MAX_DISTANCE_KM)
 */
function filterVillagesByDistance(villages, polyline, maxDistanceKm = exports.DEFAULT_MAX_DISTANCE_KM) {
    if (polyline.length < 2)
        return [];
    const result = [];
    for (const v of villages) {
        const p = { lat: v.latitude, lng: v.longitude };
        const dist = (0, geoUtils_1.distanceToPolylineKm)(p, polyline);
        if (dist <= maxDistanceKm) {
            result.push({
                name: v.name,
                latitude: v.latitude,
                longitude: v.longitude,
                distanceToRouteKm: Number(dist.toFixed(3)),
            });
        }
    }
    // Sort by distance ascending so nearest villages come first
    return result.sort((a, b) => a.distanceToRouteKm - b.distanceToRouteKm);
}
