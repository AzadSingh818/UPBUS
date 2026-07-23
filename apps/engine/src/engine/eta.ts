import { query } from '../db';
import { updateBusFSM, getStopFSMState } from './stopStateFSM';
import { computeBusPositionOnRoute, getWaypointETAs, WaypointETA } from './routeGeometry';

export type { WaypointETA };

export interface StopETA {
  stopId: number;
  name: string;
  sequenceNo: number;
  latitude: number;
  longitude: number;
  distanceRemainingKm: number;
  etaMinutes: number;
  status: 'passed' | 'arriving_now' | 'on_stop' | 'scheduled_to_depart' | 'upcoming';
}

export interface TripETAResponse {
  tripId: number;
  routeId?: number;
  busRegNo: string;
  busType: string;
  routeCode: string;
  routeName: string;
  busLatitude: number;
  busLongitude: number;
  currentSpeedKmph: number;
  heading: number;
  lastSeen: Date;
  status: string;
  stops: StopETA[];
  /** Village waypoints between official stops, ordered along the route */
  waypoints: WaypointETA[];
}

// Haversine distance formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Smart ETA: Time-of-day traffic modifier
function getTrafficSpeedModifier(): number {
  const hour = new Date().getHours();
  // Morning Peak (8 AM - 11 AM) or Evening Peak (5 PM - 8 PM) -> 25% slower
  if ((hour >= 8 && hour < 11) || (hour >= 17 && hour < 20)) {
    return 0.75;
  }
  // Night / Early Morning (10 PM - 5 AM) -> 15% faster
  if (hour >= 22 || hour < 5) {
    return 1.15;
  }
  // Normal hours -> 1.0
  return 1.0;
}

export async function getTripETAs(tripId: number, regNo?: string, routeCode?: string): Promise<TripETAResponse | null> {
  try {
    // 1. Fetch trip and bus details
    const tripRes = await query(
      `SELECT t.id as trip_id, t.status as trip_status, 
              r.route_code, r.route_name,
              b.registration_no, b.bus_type
       FROM trips t
       JOIN routes r ON t.route_id = r.id
       JOIN buses b ON t.bus_id = b.id
       WHERE t.id = $1`,
      [tripId]
    );

    let trip: any = null;
    let live: any = null;
    let fallbackRouteId: number | null = null;

    if (tripRes.rowCount === 0 || regNo) {
      if (!regNo && tripRes.rowCount === 0) return null;
      // Fallback: Fetch dynamic data from Margdarshi API
      try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', { method: 'POST' });
        const liveData = JSON.parse(await res.text());
        const bus = regNo ? liveData.find((b: any) => (b.RegNo || b.regNum || '').toUpperCase().replace(/\s+/g, '') === regNo.toUpperCase().replace(/\s+/g, '')) : null;
        
        if (bus) {
          if ((tripRes.rowCount || 0) > 0) {
            trip = tripRes.rows[0];
            trip.registration_no = bus.RegNo || bus.regNum || trip.registration_no;
            fallbackRouteId = null;

            let matchedRoute: any = null;
            if (routeCode) {
              const rRes = await query(`SELECT id, route_code, route_name FROM routes WHERE route_code = $1 LIMIT 1`, [routeCode]);
              if (rRes.rowCount && rRes.rowCount > 0) {
                matchedRoute = rRes.rows[0];
              }
            }

            if (matchedRoute) {
              fallbackRouteId = matchedRoute.id;
              trip.route_code = matchedRoute.route_code;
              trip.route_name = matchedRoute.route_name;
            } else if (bus.route_description) {
              const routesRes = await query(`SELECT id, route_code, route_name, source, destination FROM routes`);
              const routes = routesRes.rows;
              const matchingRoutes = routes.filter(r => {
                const routeStr = bus.route_description.toUpperCase();
                return routeStr.includes(r.source.toUpperCase()) && routeStr.includes(r.destination.toUpperCase());
              });

              if (matchingRoutes.length > 0) {
                let bestScore = -1;
                let matchedRouteDesc: any = null;
                const routeStr = bus.route_description.toUpperCase();
                for (const r of matchingRoutes) {
                  let score = 0;
                  const dbRouteName = r.route_name.toUpperCase();
                  const keywords = dbRouteName.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3 && w !== 'DEPOT' && w !== 'BUS' && w !== 'STAND' && w !== 'EXPRESS' && w !== 'RETURN');
                  for (const word of keywords) {
                    if (routeStr.includes(word)) {
                      score += 10;
                    }
                  }
                  if (score > bestScore) {
                    bestScore = score;
                    matchedRouteDesc = r;
                  }
                }
                if (matchedRouteDesc) {
                  fallbackRouteId = matchedRouteDesc.id;
                  trip.route_code = matchedRouteDesc.route_code;
                  trip.route_name = matchedRouteDesc.route_name;
                }
              }
            }
          } else {
            // Try to find the best matching route in DB by checking sub-route keywords in the description
            const routesRes = await query(`SELECT id, route_code, route_name, source, destination FROM routes`);
            const routes = routesRes.rows;
            let matchedRoute: any = null;

            if (routeCode) {
              matchedRoute = routes.find(r => r.route_code === routeCode);
            }

            if (!matchedRoute) {
              // Check for divergence override based on current coordinates
              try {
                const { matchBranchForBus, divergenceCache } = require('./divergenceBinding');
                for (const node of (divergenceCache || [])) {
                  const branch = matchBranchForBus(bus.lat || bus.latitude, bus.long || bus.longitude, node.id);
                  if (branch && branch.routeIds.length > 0) {
                    matchedRoute = routes.find(r => r.id === branch.routeIds[0]);
                    if (matchedRoute) {
                      break;
                    }
                  }
                }
              } catch (err) {
                console.error('[Divergence] Error checking route divergence:', err);
              }
            }

            if (!matchedRoute) {
              const matchingRoutes = routes.filter(r => {
                if (!bus.route_description) return false;
                const routeStr = bus.route_description.toUpperCase();
                return routeStr.includes(r.source.toUpperCase()) && routeStr.includes(r.destination.toUpperCase());
              });

              if (matchingRoutes.length > 0) {
                if (matchingRoutes.length === 1) {
                  matchedRoute = matchingRoutes[0];
                } else {
                  let bestScore = -1;
                  const routeStr = (bus.route_description || '').toUpperCase();
                  for (const r of matchingRoutes) {
                    let score = 0;
                    const dbRouteName = r.route_name.toUpperCase();
                    const keywords = dbRouteName.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3 && w !== 'DEPOT' && w !== 'BUS' && w !== 'STAND' && w !== 'EXPRESS' && w !== 'RETURN');
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
                  if (!matchedRoute) matchedRoute = matchingRoutes[0];
                }
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
        } else {
          if (routeCode) {
            const matchedRoute = (await query(`SELECT id, route_code, route_name FROM routes WHERE route_code = $1 LIMIT 1`, [routeCode])).rows[0];
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
            } else {
              return null;
            }
          }
        }
      } catch (e: any) {
        if (e.code === 'ECONNRESET' || e.code === 'ENOTFOUND') {
          console.warn(`⚠️ [ETA Engine] UPSRTC API is currently unreachable (${e.code}). Using local schedule fallback.`);
        } else {
          console.error('Fallback fetch failed:', e.message || e);
        }
        if ((tripRes.rowCount || 0) > 0) {
          trip = tripRes.rows[0];
        } else if (routeCode) {
          // Mock the trip using the routeCode provided
          trip = {
            trip_id: tripId,
            trip_status: 'running',
            route_code: routeCode,
            route_name: 'Direct Route',
            registration_no: regNo || 'Scheduled',
            bus_type: 'UPSRTC'
          };
          fallbackRouteId = (await query(`SELECT id FROM routes WHERE route_code = $1 LIMIT 1`, [routeCode])).rows[0]?.id;
        } else {
          return null;
        }
      }
    } else {
      trip = tripRes.rows[0];
    }

    // 2. Fetch current live location (only if not using fallback)
    if (!live) {
      const liveRes = await query(
        `SELECT latitude, longitude, speed, heading, last_seen_at
         FROM bus_live_state
         WHERE trip_id = $1`,
        [tripId]
      );
      if (liveRes && liveRes.rowCount !== null && liveRes.rowCount > 0) {
        live = liveRes.rows[0];
      }
    }

    // 3. Fetch all stops on this route
    let stopsRes;
    if (fallbackRouteId) {
      stopsRes = await query(
        `SELECT rs.sequence_no, rs.distance_from_start_km,
                s.id as stop_id, s.name, s.latitude, s.longitude
         FROM route_stops rs
         JOIN stops s ON rs.stop_id = s.id
         WHERE rs.route_id = $1
         ORDER BY rs.sequence_no ASC`,
        [fallbackRouteId]
      );
    } else {
      stopsRes = await query(
        `SELECT rs.sequence_no, rs.distance_from_start_km,
                s.id as stop_id, s.name, s.latitude, s.longitude
         FROM route_stops rs
         JOIN stops s ON rs.stop_id = s.id
         JOIN trips t ON rs.route_id = t.route_id
         WHERE t.id = $1
         ORDER BY rs.sequence_no ASC`,
        [tripId]
      );
    }

    const routeStops = stopsRes.rows;
    if (routeStops.length === 0) return null;

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

    // Speed smoothing: Use current speed if > 25 km/h, otherwise floor to 45 km/h (average highway speed)
    // to prevent division by zero or inflated ETAs when stationary at a traffic light or depot
    const speedFloorKmph = (busSpeed > 25 ? busSpeed : 45) * getTrafficSpeedModifier();

    // Fetch bus ID from buses table and load progress cache if available
    const busIdRes = await query(`SELECT id FROM buses WHERE registration_no = $1`, [trip.registration_no]);
    const busId = busIdRes.rowCount && busIdRes.rowCount > 0 ? busIdRes.rows[0].id : null;

    let progressCache: any = null;
    let visitLogs: any[] = [];
    if (busId) {
      const { RouteProgressRepository } = require('../modules/route-progress/repository/RouteProgressRepository');
      progressCache = await RouteProgressRepository.getLastProgress(busId);
      visitLogs = await RouteProgressRepository.getStopVisitLogs(busId);
    }

    // 4. Project bus location onto route path if available
    const routeIdForGeom = trip.route_id || fallbackRouteId;
    let busPos: any = null;
    if (routeIdForGeom) {
      try {
        busPos = computeBusPositionOnRoute(routeIdForGeom, busLat, busLng);
      } catch (e) {
        console.warn('[ETA] Could not compute bus position for passed check:', e);
      }
    }

    // 5a. Find the closest stop sequence based on distance (fallback)
    let closestIndexByDist = 0;
    let minDistance = Infinity;
    for (let i = 0; i < routeStops.length; i++) {
      const stop = routeStops[i];
      const dist = calculateDistance(busLat, busLng, parseFloat(stop.latitude), parseFloat(stop.longitude));
      if (dist < minDistance) {
        minDistance = dist;
        closestIndexByDist = i;
      }
    }

    // 5b. Build the set of sequence numbers considered "passed" (using projected distance or distance fallback)
    const passedSeqs = new Set<number>();
    if (busPos && busPos.busDistKm !== undefined) {
      routeStops.forEach((s: any) => {
        if (parseFloat(s.distance_from_start_km) < busPos.busDistKm) {
          passedSeqs.add(s.sequence_no);
        }
      });
    } else {
      for (let i = 0; i < closestIndexByDist; i++) {
        passedSeqs.add(routeStops[i].sequence_no);
      }
    }

    // 5c. Define the current upcoming stop index (first stop not passed)
    let closestIndex = 0;
    for (let i = 0; i < routeStops.length; i++) {
      if (!passedSeqs.has(routeStops[i].sequence_no)) {
        closestIndex = i;
        break;
      }
      if (i === routeStops.length - 1) {
        closestIndex = i;
      }
    }
    const closestStop = routeStops[closestIndex];
    const closestSeq = closestStop.sequence_no;

    // 5d. Feed current GPS ping into the Stop-State FSM so it can evolve
    const regNoKey = trip.registration_no || `trip_${tripId}`;
    updateBusFSM(
      regNoKey,
      busLat,
      busLng,
      busSpeed,
      routeStops.map((s: any) => ({
        stopId:     s.stop_id,
        sequenceNo: s.sequence_no,
        name:       s.name || '',
        latitude:   parseFloat(s.latitude),
        longitude:  parseFloat(s.longitude)
      })),
      passedSeqs
    );

    // 5c. Calculate ETAs for each stop
    const etas: StopETA[] = [];

    for (let i = 0; i < routeStops.length; i++) {
      const stop = routeStops[i];
      const stopLat = parseFloat(stop.latitude);
      const stopLng = parseFloat(stop.longitude);
      const seq = stop.sequence_no;

      let distanceRemainingKm = 0;
      let etaMinutes = 0;
      let status: 'passed' | 'arriving_now' | 'on_stop' | 'scheduled_to_depart' | 'upcoming' = 'upcoming';

      if (progressCache) {
        // Use calculations based on Route Progress Engine cache
        const stopDistMeters = parseFloat(stop.distance_from_start_km) * 1000;
        const isStopPassed = i <= progressCache.completed_stop_index;

        if (isStopPassed) {
          status = 'passed';
          distanceRemainingKm = 0;
          etaMinutes = 0;
        } else {
          distanceRemainingKm = Math.max(0, stopDistMeters - progressCache.covered_distance) / 1000;
          
          const isAtStop = progressCache.state === 'AT_STOP' && 
            (progressCache.current_stop === stop.name || progressCache.current_segment_from === stop.name);

          if (isAtStop) {
            status = 'on_stop';
            etaMinutes = 0;
          } else if (distanceRemainingKm <= 0.5) {
            status = 'arriving_now';
            etaMinutes = Math.round((distanceRemainingKm / speedFloorKmph) * 60);
          } else {
            status = 'upcoming';
            // Calculate travel time + halt delay
            const intermediateStopsCount = i - Math.max(0, progressCache.completed_stop_index);
            const baseTime = Math.round((distanceRemainingKm / speedFloorKmph) * 60);
            const haltDelay = Math.max(0, intermediateStopsCount - 1) * 2;
            etaMinutes = baseTime + haltDelay;
          }
        }
      } else {
        // Fallback to original FSM and distance calculations
        if (seq < closestSeq) {
          distanceRemainingKm = 0;
          etaMinutes = 0;
          status = 'passed';
        } else if (seq === closestSeq) {
          distanceRemainingKm = calculateDistance(busLat, busLng, stopLat, stopLng);

          const fsmState = getStopFSMState(regNoKey, stop.stop_id);
          const isFirstStop = closestSeq === routeStops[0]?.sequence_no;
          const isPreTrip = trip.trip_status === 'scheduled';

          if (fsmState === 'on_stop') {
            if (isFirstStop && isPreTrip) {
              status = 'scheduled_to_depart';
            } else {
              status = 'on_stop';
            }
            etaMinutes = 0;
          } else if (fsmState === 'arriving_now') {
            status = 'arriving_now';
            etaMinutes = 0;
          } else {
            etaMinutes = Math.round((distanceRemainingKm / speedFloorKmph) * 60);
            status = 'upcoming';
          }
        } else {
          let routeDist = calculateDistance(busLat, busLng, parseFloat(closestStop.latitude), parseFloat(closestStop.longitude));
          for (let j = closestIndex; j < i; j++) {
            const s1 = routeStops[j];
            const s2 = routeStops[j + 1];
            routeDist += calculateDistance(
              parseFloat(s1.latitude), parseFloat(s1.longitude),
              parseFloat(s2.latitude), parseFloat(s2.longitude)
            );
          }

          distanceRemainingKm = routeDist;
          const intermediateStopsCount = i - closestIndex;
          etaMinutes = Math.round((distanceRemainingKm / speedFloorKmph) * 60) + (intermediateStopsCount * 2);
          status = 'upcoming';
        }
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

    // 6. Compute village waypoints using prefix-sum + binary search
    let waypoints: WaypointETA[] = [];
    try {
      if (routeIdForGeom && busPos) {
        waypoints = getWaypointETAs(
          routeIdForGeom,
          busPos.busDistKm,
          busSpeed,
          closestSeq
        );
      }
    } catch (e) {
      // Gracefully degrade — waypoints are bonus info, not critical
      console.warn('[ETA] Could not compute waypoints:', e);
    }

    return {
      tripId,
      routeId: trip.route_id || fallbackRouteId,
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
      stops: etas,
      waypoints
    };
  } catch (error) {
    console.error('Error generating trip ETAs:', error);
    return null;
  }
}
