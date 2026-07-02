"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.haversineDistanceKm = haversineDistanceKm;
exports.pointToSegmentDistanceKm = pointToSegmentDistanceKm;
exports.distanceToPolylineKm = distanceToPolylineKm;
/** Haversine distance (km) between two coordinates */
function haversineDistanceKm(a, b) {
    const R = 6371; // Earth radius in km
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
/** Convert lat/lng to Cartesian (meters) for projection */
function toCartesian(coord) {
    const R = 6371000; // meters
    const φ = (coord.lat * Math.PI) / 180;
    const λ = (coord.lng * Math.PI) / 180;
    const cosφ = Math.cos(φ);
    return {
        x: R * cosφ * Math.cos(λ),
        y: R * cosφ * Math.sin(λ),
        z: R * Math.sin(φ)
    };
}
/** Perpendicular distance (km) from point p to segment a‑b */
function pointToSegmentDistanceKm(p, a, b) {
    const P = toCartesian(p);
    const A = toCartesian(a);
    const B = toCartesian(b);
    const AB = { x: B.x - A.x, y: B.y - A.y, z: B.z - A.z };
    const AP = { x: P.x - A.x, y: P.y - A.y, z: P.z - A.z };
    const len2 = AB.x * AB.x + AB.y * AB.y + AB.z * AB.z;
    let t = len2 === 0 ? 0 : (AP.x * AB.x + AP.y * AB.y + AP.z * AB.z) / len2;
    t = Math.max(0, Math.min(1, t)); // clamp
    const C = { x: A.x + t * AB.x, y: A.y + t * AB.y, z: A.z + t * AB.z };
    const d = Math.sqrt((P.x - C.x) ** 2 + (P.y - C.y) ** 2 + (P.z - C.z) ** 2);
    return d / 1000; // meters to km
}
/** Minimum distance (km) from point p to a polyline */
function distanceToPolylineKm(p, polyline) {
    if (polyline.length < 2)
        return Infinity;
    let min = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
        const d = pointToSegmentDistanceKm(p, polyline[i], polyline[i + 1]);
        if (d < min)
            min = d;
    }
    return min;
}
