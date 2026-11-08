"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNearestStopName = resolveNearestStopName;
const db_1 = require("../db");
let cachedStops = null;
function getHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radius of Earth in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) *
            Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
/**
 * Find the nearest geocoded stop or highway milestone for a given bus GPS location
 */
function resolveNearestStopName(lat, lng, fallbackDistrict) {
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
        return fallbackDistrict ? `Near: ${fallbackDistrict}` : 'Near: UP Highway En-route';
    }
    if (!cachedStops) {
        if (db_1.mockDb && Array.isArray(db_1.mockDb.stops) && db_1.mockDb.stops.length > 0) {
            cachedStops = db_1.mockDb.stops;
        }
    }
    if (!cachedStops || cachedStops.length === 0) {
        return fallbackDistrict ? `Near: ${fallbackDistrict}` : 'Near: UP Highway En-route';
    }
    let nearest = null;
    let minDistanceMeters = Infinity;
    // Find nearest stop within 50km
    for (const s of cachedStops) {
        // Quick bounding box filter to avoid calculating haversine for thousands of stops
        if (Math.abs(s.latitude - lat) > 0.4 || Math.abs(s.longitude - lng) > 0.4) {
            continue;
        }
        const dist = getHaversineDistanceMeters(lat, lng, s.latitude, s.longitude);
        if (dist < minDistanceMeters) {
            minDistanceMeters = dist;
            nearest = s;
        }
    }
    if (nearest && minDistanceMeters < 35000) {
        const km = (minDistanceMeters / 1000).toFixed(1);
        if (minDistanceMeters < 500) {
            return `At: ${nearest.name}`;
        }
        return `Near: ${nearest.name} (${km} km)`;
    }
    if (fallbackDistrict && fallbackDistrict.length > 2) {
        const cleanDistrict = fallbackDistrict.split(',')[0].trim();
        return `Near: ${cleanDistrict} Sector`;
    }
    return 'Near: UP Highway En-route';
}
