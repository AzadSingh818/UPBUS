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
exports.getTripETAs = getTripETAs;
const db_1 = require("../db");
// Haversine distance formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
async function getTripETAs(tripId, regNo, routeCode) {
    try {
        // 1. Fetch trip and bus details
        const tripRes = await (0, db_1.query)(`SELECT t.id as trip_id, t.status as trip_status, 
              r.route_code, r.route_name,
              b.registration_no, b.bus_type
       FROM trips t
       JOIN routes r ON t.route_id = r.id
       JOIN buses b ON t.bus_id = b.id
       WHERE t.id = $1`, [tripId]);
        let trip = null;
        let live = null;
        let fallbackRouteId = null;
        if (tripRes.rowCount === 0 || regNo) {
            if (!regNo && tripRes.rowCount === 0)
                return null;
            // Fallback: Fetch dynamic data from Margdarshi API
            try {
                const fetch = (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
                const res = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', { method: 'POST' });
                const liveData = JSON.parse(await res.text());
                const bus = regNo ? liveData.find((b) => (b.RegNo || b.regNum || '').toUpperCase().replace(/\s+/g, '') === regNo.toUpperCase().replace(/\s+/g, '')) : null;
                if (bus) {
                    if ((tripRes.rowCount || 0) > 0) {
                        trip = tripRes.rows[0];
                        trip.registration_no = bus.RegNo || bus.regNum || trip.registration_no;
                        fallbackRouteId = null;
                        if (bus.route_description) {
                            const routesRes = await (0, db_1.query)(`SELECT id, route_code, route_name, source, destination FROM routes`);
                            const routes = routesRes.rows;
                            const matchingRoutes = routes.filter(r => {
                                const routeStr = bus.route_description.toUpperCase();
                                return routeStr.includes(r.source.toUpperCase()) && routeStr.includes(r.destination.toUpperCase());
                            });
                            if (matchingRoutes.length > 0) {
                                let bestScore = -1;
                                let matchedRoute = null;
                                const routeStr = bus.route_description.toUpperCase();
                                for (const r of matchingRoutes) {
                                    let score = 0;
                                    const dbRouteName = r.route_name.toUpperCase();
                                    const keywords = dbRouteName.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && w !== 'DEPOT' && w !== 'BUS' && w !== 'STAND' && w !== 'EXPRESS' && w !== 'RETURN');
                                    for (const word of keywords) {
                                        if (routeStr.includes(word)) {
                                            score += 10;
                                        }
                                    }
                                    if (score > bestScore) {
                                        bestScore = score;
                                        matchedRoute = r;
                                    }
                                }
                                if (matchedRoute) {
                                    fallbackRouteId = matchedRoute.id;
                                    trip.route_code = matchedRoute.route_code;
                                    trip.route_name = matchedRoute.route_name;
                                }
                            }
                        }
                        else if (routeCode) {
                            const matchedRoute = (await (0, db_1.query)(`SELECT id, route_code, route_name FROM routes WHERE route_code = $1 LIMIT 1`, [routeCode])).rows[0];
                            if (matchedRoute) {
                                fallbackRouteId = matchedRoute.id;
                                trip.route_code = matchedRoute.route_code;
                                trip.route_name = matchedRoute.route_name;
                            }
                        }
                    }
                    else {
                        // Try to find the best matching route in DB by checking sub-route keywords in the description
                        const routesRes = await (0, db_1.query)(`SELECT id, route_code, route_name, source, destination FROM routes`);
                        const routes = routesRes.rows;
                        const matchingRoutes = routes.filter(r => {
                            if (!bus.route_description)
                                return false;
                            const routeStr = bus.route_description.toUpperCase();
                            return routeStr.includes(r.source.toUpperCase()) && routeStr.includes(r.destination.toUpperCase());
                        });
                        let matchedRoute = null;
                        if (matchingRoutes.length > 0) {
                            if (matchingRoutes.length === 1) {
                                matchedRoute = matchingRoutes[0];
                            }
                            else {
                                let bestScore = -1;
                                const routeStr = (bus.route_description || '').toUpperCase();
                                for (const r of matchingRoutes) {
                                    let score = 0;
                                    const dbRouteName = r.route_name.toUpperCase();
                                    const keywords = dbRouteName.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && w !== 'DEPOT' && w !== 'BUS' && w !== 'STAND' && w !== 'EXPRESS' && w !== 'RETURN');
                                    for (const word of keywords) {
                                        if (routeStr.includes(word)) {
                                            score += 10;
                                        }
                                    }
                                    if (score > bestScore) {
                                        bestScore = score;
                                        matchedRoute = r;
                                    }
                                }
                                if (!matchedRoute)
                                    matchedRoute = matchingRoutes[0];
                            }
                        }
                        if (!matchedRoute) {
                            matchedRoute = routes[0];
                        }
                        fallbackRouteId = matchedRoute.id;
                        trip = {
                            trip_id: tripId,
                            trip_status: 'running',
                            route_code: matchedRoute.route_code,
                            route_name: matchedRoute.route_name,
                            registration_no: bus.RegNo || bus.regNum,
                            bus_type: 'UPSRTC'
                        };
                    }
                    live = {
                        latitude: bus.lat || bus.latitude,
                        longitude: bus.long || bus.longitude,
                        speed: bus.speed,
                        heading: bus.heading,
                        last_seen_at: bus.LogrecTime || new Date()
                    };
                }
                else {
                    if (routeCode) {
                        const matchedRoute = (await (0, db_1.query)(`SELECT id, route_code, route_name FROM routes WHERE route_code = $1 LIMIT 1`, [routeCode])).rows[0];
                        if (matchedRoute) {
                            fallbackRouteId = matchedRoute.id;
                            trip = {
                                trip_id: tripId,
                                trip_status: 'scheduled',
                                route_code: matchedRoute.route_code,
                                route_name: matchedRoute.route_name,
                                registration_no: regNo || 'Scheduled',
                                bus_type: 'UPSRTC'
                            };
                        }
                    }
                    if (!trip) {
                        if ((tripRes.rowCount || 0) > 0) {
                            trip = tripRes.rows[0];
                        }
                        else {
                            return null;
                        }
                    }
                }
            }
            catch (e) {
                console.error('Fallback fetch failed', e);
                if ((tripRes.rowCount || 0) > 0) {
                    trip = tripRes.rows[0];
                }
                else if (routeCode) {
                    // Mock the trip using the routeCode provided
                    trip = {
                        trip_id: tripId,
                        trip_status: 'running',
                        route_code: routeCode,
                        route_name: 'Direct Route',
                        registration_no: regNo || 'Scheduled',
                        bus_type: 'UPSRTC'
                    };
                    fallbackRouteId = (await (0, db_1.query)(`SELECT id FROM routes WHERE route_code = $1 LIMIT 1`, [routeCode])).rows[0]?.id;
                }
                else {
                    return null;
                }
            }
        }
        else {
            trip = tripRes.rows[0];
        }
        // 2. Fetch current live location (only if not using fallback)
        if (!live) {
            const liveRes = await (0, db_1.query)(`SELECT latitude, longitude, speed, heading, last_seen_at
         FROM bus_live_state
         WHERE trip_id = $1`, [tripId]);
            if (liveRes && liveRes.rowCount !== null && liveRes.rowCount > 0) {
                live = liveRes.rows[0];
            }
        }
        // 3. Fetch all stops on this route
        let stopsRes;
        if (fallbackRouteId) {
            stopsRes = await (0, db_1.query)(`SELECT rs.sequence_no, rs.distance_from_start_km,
                s.id as stop_id, s.name, s.latitude, s.longitude
         FROM route_stops rs
         JOIN stops s ON rs.stop_id = s.id
         WHERE rs.route_id = $1
         ORDER BY rs.sequence_no ASC`, [fallbackRouteId]);
        }
        else {
            stopsRes = await (0, db_1.query)(`SELECT rs.sequence_no, rs.distance_from_start_km,
                s.id as stop_id, s.name, s.latitude, s.longitude
         FROM route_stops rs
         JOIN stops s ON rs.stop_id = s.id
         JOIN trips t ON rs.route_id = t.route_id
         WHERE t.id = $1
         ORDER BY rs.sequence_no ASC`, [tripId]);
        }
        const routeStops = stopsRes.rows;
        if (routeStops.length === 0)
            return null;
        if (!live) {
            // Mock live using the first stop so we can return the offline schedule!
            live = {
                latitude: routeStops[0].latitude,
                longitude: routeStops[0].longitude,
                speed: 0,
                heading: 0,
                last_seen_at: new Date()
            };
        }
        const busLat = parseFloat(live.latitude);
        const busLng = parseFloat(live.longitude);
        const busSpeed = parseFloat(live.speed);
        const heading = parseFloat(live.heading);
        // Speed smoothing: Use current speed if > 25 km/h, otherwise floor to 40 km/h (average highway speed)
        // to prevent division by zero or inflated ETAs when stationary at a traffic light or depot
        const speedFloorKmph = busSpeed > 25 ? busSpeed : 45;
        // 4. Find the closest stop to the bus
        let closestIndex = 0;
        let minDistance = Infinity;
        for (let i = 0; i < routeStops.length; i++) {
            const stop = routeStops[i];
            const dist = calculateDistance(busLat, busLng, parseFloat(stop.latitude), parseFloat(stop.longitude));
            if (dist < minDistance) {
                minDistance = dist;
                closestIndex = i;
            }
        }
        const closestStop = routeStops[closestIndex];
        const closestSeq = closestStop.sequence_no;
        // 5. Calculate ETAs for each stop
        const etas = [];
        for (let i = 0; i < routeStops.length; i++) {
            const stop = routeStops[i];
            const stopLat = parseFloat(stop.latitude);
            const stopLng = parseFloat(stop.longitude);
            const seq = stop.sequence_no;
            let distanceRemainingKm = 0;
            let etaMinutes = 0;
            let status = 'upcoming';
            if (seq < closestSeq) {
                // Stop is in the past
                distanceRemainingKm = 0;
                etaMinutes = 0;
                status = 'passed';
            }
            else if (seq === closestSeq) {
                // Bus is close to this stop or has just reached it
                distanceRemainingKm = calculateDistance(busLat, busLng, stopLat, stopLng);
                etaMinutes = Math.round((distanceRemainingKm / speedFloorKmph) * 60);
                if (distanceRemainingKm < 0.3) {
                    status = 'arriving_soon';
                    etaMinutes = 0; // At terminal
                }
                else {
                    status = 'upcoming';
                }
            }
            else {
                // Future stop: Cumulative segment distance along the route
                // Dist = Dist(Bus -> ClosestStop) + Dist(ClosestStop -> NextStop) + ... + Dist(NextStop -> TargetStop)
                let routeDist = calculateDistance(busLat, busLng, parseFloat(closestStop.latitude), parseFloat(closestStop.longitude));
                for (let j = closestIndex; j < i; j++) {
                    const s1 = routeStops[j];
                    const s2 = routeStops[j + 1];
                    routeDist += calculateDistance(parseFloat(s1.latitude), parseFloat(s1.longitude), parseFloat(s2.latitude), parseFloat(s2.longitude));
                }
                distanceRemainingKm = routeDist;
                // Time = (Distance / Speed) * 60 + Halt delay of 2 mins per intermediate stop
                const intermediateStopsCount = i - closestIndex;
                etaMinutes = Math.round((distanceRemainingKm / speedFloorKmph) * 60) + (intermediateStopsCount * 2);
                status = 'upcoming';
            }
            etas.push({
                stopId: stop.stop_id,
                name: stop.name,
                sequenceNo: seq,
                latitude: stopLat,
                longitude: stopLng,
                distanceRemainingKm: parseFloat(distanceRemainingKm.toFixed(2)),
                etaMinutes,
                status
            });
        }
        return {
            tripId,
            // If we found a closest stop, visually snap the bus towards the polyline between closestStop and the surrounding stops
            // For now, we will just pass the real coordinate, BUT the frontend will snap it or draw it better if it has real routeStops!
            // Actually, since the bus is truly on this route, its latitude/longitude WILL physically match the drawn route line very closely!
            // If the user wants to see the bus directly on the line, we could return closestStop's lat/lng, but that's jumpy.
            // The real coordinates are best.
            busRegNo: trip.registration_no,
            busType: trip.bus_type,
            routeCode: trip.route_code,
            routeName: trip.route_name,
            busLatitude: busLat,
            busLongitude: busLng,
            currentSpeedKmph: busSpeed,
            heading,
            lastSeen: live.last_seen_at,
            status: trip.trip_status,
            stops: etas
        };
    }
    catch (error) {
        console.error('Error generating trip ETAs:', error);
        return null;
    }
}
