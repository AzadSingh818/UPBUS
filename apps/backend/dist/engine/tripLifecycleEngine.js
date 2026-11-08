"use strict";
/**
 * Phase 2: Dynamic Trip Lifecycle Finite State Machine (FSM)
 *
 * States:
 *   IDLE_AT_DEPOT  -> Bus stationary or creeping inside depot boundary (< 15 km/h or within 600m geofence)
 *   DEPARTING      -> Bus crossed depot geofence with 2-3 consecutive pings > 15 km/h
 *   IN_TRANSIT     -> Bus actively cruising along corridor, tracking heading and road segments
 *   APPROACHING_NODE -> Bus within 500m of a Divergence Node (e.g. Phandpuri)
 *   ARRIVING       -> Bus decelerating near destination terminus (< 1000m and speed dropping)
 *   COMPLETED      -> Bus reached final stop or parked in destination depot
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripLifecycleEngine = void 0;
exports.haversineMeters = haversineMeters;
const corridorMatcher_1 = require("../utils/corridorMatcher");
function haversineMeters(lat1, lon1, lat2, lon2) {
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
class TripLifecycleEngine {
    trips = new Map();
    depots = [];
    constructor(depots) {
        this.depots = depots;
    }
    /**
     * Find nearest depot within geofence radius
     */
    findNearestDepot(lat, lng) {
        let nearest = null;
        let minDistance = Infinity;
        for (const d of this.depots) {
            const dist = haversineMeters(lat, lng, d.latitude, d.longitude);
            if (dist <= d.radiusMeters && dist < minDistance) {
                minDistance = dist;
                nearest = d;
            }
        }
        return nearest;
    }
    /**
     * Process a single incoming GPS ping for a vehicle through the Lifecycle FSM
     */
    processPing(regNo, ping) {
        let lifecycle = this.trips.get(regNo);
        if (!lifecycle) {
            // Initialize lifecycle state
            const nearestDepot = this.findNearestDepot(ping.latitude, ping.longitude);
            lifecycle = {
                tripId: `TRIP_${regNo}_${ping.timestamp}`,
                regNo,
                state: nearestDepot ? 'IDLE_AT_DEPOT' : 'IN_TRANSIT',
                originDepot: nearestDepot || undefined,
                consecutiveFastPings: ping.speed >= 15 ? 1 : 0,
                initialPings: [ping],
                distanceTraveledKm: 0,
                lastPing: ping
            };
            this.trips.set(regNo, lifecycle);
            return lifecycle;
        }
        const prevPing = lifecycle.lastPing;
        if (prevPing) {
            const distM = haversineMeters(prevPing.latitude, prevPing.longitude, ping.latitude, ping.longitude);
            lifecycle.distanceTraveledKm += distM / 1000;
        }
        lifecycle.lastPing = ping;
        // FSM State Transitions
        switch (lifecycle.state) {
            case 'IDLE_AT_DEPOT': {
                const depot = lifecycle.originDepot;
                const distFromDepot = depot
                    ? haversineMeters(ping.latitude, ping.longitude, depot.latitude, depot.longitude)
                    : Infinity;
                const isOutsideGeofence = !depot || distFromDepot > depot.radiusMeters;
                // Both conditions must be met concurrently: outside geofence AND speed >= 15 km/h
                if (isOutsideGeofence && ping.speed >= 15) {
                    lifecycle.consecutiveFastPings++;
                }
                else {
                    lifecycle.consecutiveFastPings = 0;
                }
                // DEPARTURE TRIGGER:
                // Must have at least 2 consecutive pings outside geofence at speed >= 15 km/h
                if (lifecycle.consecutiveFastPings >= 2) {
                    lifecycle.state = 'DEPARTING';
                    lifecycle.departureTime = ping.timestamp;
                    lifecycle.tripId = `TRIP_${regNo}_${ping.timestamp}`;
                    lifecycle.initialPings.push(ping);
                    // Calculate initial exit road bearing
                    if (depot) {
                        lifecycle.lockedExitBearing = (0, corridorMatcher_1.calculateBearingDegrees)(depot.latitude, depot.longitude, ping.latitude, ping.longitude);
                    }
                    else {
                        lifecycle.lockedExitBearing = ping.heading;
                    }
                }
                break;
            }
            case 'DEPARTING': {
                lifecycle.initialPings.push(ping);
                // After recording 3-4 departure pings and reaching cruise speed, transition to IN_TRANSIT
                if (lifecycle.initialPings.length >= 3 && ping.speed >= 25) {
                    lifecycle.state = 'IN_TRANSIT';
                }
                break;
            }
            case 'IN_TRANSIT': {
                // Active journey underway - handled by corridor matcher & divergence node detector
                break;
            }
            case 'APPROACHING_NODE': {
                // Node branch resolution active
                break;
            }
            case 'ARRIVING': {
                if (ping.speed < 5) {
                    lifecycle.state = 'COMPLETED';
                }
                break;
            }
            case 'COMPLETED': {
                // If vehicle moves again from a depot, reset for new trip
                const newDepot = this.findNearestDepot(ping.latitude, ping.longitude);
                if (newDepot && ping.speed < 10) {
                    lifecycle.state = 'IDLE_AT_DEPOT';
                    lifecycle.originDepot = newDepot;
                    lifecycle.consecutiveFastPings = 0;
                    lifecycle.initialPings = [ping];
                    lifecycle.distanceTraveledKm = 0;
                }
                break;
            }
        }
        return lifecycle;
    }
    getTrip(regNo) {
        return this.trips.get(regNo);
    }
}
exports.TripLifecycleEngine = TripLifecycleEngine;
