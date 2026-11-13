/**
 * stopStateFSM.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Finite State Machine for per-(bus, stop) status.
 *
 * States:
 *   upcoming      – bus is en-route, no special badge
 *   arriving_now  – bus is within ARRIVING_RADIUS_KM of the stop
 *   on_stop       – bus is inside ON_STOP_RADIUS_KM AND speed < SPEED_THRESHOLD_KMPH
 *                   for at least DWELL_PINGS consecutive pings
 *   departed      – bus was "on_stop" and has left the exit geofence
 *
 * Hysteresis:
 *   Entry radius  = ON_STOP_RADIUS_KM
 *   Exit  radius  = ON_STOP_EXIT_RADIUS_KM  (larger → prevents flicker at boundary)
 *
 * All tuneable constants are exported so they can be overridden from env-vars
 * or unit tests without rebuilding.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Tuneable constants ────────────────────────────────────────────────────────

/** Radius (km) within which we start calling it "Arriving Now" (~1.2 km). */
export let ARRIVING_RADIUS_KM = 1.2;

/** Radius (km) within which entry into "On Stop" is triggered (100 meters = 0.10 km). */
export let ON_STOP_RADIUS_KM = 0.10;

/**
 * Hysteresis exit radius (km). Bus must move beyond 120 meters (0.12 km) to exit "On Stop".
 */
export let ON_STOP_EXIT_RADIUS_KM = 0.12;

/** Speed (km/h) below which the bus counts as "stationary / stopped at platform". */
export let SPEED_THRESHOLD_KMPH = 12;

/**
 * Number of consecutive pings the bus must meet (inside 100m geofence)
 * before flipping to "On Stop".
 */
export let DWELL_PINGS = 1;

/** Allow runtime override of any constant (useful for future tuning UI). */
export function configureFSM(overrides: Partial<{
  ARRIVING_RADIUS_KM: number;
  ON_STOP_RADIUS_KM: number;
  ON_STOP_EXIT_RADIUS_KM: number;
  SPEED_THRESHOLD_KMPH: number;
  DWELL_PINGS: number;
}>) {
  if (overrides.ARRIVING_RADIUS_KM    !== undefined) ARRIVING_RADIUS_KM    = overrides.ARRIVING_RADIUS_KM;
  if (overrides.ON_STOP_RADIUS_KM     !== undefined) ON_STOP_RADIUS_KM     = overrides.ON_STOP_RADIUS_KM;
  if (overrides.ON_STOP_EXIT_RADIUS_KM !== undefined) ON_STOP_EXIT_RADIUS_KM = overrides.ON_STOP_EXIT_RADIUS_KM;
  if (overrides.SPEED_THRESHOLD_KMPH  !== undefined) SPEED_THRESHOLD_KMPH  = overrides.SPEED_THRESHOLD_KMPH;
  if (overrides.DWELL_PINGS           !== undefined) DWELL_PINGS           = overrides.DWELL_PINGS;
}

// ── State types ───────────────────────────────────────────────────────────────

export type StopFSMState = 'upcoming' | 'arriving_now' | 'on_stop' | 'departed';

interface PerStopRecord {
  state: StopFSMState;
  /** How many consecutive pings the bus has been inside the geofence + slow. */
  dwellCount: number;
}

/** Key = `${busRegNo}:${stopId}` */
const stateMap = new Map<string, PerStopRecord>();

// ── Geofencing & Ray-Casting Helpers ──────────────────────────────────────────

/**
 * Dynamically generates a virtual polygon (Geofence) around a central coordinate.
 * Creates a bounding box polygon (square) with the given radius.
 */
function getStopGeofencePolygon(stopLat: number, stopLng: number, radiusKm: number): Array<[number, number]> {
  // Rough conversion: 1 deg lat = 111 km
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos(stopLat * Math.PI / 180));
  
  return [
    [stopLat + dLat, stopLng - dLng], // Top-Left
    [stopLat + dLat, stopLng + dLng], // Top-Right
    [stopLat - dLat, stopLng + dLng], // Bottom-Right
    [stopLat - dLat, stopLng - dLng]  // Bottom-Left
  ];
}

/**
 * Ray-Casting Algorithm
 * Draws a ray from the bus's coordinate to infinity. Counts intersections with
 * the polygon boundaries. Odd number of intersections means the point is inside.
 */
function isPointInPolygon(pointLat: number, pointLng: number, polygon: Array<[number, number]>): boolean {
  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    // Check if the ray intersects the edge
    const intersect = ((yi > pointLng) !== (yj > pointLng))
        && (pointLat < (xj - xi) * (pointLng - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Feed a new GPS ping for a bus and update FSM state for every stop on its
 * route. Call this once per ingestion cycle per bus.
 *
 * @param busRegNo  Registration number (used as part of the state map key)
 * @param busLat    Current GPS latitude
 * @param busLng    Current GPS longitude
 * @param speedKmph Current speed in km/h
 * @param stops     Array of stop objects for the route  (id, lat, lng, sequenceNo)
 * @param busAlreadyPassedSeqs Set of sequenceNo values the ETA engine has
 *                             already classified as "passed" (stops behind the bus).
 *                             The FSM ignores those — they cannot become "on_stop".
 */
export function updateBusFSM(
  busRegNo: string,
  busLat: number,
  busLng: number,
  speedKmph: number,
  stops: Array<{ stopId: number; sequenceNo: number; name: string; latitude: number; longitude: number }>,
  busAlreadyPassedSeqs: Set<number>
): void {
  for (const stop of stops) {
    const key = `${busRegNo}:${stop.stopId}`;
    const isSlow = speedKmph < SPEED_THRESHOLD_KMPH;

    // Generate dynamic geofences for this specific stop
    const arrivingPolygon = getStopGeofencePolygon(stop.latitude, stop.longitude, ARRIVING_RADIUS_KM);
    const onStopPolygon = getStopGeofencePolygon(stop.latitude, stop.longitude, ON_STOP_RADIUS_KM);
    const exitPolygon = getStopGeofencePolygon(stop.latitude, stop.longitude, ON_STOP_EXIT_RADIUS_KM);

    // Apply Ray-Casting
    const isInsideArriving = isPointInPolygon(busLat, busLng, arrivingPolygon);
    const isInsideOnStop = isPointInPolygon(busLat, busLng, onStopPolygon);
    const isOutsideExit = !isPointInPolygon(busLat, busLng, exitPolygon);

    // Fetch (or initialise) the per-stop record
    let rec = stateMap.get(key);
    if (!rec) {
      rec = { state: 'upcoming', dwellCount: 0 };
      stateMap.set(key, rec);
    }

    // Once departed, don't re-enter for this bus-trip combination
    if (rec.state === 'departed') continue;

    // Stops already behind the bus that the graph engine has classified as
    // "passed" should be treated as departed
    if (busAlreadyPassedSeqs.has(stop.sequenceNo)) {
      rec.state = 'departed';
      rec.dwellCount = 0;
      continue;
    }

    switch (rec.state) {
      case 'upcoming':
        if (isInsideArriving) {
          rec.state = 'arriving_now';
          rec.dwellCount = 0;
          
          // Trigger push notification: arriving soon
          try {
            const { sendArrivalNotification } = require('../services/notificationService');
            sendArrivalNotification(busRegNo, stop.name, 2).catch(console.error);
          } catch (err: any) {
            console.error('Failed to trigger arrival notification:', err.message);
          }
        }
        break;

      case 'arriving_now':
        if (isInsideOnStop && isSlow) {
          rec.dwellCount += 1;
          if (rec.dwellCount >= DWELL_PINGS) {
            rec.state = 'on_stop';
            
            // Trigger push notification: arrived
            try {
              const { sendNotificationToAll } = require('../services/notificationService');
              sendNotificationToAll({
                title: `Bus Arrived! 🚌`,
                body: `Bus ${busRegNo} has arrived at ${stop.name}.`,
                tag: `arrived-${busRegNo}`,
                icon: '/favicon.ico'
              }).catch(console.error);
            } catch (err: any) {
              console.error('Failed to trigger arrival notification:', err.message);
            }
          }
        } else {
          // Reset dwell counter if conditions break
          rec.dwellCount = 0;
          // If bus moved far away from the stop again without entering, go back
          if (!isInsideArriving) {
            rec.state = 'upcoming';
          }
        }
        break;

      case 'on_stop':
        // Use hysteresis exit polygon to avoid flicker
        if (isOutsideExit) {
          rec.state = 'departed';
          rec.dwellCount = 0;
        }
        break;
    }
  }
}

/**
 * Read the current FSM state for a specific (bus, stop) pair.
 * Returns 'upcoming' if no record exists yet (safe default).
 */
export function getStopFSMState(busRegNo: string, stopId: number): StopFSMState {
  return stateMap.get(`${busRegNo}:${stopId}`)?.state ?? 'upcoming';
}

/**
 * Clear all FSM state for a bus (call when a trip ends or bus goes offline).
 */
export function clearBusFSM(busRegNo: string): void {
  for (const key of stateMap.keys()) {
    if (key.startsWith(`${busRegNo}:`)) {
      stateMap.delete(key);
    }
  }
}

/**
 * Diagnostic: return a snapshot of all active FSM states.
 * Useful for a future admin/debug endpoint.
 */
export function dumpFSMState(): Record<string, PerStopRecord> {
  const out: Record<string, PerStopRecord> = {};
  for (const [k, v] of stateMap.entries()) {
    out[k] = { ...v };
  }
  return out;
}
