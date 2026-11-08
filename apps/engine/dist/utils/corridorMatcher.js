"use strict";
/**
 * Universal Spatial Corridor Matcher with Directional Heading & Stop Relativity
 * Filters buses by checking their road alignment and compass heading,
 * and determines whether the bus is approaching or has passed a specific stop.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateBearingDegrees = calculateBearingDegrees;
exports.angularDifferenceDegrees = angularDifferenceDegrees;
exports.pointToSegmentDistanceKm = pointToSegmentDistanceKm;
exports.matchBusToCorridor = matchBusToCorridor;
/**
 * Calculates bearing (compass heading in degrees 0-360) from point 1 to point 2
 */
function calculateBearingDegrees(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
        Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}
/**
 * Calculates the smallest angular difference between two headings (0-180 degrees)
 */
function angularDifferenceDegrees(angle1, angle2) {
    const diff = Math.abs((angle1 - angle2 + 180) % 360 - 180);
    return diff;
}
/**
 * Calculates perpendicular distance from a GPS point (lat, lng)
 * to a road segment line (lat1, lng1) -> (lat2, lng2) in kilometers.
 */
function pointToSegmentDistanceKm(plat, plng, lat1, lng1, lat2, lng2) {
    const dx = (lat2 - lat1) * 111.0;
    const dy = (lng2 - lng1) * 111.0 * Math.cos((lat1 * Math.PI) / 180);
    if (dx === 0 && dy === 0) {
        return Math.hypot((plat - lat1) * 111.0, (plng - lng1) * 111.0 * Math.cos((lat1 * Math.PI) / 180));
    }
    const pdx = (plat - lat1) * 111.0;
    const pdy = (plng - lng1) * 111.0 * Math.cos((lat1 * Math.PI) / 180);
    const t = Math.max(0, Math.min(1, (pdx * dx + pdy * dy) / (dx * dx + dy * dy)));
    const nearestLat = lat1 + t * (lat2 - lat1);
    const nearestLng = lng1 + t * (lng2 - lng1);
    return Math.hypot((plat - nearestLat) * 111.0, (plng - nearestLng) * 111.0 * Math.cos((plat * Math.PI) / 180));
}
/**
 * Evaluates whether a bus at (busLat, busLng) with given heading and speed
 * is actively travelling in the direction of the route corridor.
 *
 * @param busLat Current bus latitude
 * @param busLng Current bus longitude
 * @param busHeading Compass heading of bus (0-360)
 * @param busSpeed Current speed in km/h
 * @param routeStops Full ordered list of stops from origin to destination
 * @param boardingStopIndex The index of the stop where the passenger wants to board (default 0)
 * @param maxOffsetKm Maximum road offset tolerance (default 2.5 km)
 */
function matchBusToCorridor(busLat, busLng, busHeading, busSpeed, routeStops, boardingStopIndex = 0, maxOffsetKm = 2.5) {
    if (!routeStops || routeStops.length < 2) {
        return {
            isMatch: false,
            minOffsetKm: 999,
            nearestStopIndex: -1,
            distanceAlongRouteKm: 0,
            isDirectionAligned: false,
            isApproachingBoardingStop: false,
            distanceToBoardingKm: 999
        };
    }
    let minOffsetKm = Infinity;
    let nearestSegIdx = 0;
    for (let i = 0; i < routeStops.length - 1; i++) {
        const s1 = routeStops[i];
        const s2 = routeStops[i + 1];
        if (s1.latitude == null || s1.longitude == null || s2.latitude == null || s2.longitude == null)
            continue;
        const offset = pointToSegmentDistanceKm(busLat, busLng, Number(s1.latitude), Number(s1.longitude), Number(s2.latitude), Number(s2.longitude));
        if (offset < minOffsetKm) {
            minOffsetKm = offset;
            nearestSegIdx = i;
        }
    }
    // If bus is too far from the physical corridor (> 2.5 km), it's on a different highway
    if (minOffsetKm > maxOffsetKm) {
        return {
            isMatch: false,
            minOffsetKm,
            nearestStopIndex: -1,
            distanceAlongRouteKm: 0,
            isDirectionAligned: false,
            isApproachingBoardingStop: false,
            distanceToBoardingKm: 999
        };
    }
    // 1. Calculate the direction vector (bearing) of the road segment where the bus is
    const segStart = routeStops[nearestSegIdx];
    const segEnd = routeStops[nearestSegIdx + 1];
    const roadBearing = calculateBearingDegrees(Number(segStart.latitude), Number(segStart.longitude), Number(segEnd.latitude), Number(segEnd.longitude));
    // 2. Direction Alignment Check:
    // If moving (speed > 5 km/h), heading must match route bearing within 75 degrees!
    // If bus is stationary at depot/halted, heading might be uncalibrated, so allow if near origin stop (< 1.5 km)
    let isDirectionAligned = true;
    if (busSpeed >= 6) {
        const angleDiff = angularDifferenceDegrees(busHeading, roadBearing);
        // If angle diff > 80°, bus is traveling in the opposite direction (e.g. Return trip)
        if (angleDiff > 80) {
            isDirectionAligned = false;
        }
    }
    else {
        // Stationary bus: Only consider valid if stationary within 1.5 km of start or midway stop
        const distToSegStart = Math.hypot((busLat - Number(segStart.latitude)) * 111.0, (busLng - Number(segStart.longitude)) * 111.0);
        if (distToSegStart > 2.0 && nearestSegIdx === 0) {
            isDirectionAligned = false; // Random parked vehicle away from depot
        }
    }
    if (!isDirectionAligned) {
        return {
            isMatch: false,
            minOffsetKm,
            nearestStopIndex: nearestSegIdx,
            distanceAlongRouteKm: 0,
            isDirectionAligned: false,
            isApproachingBoardingStop: false,
            distanceToBoardingKm: 999
        };
    }
    // 3. Compute distance of bus along the route corridor from stop 0
    let distanceAlongRouteKm = 0;
    for (let i = 0; i < nearestSegIdx; i++) {
        const s1 = routeStops[i];
        const s2 = routeStops[i + 1];
        distanceAlongRouteKm += Math.hypot((Number(s2.latitude) - Number(s1.latitude)) * 111.0, (Number(s2.longitude) - Number(s1.longitude)) * 111.0 * Math.cos((Number(s1.latitude) * Math.PI) / 180));
    }
    distanceAlongRouteKm += Math.hypot((busLat - Number(segStart.latitude)) * 111.0, (busLng - Number(segStart.longitude)) * 111.0 * Math.cos((busLat * Math.PI) / 180));
    // 4. Compute distance to passenger's boarding stop
    let boardingStopDistAlongRouteKm = 0;
    for (let i = 0; i < Math.min(boardingStopIndex, routeStops.length - 1); i++) {
        const s1 = routeStops[i];
        const s2 = routeStops[i + 1];
        boardingStopDistAlongRouteKm += Math.hypot((Number(s2.latitude) - Number(s1.latitude)) * 111.0, (Number(s2.longitude) - Number(s1.longitude)) * 111.0 * Math.cos((Number(s1.latitude) * Math.PI) / 180));
    }
    // Bus is approaching if its position along route is before or at passenger boarding stop (with 0.8 km margin)
    const isApproachingBoardingStop = distanceAlongRouteKm <= (boardingStopDistAlongRouteKm + 0.8);
    const distanceToBoardingKm = Math.abs(boardingStopDistAlongRouteKm - distanceAlongRouteKm);
    return {
        isMatch: true,
        minOffsetKm: Math.round(minOffsetKm * 100) / 100,
        nearestStopIndex: nearestSegIdx,
        distanceAlongRouteKm: Math.round(distanceAlongRouteKm * 10) / 10,
        isDirectionAligned: true,
        isApproachingBoardingStop,
        distanceToBoardingKm: Math.round(distanceToBoardingKm * 10) / 10
    };
}
