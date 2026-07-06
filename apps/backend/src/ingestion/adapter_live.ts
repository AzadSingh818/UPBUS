import { query } from '../db';
import { recordLiveLocation } from '../engine/routeLearning';
import { RouteProgressEngine } from '../modules/route-progress/service/RouteProgressEngine';
import { adminMonitor } from '../services/adminMonitor';
import { newBusDiscovery } from '../services/newBusDiscovery';

/**
 * Live GPS adapter for UPSRTC Margdarshi API.
 * Fetches real-time location of ALL active UPSRTC buses in Uttar Pradesh.
 * API returns ~9,000-13,000 buses with full telemetry.
 */

export interface CanonicalVehicleLocation {
  registrationNo: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  timestamp: Date;
  status: 'moving' | 'halted' | 'offline';
  routeName?: string;
  nextStop?: string;
  destination?: string;
  depotName?: string;
  zoneName?: string;
}

const MARGDARSHI_URL = 'https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php';
const FETCH_INTERVAL_MS = 30_000; // Fetch every 30 seconds
const FETCH_TIMEOUT_MS = 20_000;

let ingestionTimer: NodeJS.Timeout | null = null;
let lastFetchCount = 0;

/**
 * Parse a raw Margdarshi API bus object into our canonical format.
 */
function parseMargdarshiBus(raw: any): CanonicalVehicleLocation | null {
  const regNo = raw.RegNo || raw.regNum || raw.registration_no || raw.bus_id;
  const lat = parseFloat(raw.latitude);
  const lng = parseFloat(raw.longitude);

  // Skip invalid records
  if (!regNo || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;
  // Skip buses outside India bounding box
  if (lat < 8 || lat > 37 || lng < 68 || lng > 97) return null;

  const speed = parseFloat(raw.speed) || 0;
  const heading = parseFloat(raw.heading) || 0;

  let timestamp = new Date();
  if (raw.timestamp) {
    const parsed = new Date(raw.timestamp);
    if (!isNaN(parsed.getTime())) timestamp = parsed;
  }

  return {
    registrationNo: regNo,
    latitude: lat,
    longitude: lng,
    speed,
    heading,
    timestamp,
    status: speed > 0 ? 'moving' : 'halted',
    routeName: raw.routename || raw.route_description || undefined,
    nextStop: raw.next_stop || undefined,
    destination: raw.destination || undefined,
    depotName: raw.depot_name || raw.home_depot || undefined,
    zoneName: raw.zone_name || undefined,
  };
}

/**
 * Fetch all live bus locations from Margdarshi API.
 */
async function fetchMargdarshiLive(): Promise<CanonicalVehicleLocation[]> {
  try {
    const fetch = (await import('node-fetch')).default;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(MARGDARSHI_URL, {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0 UPBus-Tracker/1.0' },
      signal: controller.signal as any,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[Live Adapter] Margdarshi API HTTP ${response.status}`);
      return [];
    }

    const rawText = await response.text();
    const data = JSON.parse(rawText);

    if (!Array.isArray(data)) {
      console.warn('[Live Adapter] Expected array from API, got:', typeof data);
      return [];
    }

    const parsed: CanonicalVehicleLocation[] = [];
    for (const raw of data) {
      const bus = parseMargdarshiBus(raw);
      if (bus) parsed.push(bus);
    }

    return parsed;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.warn('[Live Adapter] Margdarshi API request timed out');
    } else {
      console.error('[Live Adapter] Fetch error:', err.message);
    }
    return [];
  }
}

/**
 * Ingest a single bus location into the system.
 * Auto-creates bus + trip records if they don't exist.
 */
export async function ingestLocation(location: CanonicalVehicleLocation): Promise<void> {
  try {
    // 1. Find or create bus record
    let busRes = await query('SELECT id FROM buses WHERE registration_no = $1', [location.registrationNo]);
    let busId: number;

    if (busRes.rows.length === 0) {
      const insertBus = await query(
        'INSERT INTO buses (registration_no, bus_type, depot_name) VALUES ($1, $2, $3) RETURNING id',
        [location.registrationNo, 'Ordinary', location.depotName || 'Unknown Depot']
      );
      busId = insertBus.rows[0].id;
    } else {
      busId = busRes.rows[0].id;
    }

    // 2. Find or create active running trip
    let tripRes = await query(
      "SELECT id, route_id, created_at FROM trips WHERE bus_id = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 1",
      [busId]
    );
    let tripId: number = 0;
    let createNewTrip = false;

    if (tripRes.rows.length === 0) {
      createNewTrip = true;
    } else {
      const trip = tripRes.rows[0];
      const tripAgeMs = Date.now() - new Date(trip.created_at).getTime();
      
      // If trip is older than 12 hours, forcefully complete it (stale trip)
      if (tripAgeMs > 12 * 60 * 60 * 1000) {
        await query("UPDATE trips SET status = 'completed' WHERE id = $1", [trip.id]);
        createNewTrip = true;
      } else {
        tripId = trip.id;
      }
    }

    if (createNewTrip) {
      let routeId = 1; // Default unknown route
      if (location.routeName) {
        const routeMatch = await query(
          'SELECT id FROM routes WHERE route_name ILIKE $1 LIMIT 1',
          [`%${location.routeName}%`]
        );
        if (routeMatch.rows.length > 0) routeId = routeMatch.rows[0].id;
      }

      const insertTrip = await query(
        "INSERT INTO trips (bus_id, route_id, scheduled_start, status) VALUES ($1, $2, NOW(), 'running') RETURNING id",
        [busId, routeId]
      );
      tripId = insertTrip.rows[0].id;
    }

    // 3. Update live location
    await query(
      `INSERT INTO bus_live_state (bus_id, trip_id, latitude, longitude, speed, heading, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bus_id) DO UPDATE SET
         trip_id = EXCLUDED.trip_id,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         speed = EXCLUDED.speed,
         heading = EXCLUDED.heading,
         last_seen_at = EXCLUDED.last_seen_at`,
      [busId, tripId, location.latitude, location.longitude, location.speed, location.heading, location.timestamp]
    );

    // 4. Update admin monitor — auto-registers new buses, updates existing
    adminMonitor.updateBus(busId, location.registrationNo, {
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed,
      heading: location.heading,
      routeName: location.routeName,
      currentStop: location.nextStop
        ? `Next: ${location.nextStop}`
        : location.destination || 'En-route',
      status: location.speed > 0 ? 'MOVING' : 'HALTED',
      zoneName: location.zoneName,
      originalRouteStr: location.routeName,
    });

    // 5. Route learning (non-blocking)
    recordLiveLocation(tripId, busId, location.latitude, location.longitude, location.speed).catch(() => {});

    // 6. Route progress (non-blocking, only for moving buses)
    if (location.speed > 0) {
      RouteProgressEngine.process({
        busId,
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed,
        heading: location.heading,
        accuracy: 10,
        timestamp: location.timestamp,
      }).catch(() => {});
    }

    // 7. Zero-Touch New Bus Onboarding — detect first-seen buses and auto-match their route
    // This is fully non-blocking; silently skips already-known buses in O(1).
    newBusDiscovery.checkAndTrack(
      location.registrationNo,
      busId,
      tripId,
      location.latitude,
      location.longitude
    ).catch(() => {});

  } catch (error: any) {
    // Silently skip individual bus errors so one failure doesn't block the batch
  }
}

/**
 * Main ingestion cycle — fetch all buses and process in parallel batches.
 */
async function runLiveIngestionCycle(): Promise<void> {
  const buses = await fetchMargdarshiLive();

  if (buses.length === 0) {
    console.warn('[Live Adapter] No buses received from Margdarshi API this cycle');
    return;
  }

  if (buses.length !== lastFetchCount) {
    console.log(`[Live Adapter] ✅ Fetched ${buses.length} real UPSRTC buses from Margdarshi API`);
    lastFetchCount = buses.length;
    adminMonitor.addLog({
      type: 'SYSTEM',
      message: `Live fetch: ${buses.length} real UPSRTC buses tracked from Margdarshi API`
    });
  }

  // Process in batches of 50 to avoid DB overload
  const BATCH_SIZE = 50;
  for (let i = 0; i < buses.length; i += BATCH_SIZE) {
    const batch = buses.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(bus => ingestLocation(bus)));
  }
}

export function startIngestion(): void {
  console.log('--- Starting GPS Ingestion In LIVE Mode (UPSRTC Margdarshi Real API) ---');
  console.log(`--- Real bus data fetched every ${FETCH_INTERVAL_MS / 1000} seconds ---`);

  runLiveIngestionCycle(); // First cycle immediately
  ingestionTimer = setInterval(runLiveIngestionCycle, FETCH_INTERVAL_MS);
}

export function stopIngestion(): void {
  if (ingestionTimer) {
    clearInterval(ingestionTimer);
    ingestionTimer = null;
    console.log('--- Live GPS Ingestion Stopped ---');
  }
}
