"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MapMatcher = void 0;
class MapMatcher {
    static match(lat, lng, stops, hmmState, currentTimestampMs) {
        if (stops.length === 0) {
            return {
                matchedLatitude: lat,
                matchedLongitude: lng,
                coveredDistance: 0
            };
        }
        if (stops.length < 2) {
            return {
                matchedLatitude: stops[0].latitude,
                matchedLongitude: stops[0].longitude,
                coveredDistance: stops[0].distance_from_start
            };
        }
        let bestScore = Infinity;
        let bestLat = lat;
        let bestLng = lng;
        let bestCoveredDistance = hmmState ? hmmState.lastCoveredDistance : 0;
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            // Prevent snapping to segments that are strictly "behind" us if we have a strong HMM state
            if (hmmState && b.distance_from_start < hmmState.lastCoveredDistance - 500) {
                continue; // Only allow slight backwards drift
            }
            const dx = b.longitude - a.longitude;
            const dy = b.latitude - a.latitude;
            const lenSq = dx * dx + dy * dy;
            let t = 0;
            if (lenSq !== 0) {
                t = ((lng - a.longitude) * dx + (lat - a.latitude) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t)); // clamp to segment
            }
            const projLat = a.latitude + t * dy;
            const projLng = a.longitude + t * dx;
            // 1. Emission Probability (Cost): How far is GPS point from the road segment?
            const R = 6371;
            const dLat = (projLat - lat) * Math.PI / 180;
            const dLon = (projLng - lng) * Math.PI / 180;
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(projLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            const emissionDistMeters = (R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))) * 1000;
            const segLength = b.distance_from_start - a.distance_from_start;
            const candidateCoveredDistance = Math.round(a.distance_from_start + t * segLength);
            // 2. Transition Probability (Cost): Is it physically possible?
            let transitionCost = 0;
            if (hmmState && currentTimestampMs) {
                const dtSeconds = (currentTimestampMs - hmmState.lastTimestamp) / 1000;
                const distMoved = candidateCoveredDistance - hmmState.lastCoveredDistance;
                if (dtSeconds > 0) {
                    const impliedSpeed = Math.abs(distMoved) / dtSeconds; // m/s
                    // If implied speed is > 35 m/s (126 km/h), heavily penalize
                    if (impliedSpeed > 35) {
                        transitionCost += (impliedSpeed - 35) * 100;
                    }
                }
                // Penalize moving backwards significantly
                if (distMoved < -50) {
                    transitionCost += Math.abs(distMoved) * 10;
                }
            }
            // Total Cost = Emission Cost + Transition Cost
            // We want to minimize this score
            const totalScore = emissionDistMeters + transitionCost;
            if (totalScore < bestScore) {
                bestScore = totalScore;
                bestLat = projLat;
                bestLng = projLng;
                bestCoveredDistance = candidateCoveredDistance;
            }
        }
        return {
            matchedLatitude: bestLat,
            matchedLongitude: bestLng,
            coveredDistance: bestCoveredDistance
        };
    }
}
exports.MapMatcher = MapMatcher;
