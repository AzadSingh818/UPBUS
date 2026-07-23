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

/** Radius (km) within which we start calling it "Arriving Now". */
export let ARRIVING_RADIUS_KM = 0.5;

/** Radius (km) within which entry into "On Stop" can be triggered. */
export let ON_STOP_RADIUS_KM = 0.05;

/**
 * Hysteresis exit radius (km). Bus must move *beyond* this radius to leave
 * the "On Stop" state. Must be >= ON_STOP_RADIUS_KM.
 */
export let ON_STOP_EXIT_RADIUS_KM = 0.10;

/** Speed (km/h) below which the bus counts as "stationary" for dwell check. */
export let SPEED_THRESHOLD_KMPH = 5;

/**
 * Number of consecutive pings the bus must meet (inside-geofence AND slow)
 * before flipping from "Arriving Now" → "On Stop".
 * Default ingestion interval = 10 s → 2 pings ≈ 20 s minimum dwell.
 */
export let DWELL_PINGS = 2;

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

// ── Haversine helper (private copy to avoid circular imports) ─────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    const dist = haversineKm(busLat, busLng, stop.latitude, stop.longitude);
    const isSlow = speedKmph < SPEED_THRESHOLD_KMPH;

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
        if (dist <= ARRIVING_RADIUS_KM) {
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
        if (dist <= ON_STOP_RADIUS_KM && isSlow) {
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
          if (dist > ARRIVING_RADIUS_KM) {
            rec.state = 'upcoming';
          }
        }
        break;

      case 'on_stop':
        // Use hysteresis exit radius to avoid flicker
        if (dist > ON_STOP_EXIT_RADIUS_KM) {
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
