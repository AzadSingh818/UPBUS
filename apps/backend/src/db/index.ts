import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/upbus';

let pool: Pool | null = null;
try {
  pool = new Pool({ connectionString });
} catch (e) {
  console.warn('⚠️ [Warning] Could not initialize PostgreSQL pool:', e);
}
export let useMock = false;
export function setUseMock(value: boolean) {
  useMock = value;
}

// Seed data — UP 75-District Depot Corridor Network
export const mockDb: any = require('./data.json');

// --- Fast Index Maps for O(1) Mock DB Operations ---
const busByRegNoMap = new Map<string, any>();
const tripByBusIdMap = new Map<number, any>();
const liveStateByBusIdMap = new Map<number, any>();
const progressCacheByBusIdMap = new Map<number, any>();

export function rebuildMockDbIndexes() {
  busByRegNoMap.clear();
  tripByBusIdMap.clear();
  liveStateByBusIdMap.clear();
  progressCacheByBusIdMap.clear();

  if (mockDb.buses) {
    for (const b of mockDb.buses) {
      if (b.registration_no) {
        busByRegNoMap.set(b.registration_no.toUpperCase().trim(), b);
      }
    }
  }
  if (mockDb.trips) {
    for (const t of mockDb.trips) {
      if (t.status === 'running') {
        tripByBusIdMap.set(Number(t.bus_id), t);
      }
    }
  }
  if (mockDb.bus_live_state) {
    for (const l of mockDb.bus_live_state) {
      liveStateByBusIdMap.set(Number(l.bus_id), l);
    }
  }
  if (mockDb.bus_progress_cache) {
    for (const p of mockDb.bus_progress_cache) {
      progressCacheByBusIdMap.set(Number(p.bus_id), p);
    }
  }
}

// Initial index build
rebuildMockDbIndexes();

function persistMockDb() {
  try {
    const filePath = path.join(__dirname, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify(mockDb, null, 2));
    // Rebuild indexes after persistence changes
    rebuildMockDbIndexes();
  } catch (e) {
    console.error('[Mock DB] Error persisting data.json:', e);
  }
}

function executeMockQuery(text: string, params: any[] = []): { rows: any[]; rowCount: number } {
  const queryStr = text.replace(/\s+/g, ' ').trim();

  // Custom added queries for route learning & graph engine
  if (queryStr.toLowerCase().includes('from stops') && !queryStr.toLowerCase().includes('where') && !queryStr.toLowerCase().includes('join')) {
    return { rows: mockDb.stops, rowCount: mockDb.stops.length };
  }
  if (queryStr.toLowerCase().includes('from routes') && !queryStr.toLowerCase().includes('where') && !queryStr.toLowerCase().includes('join')) {
    return { rows: mockDb.routes, rowCount: mockDb.routes.length };
  }
  if (queryStr.toLowerCase().includes('from route_stops') && !queryStr.toLowerCase().includes('where') && !queryStr.toLowerCase().includes('join')) {
    return { rows: mockDb.route_stops, rowCount: mockDb.route_stops.length };
  }
  if (queryStr.startsWith('INSERT INTO routes')) {
    const routeCode = params[0];
    const routeName = params[1];
    const source = params[2];
    const destination = params[3];
    const distanceKm = parseFloat(params[4]) || 0.0;
    const newId = mockDb.routes.reduce((max: number, r: any) => r.id > max ? r.id : max, 0) + 1;
    const newRoute = { id: newId, route_code: routeCode, route_name: routeName, source, destination, distance_km: distanceKm };
    mockDb.routes.push(newRoute);
    persistMockDb();
    return { rows: [{ id: newId }], rowCount: 1 };
  }
  if (queryStr.startsWith('INSERT INTO route_stops')) {
    const routeId = parseInt(params[0], 10);
    const stopId = parseInt(params[1], 10);
    const sequenceNo = parseInt(params[2], 10);
    const distanceFromStartKm = parseFloat(params[3]) || 0.0;
    const newMapping = { route_id: routeId, stop_id: stopId, sequence_no: sequenceNo, distance_from_start_km: distanceFromStartKm };
    mockDb.route_stops.push(newMapping);
    persistMockDb();
    return { rows: [], rowCount: 1 };
  }
  if (queryStr.startsWith('UPDATE trips')) {
    if (queryStr.includes('route_id =')) {
      const routeId = parseInt(params[0], 10);
      const tripId = parseInt(params[1], 10);
      const trip = mockDb.trips.find((t: any) => t.id === tripId);
      if (trip) {
        trip.route_id = routeId;
        // Keep index updated
        tripByBusIdMap.set(Number(trip.bus_id), trip);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    const status = params[0];
    const tripId = parseInt(params[1], 10);
    const trip = mockDb.trips.find((t: any) => t.id === tripId);
    if (trip) {
      trip.status = status;
      if (status !== 'running') {
        tripByBusIdMap.delete(Number(trip.bus_id));
      } else {
        tripByBusIdMap.set(Number(trip.bus_id), trip);
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (queryStr.toLowerCase().includes('from trips') && queryStr.toLowerCase().includes('id = $1') && !queryStr.toLowerCase().includes('routes r') && !queryStr.toLowerCase().includes('buses b')) {
    const tripId = parseInt(params[0], 10);
    const trip = mockDb.trips.find((t: any) => t.id === tripId);
    return {
      rows: trip ? [trip] : [],
      rowCount: trip ? 1 : 0
    };
  }

  // 1. Search routes
  if (queryStr.toLowerCase().includes('from routes') && queryStr.includes('source') && queryStr.includes('destination')) {
    if (params.length === 0 || params[0] === undefined || params[1] === undefined) {
      return { rows: mockDb.routes, rowCount: mockDb.routes.length };
    }
    const fromVal = params[0].replace(/%/g, '').toLowerCase();
    const toVal = params[1].replace(/%/g, '').toLowerCase();

    const filtered = mockDb.routes.filter(r => {
      // Direct matching
      const directMatch = r.source.toLowerCase().includes(fromVal) && r.destination.toLowerCase().includes(toVal);
      if (directMatch) return true;

      // Find route stops matching 'fromVal' and 'toVal'
      const routeStops = mockDb.route_stops.filter(rs => rs.route_id === r.id);
      
      const fromStops = routeStops.filter(rs => {
        const stop = mockDb.stops.find(s => s.id === rs.stop_id);
        return stop && (stop.name.toLowerCase().includes(fromVal) || r.source.toLowerCase().includes(fromVal));
      });

      const toStops = routeStops.filter(rs => {
        const stop = mockDb.stops.find(s => s.id === rs.stop_id);
        return stop && (stop.name.toLowerCase().includes(toVal) || r.destination.toLowerCase().includes(toVal));
      });

      // Find if there is a 'from' stop with a sequence number less than a 'to' stop
      for (const fs of fromStops) {
        for (const ts of toStops) {
          if (fs.sequence_no < ts.sequence_no) {
            return true;
          }
        }
      }
      return false;
    });
    return { rows: filtered, rowCount: filtered.length };
  }

  // 2. Fetch active trips on route
  if (queryStr.includes('FROM trips t') && queryStr.includes('route_id = $1') && queryStr.includes("status = 'running'")) {
    const routeId = params[0];
    const filteredTrips = mockDb.trips.filter(t => t.route_id === routeId && t.status === 'running');
    const joined = filteredTrips.map(t => {
      const bus = mockDb.buses.find(b => b.id === t.bus_id) || { registration_no: 'Unknown', bus_type: 'Ordinary', depot_name: 'Unknown' };
      const live = mockDb.bus_live_state.find(l => l.trip_id === t.id);
      return {
        trip_id: t.id,
        status: t.status,
        registration_no: bus.registration_no,
        bus_type: bus.bus_type,
        depot_name: bus.depot_name,
        bus_latitude: live ? live.latitude : null,
        bus_longitude: live ? live.longitude : null,
        current_speed_kmph: live ? live.speed : 0,
        heading: live ? live.heading : 0
      };
    });
    return { rows: joined, rowCount: joined.length };
  }

  // 3. Fetch stops on a route (via routeId)
  if (queryStr.includes('FROM route_stops rs') && queryStr.includes('rs.route_id = $1') && !queryStr.includes('trips t')) {
    const routeId = parseInt(params[0], 10);
    const rsMapping = mockDb.route_stops.filter(rs => rs.route_id === routeId);
    const joined = rsMapping.map(rs => {
      const stop = mockDb.stops.find(s => s.id === rs.stop_id)!;
      const sequence = rs.sequence !== undefined ? rs.sequence : rs.sequence_no;
      const distFromStart = rs.distance_from_start !== undefined ? rs.distance_from_start : Math.round(rs.distance_from_start_km * 1000);
      return {
        sequence_no: rs.sequence_no,
        distance_from_start_km: rs.distance_from_start_km,
        stop_id: stop.id,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        
        // Mappings for the new Route Progress Engine
        id: stop.id,
        stop_name: stop.stop_name || stop.name,
        sequence: sequence,
        distance_from_start: distFromStart
      };
    });
    return { rows: joined, rowCount: joined.length };
  }

  // 4. Fetch stops on a trip (via tripId)
  if (queryStr.includes('FROM route_stops rs') && queryStr.includes('t.id = $1')) {
    const tripId = params[0];
    const trip = mockDb.trips.find(t => t.id === tripId);
    if (!trip) return { rows: [], rowCount: 0 };

    const rsMapping = mockDb.route_stops.filter(rs => rs.route_id === trip.route_id);
    const joined = rsMapping.map(rs => {
      const stop = mockDb.stops.find(s => s.id === rs.stop_id)!;
      return {
        sequence_no: rs.sequence_no,
        distance_from_start_km: rs.distance_from_start_km,
        stop_id: stop.id,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude
      };
    });
    return { rows: joined, rowCount: joined.length };
  }

  // 5. Fetch trip and bus details (getTripETAs #1)
  if (queryStr.includes('FROM trips t') && queryStr.includes('t.id = $1') && queryStr.includes('routes r')) {
    const tripId = params[0];
    const trip = mockDb.trips.find(t => t.id === tripId);
    if (!trip) return { rows: [], rowCount: 0 };

    const route = mockDb.routes.find(r => r.id === trip.route_id)!;
    const bus = mockDb.buses.find(b => b.id === trip.bus_id)!;

    return {
      rows: [{
        trip_id: trip.id,
        trip_status: trip.status,
        route_code: route.route_code,
        route_name: route.route_name,
        registration_no: bus.registration_no,
        bus_type: bus.bus_type
      }],
      rowCount: 1
    };
  }

  // 6. Fetch live location (getTripETAs #2)
  if (queryStr.includes('FROM bus_live_state') && queryStr.includes('trip_id = $1')) {
    const tripId = params[0];
    const live = mockDb.bus_live_state.find(l => l.trip_id === tripId);
    if (!live) return { rows: [], rowCount: 0 };

    return {
      rows: [{
        latitude: live.latitude,
        longitude: live.longitude,
        speed: live.speed,
        heading: live.heading,
        last_seen_at: live.last_seen_at
      }],
      rowCount: 1
    };
  }

  // 7. Find bus by registration
  if (queryStr.includes('SELECT id FROM buses WHERE registration_no = $1')) {
    const regNo = params[0];
    const key = String(regNo).toUpperCase().trim();
    const bus = busByRegNoMap.get(key);
    return {
      rows: bus ? [{ id: bus.id }] : [],
      rowCount: bus ? 1 : 0
    };
  }

  // 8. Find route by code
  if (queryStr.includes('SELECT id FROM routes WHERE route_code = $1')) {
    const routeCode = params[0];
    const route = mockDb.routes.find(r => r.route_code === routeCode);
    return {
      rows: route ? [{ id: route.id }] : [],
      rowCount: route ? 1 : 0
    };
  }

  if (queryStr.includes('SELECT id, route_code, route_name FROM routes')) {
    if (queryStr.includes('route_code = $1')) {
      const code = params[0];
      const route = mockDb.routes.find((r: any) => r.route_code === code);
      return route ? { rows: [{ id: route.id, route_code: route.route_code, route_name: route.route_name }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return {
      rows: mockDb.routes.map(r => ({ id: r.id, route_code: r.route_code, route_name: r.route_name })),
      rowCount: mockDb.routes.length
    };
  }

  // 9. Find active trip (ingestLocation #2)
  if (queryStr.includes('SELECT id FROM trips WHERE bus_id = $1') && queryStr.includes("status = 'running'")) {
    const busId = Number(params[0]);
    const trip = tripByBusIdMap.get(busId);
    return {
      rows: trip ? [{ id: trip.id }] : [],
      rowCount: trip ? 1 : 0
    };
  }

  // 10. Find active trip by bus and route
  if (queryStr.includes('SELECT id FROM trips WHERE bus_id = $1 AND route_id = $2')) {
    const busId = params[0];
    const routeId = params[1];
    const trip = mockDb.trips.find((t: any) => t.bus_id === busId && t.route_id === routeId && t.status === 'running');
    return {
      rows: trip ? [{ id: trip.id }] : [],
      rowCount: trip ? 1 : 0
    };
  }

  // 10b. Find active trip for bus (with joined details)
  if (queryStr.includes('FROM trips t') && queryStr.includes('t.bus_id = $1') && queryStr.includes("t.status = 'running'")) {
    const busId = parseInt(params[0], 10);
    const trip = mockDb.trips.find((t: any) => t.bus_id === busId && t.status === 'running');
    if (trip) {
      const bus = mockDb.buses.find((b: any) => b.id === busId);
      const route = mockDb.routes.find((r: any) => r.id === trip.route_id);
      return {
        rows: [{
          id: trip.id,
          bus_id: trip.bus_id,
          route_id: trip.route_id,
          status: trip.status,
          registration_no: bus?.registration_no || bus?.registration_number || '',
          route_name: route?.route_name || ''
        }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 0 };
  }

  // 10c. Get live bus location heading
  if (queryStr.includes('FROM live_bus_location') && queryStr.includes('bus_id = $1')) {
    mockDb.live_bus_location = mockDb.live_bus_location || [];
    const busId = parseInt(params[0], 10);
    const loc = mockDb.live_bus_location.find((l: any) => l.bus_id === busId);
    return { rows: loc ? [{ heading: loc.heading }] : [], rowCount: loc ? 1 : 0 };
  }

  // 10d. Passenger Reports queries
  if (queryStr.includes('INSERT INTO passenger_reports')) {
    mockDb.passenger_reports = mockDb.passenger_reports || [];
    const tripId = params[0];
    const busRegNo = params[1];
    const reportType = params[2];
    const description = params[3];
    const latitude = params[4];
    const longitude = params[5];
    const newId = mockDb.passenger_reports.length + 1;
    const newReport = {
      id: newId,
      trip_id: tripId,
      bus_reg_no: busRegNo,
      report_type: reportType,
      description,
      latitude,
      longitude,
      created_at: new Date()
    };
    mockDb.passenger_reports.push(newReport);
    return { rows: [newReport], rowCount: 1 };
  }

  if (queryStr.includes('FROM passenger_reports') && queryStr.includes('created_at >= $1')) {
    mockDb.passenger_reports = mockDb.passenger_reports || [];
    const cutoffVal = (params && params.length > 0) ? params[0] : new Date(Date.now() - 2 * 60 * 60 * 1000);
    const cutoff = new Date(cutoffVal);
    const activeReports = mockDb.passenger_reports.filter((r: any) => new Date(r.created_at) >= cutoff);
    return { rows: activeReports, rowCount: activeReports.length };
  }

  // 10e. Push Subscriptions queries
  if (queryStr.includes('INSERT INTO push_subscriptions')) {
    mockDb.push_subscriptions = mockDb.push_subscriptions || [];
    const endpoint = params[0];
    const p256dh = params[1];
    const auth = params[2];
    const newSub = { id: mockDb.push_subscriptions.length + 1, endpoint, p256dh, auth, created_at: new Date() };
    mockDb.push_subscriptions.push(newSub);
    return { rows: [newSub], rowCount: 1 };
  }

  if (queryStr.includes('FROM push_subscriptions')) {
    mockDb.push_subscriptions = mockDb.push_subscriptions || [];
    if (queryStr.includes('DELETE FROM')) {
      const endpoint = params[0];
      const lenBefore = mockDb.push_subscriptions.length;
      mockDb.push_subscriptions = mockDb.push_subscriptions.filter((s: any) => s.endpoint !== endpoint);
      const rowCount = lenBefore - mockDb.push_subscriptions.length;
      return { rows: [], rowCount };
    } else {
      return { rows: mockDb.push_subscriptions, rowCount: mockDb.push_subscriptions.length };
    }
  }

  // 10f. Stops table queries
  if (queryStr.includes('INSERT INTO stops')) {
    mockDb.stops = mockDb.stops || [];
    const stopCode = params[0];
    const name = params[1];
    const latitude = parseFloat(params[2]);
    const longitude = parseFloat(params[3]);
    const existing = mockDb.stops.find((s: any) => s.stop_code === stopCode);
    if (existing) {
      return { rows: [{ id: existing.id }], rowCount: 1 };
    }
    const newId = mockDb.stops.reduce((max: number, s: any) => s.id > max ? s.id : max, 0) + 1;
    const newStop = { id: newId, stop_code: stopCode, name, latitude, longitude };
    mockDb.stops.push(newStop);
    persistMockDb();
    return { rows: [{ id: newId }], rowCount: 1 };
  }

  if (queryStr.includes('FROM stops') && queryStr.includes('WHERE')) {
    mockDb.stops = mockDb.stops || [];
    if (queryStr.includes('UPPER(name) =')) {
      const targetName = params[0].toUpperCase();
      const matched = mockDb.stops.filter((s: any) => s.name.toUpperCase() === targetName);
      return { rows: matched, rowCount: matched.length };
    }
    if (queryStr.includes('stop_code =')) {
      const code = params[0];
      const matched = mockDb.stops.filter((s: any) => s.stop_code === code);
      return { rows: matched, rowCount: matched.length };
    }
  }

  // 11. INSERT bus
  if (queryStr.includes('INSERT INTO buses')) {
    const regNo = params[0];
    const busType = params[1] || 'Ordinary';
    const depot = params[2] || 'Unknown Depot';
    const newId = mockDb.buses.length + 1;
    const newBus = { id: newId, registration_no: regNo, bus_type: busType, depot_name: depot };
    mockDb.buses.push(newBus);
    busByRegNoMap.set(String(regNo).toUpperCase().trim(), newBus);
    return { rows: [{ id: newId }], rowCount: 1 };
  }

  // 12. INSERT trip
  if (queryStr.includes('INSERT INTO trips')) {
    const busId = Number(params[0]);
    const routeId = Number(params[1]);
    const newId = mockDb.trips.length + 1;
    const newTrip = { id: newId, bus_id: busId, route_id: routeId, status: 'running', scheduled_start: new Date(), created_at: new Date() };
    mockDb.trips.push(newTrip);
    tripByBusIdMap.set(busId, newTrip);
    return { rows: [{ id: newId }], rowCount: 1 };
  }

  // 13. UPSERT bus_live_state
  if (queryStr.includes('INSERT INTO bus_live_state')) {
    const busId = Number(params[0]);
    const tripId = Number(params[1]);
    const lat = parseFloat(params[2]);
    const lng = parseFloat(params[3]);
    const speed = parseFloat(params[4]);
    const heading = parseFloat(params[5]);
    const timestamp = params[6];

    let live = liveStateByBusIdMap.get(busId);
    if (live) {
      live.trip_id = tripId;
      live.latitude = lat;
      live.longitude = lng;
      live.speed = speed;
      live.heading = heading;
      live.last_seen_at = timestamp;
    } else {
      live = {
        bus_id: busId,
        trip_id: tripId,
        latitude: lat,
        longitude: lng,
        speed,
        heading,
        last_seen_at: timestamp
      };
      mockDb.bus_live_state.push(live);
      liveStateByBusIdMap.set(busId, live);
    }
    return { rows: [], rowCount: 1 };
  }

  // 6. Find route by route_code
  if (queryStr.toLowerCase().includes('from routes') && queryStr.toLowerCase().includes('route_code')) {
    const code = params[0];
    const route = mockDb.routes.find((r: any) => r.route_code === code);
    return route ? { rows: [route], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // 7. Get stops by route_id
  if (queryStr.toLowerCase().includes('from route_stops') && queryStr.toLowerCase().includes('route_id = $1')) {
    const routeId = params[0];
    const stopsForRoute = mockDb.route_stops.filter((rs: any) => rs.route_id === routeId);
    
    const joinedStops = stopsForRoute.map((rs: any) => {
      const stop = mockDb.stops.find((s: any) => s.id === rs.stop_id);
      const sequence = rs.sequence !== undefined ? rs.sequence : rs.sequence_no;
      const distFromStart = rs.distance_from_start !== undefined ? rs.distance_from_start : Math.round(rs.distance_from_start_km * 1000);
      return {
        sequence_no: rs.sequence_no,
        distance_from_start_km: rs.distance_from_start_km,
        stop_id: stop?.id,
        name: stop?.name,
        latitude: stop?.latitude,
        longitude: stop?.longitude,
        
        // Mappings for the new Route Progress Engine
        id: stop?.id,
        stop_name: stop?.stop_name || stop?.name,
        sequence: sequence,
        distance_from_start: distFromStart
      };
    }).sort((a: any, b: any) => (a.sequence !== undefined ? a.sequence : a.sequence_no) - (b.sequence !== undefined ? b.sequence : b.sequence_no));

    return { rows: joinedStops, rowCount: joinedStops.length };
  }

  // 8. bus_progress_cache queries
  if (queryStr.includes('FROM bus_progress_cache') && queryStr.includes('bus_id = $1')) {
    mockDb.bus_progress_cache = mockDb.bus_progress_cache || [];
    const busId = parseInt(params[0], 10);
    const cached = mockDb.bus_progress_cache.find((c: any) => c.bus_id === busId);
    return { rows: cached ? [cached] : [], rowCount: cached ? 1 : 0 };
  }
  if (queryStr.includes('INSERT INTO bus_progress_cache')) {
    mockDb.bus_progress_cache = mockDb.bus_progress_cache || [];
    const busId = parseInt(params[0], 10);
    const coveredDistance = parseInt(params[1], 10);
    const currentSegmentFrom = params[2];
    const currentSegmentTo = params[3];
    const currentStop = params[4];
    const state = params[5];
    const completedStopIndex = parseInt(params[6], 10);

    const idx = mockDb.bus_progress_cache.findIndex((c: any) => c.bus_id === busId);
    const entry = {
      bus_id: busId,
      covered_distance: coveredDistance,
      current_segment_from: currentSegmentFrom,
      current_segment_to: currentSegmentTo,
      current_stop: currentStop,
      state: state,
      completed_stop_index: completedStopIndex,
      updated_at: new Date()
    };
    if (idx !== -1) {
      mockDb.bus_progress_cache[idx] = entry;
    } else {
      mockDb.bus_progress_cache.push(entry);
    }
    return { rows: [], rowCount: 1 };
  }

  // 9. stop_visit_log queries
  if (queryStr.includes('FROM stop_visit_log') && queryStr.includes('bus_id = $1')) {
    mockDb.stop_visit_log = mockDb.stop_visit_log || [];
    const busId = parseInt(params[0], 10);
    const logs = mockDb.stop_visit_log.filter((l: any) => l.bus_id === busId);
    return { rows: logs, rowCount: logs.length };
  }
  if (queryStr.includes('INSERT INTO stop_visit_log')) {
    mockDb.stop_visit_log = mockDb.stop_visit_log || [];
    const stopId = parseInt(params[0], 10);
    const busId = parseInt(params[1], 10);
    const arrivedAt = params[2];
    const entry = {
      stop_id: stopId,
      bus_id: busId,
      arrived_at: arrivedAt,
      departed_at: null,
      visited: false
    };
    mockDb.stop_visit_log.push(entry);
    return { rows: [], rowCount: 1 };
  }
  if (queryStr.includes('UPDATE stop_visit_log')) {
    mockDb.stop_visit_log = mockDb.stop_visit_log || [];
    const departedAt = params[0];
    const stopId = parseInt(params[1], 10);
    const busId = parseInt(params[2], 10);
    const entry = mockDb.stop_visit_log.find((l: any) => l.stop_id === stopId && l.bus_id === busId && l.visited === false);
    if (entry) {
      entry.departed_at = departedAt;
      entry.visited = true;
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (queryStr.includes('DELETE FROM stop_visit_log')) {
    mockDb.stop_visit_log = mockDb.stop_visit_log || [];
    const stopId = parseInt(params[0], 10);
    const busId = parseInt(params[1], 10);
    const lengthBefore = mockDb.stop_visit_log.length;
    mockDb.stop_visit_log = mockDb.stop_visit_log.filter((l: any) => !(l.stop_id === stopId && l.bus_id === busId));
    return { rows: [], rowCount: lengthBefore - mockDb.stop_visit_log.length };
  }

  // 10. live_bus_location queries
  if (queryStr.includes('INSERT INTO live_bus_location')) {
    mockDb.live_bus_location = mockDb.live_bus_location || [];
    const busId = parseInt(params[0], 10);
    const latitude = parseFloat(params[1]);
    const longitude = parseFloat(params[2]);
    const heading = parseFloat(params[3]);
    const speed = parseFloat(params[4]);
    const accuracy = parseFloat(params[5]);

    const idx = mockDb.live_bus_location.findIndex((l: any) => l.bus_id === busId);
    const entry = {
      bus_id: busId,
      latitude,
      longitude,
      heading,
      speed,
      accuracy,
      updated_at: new Date()
    };
    if (idx !== -1) {
      mockDb.live_bus_location[idx] = entry;
    } else {
      mockDb.live_bus_location.push(entry);
    }
    return { rows: [], rowCount: 1 };
  }

  // 11. route_versions queries
  if (queryStr.includes('FROM route_versions') && queryStr.includes('route_id = $1')) {
    mockDb.route_versions = mockDb.route_versions || [];
    const routeId = parseInt(params[0], 10);
    const v = mockDb.route_versions.find((rv: any) => rv.route_id === routeId && rv.is_active === true);
    return { rows: v ? [v] : [], rowCount: v ? 1 : 0 };
  }

  // 12b. Route name matching via ILIKE query
  if (queryStr.includes('FROM routes WHERE route_name ILIKE $1')) {
    const rawVal = params[0] || '';
    const cleanVal = rawVal.replace(/%/g, '').toLowerCase().trim();
    const route = mockDb.routes.find((r: any) => r.route_name.toLowerCase().includes(cleanVal));
    return {
      rows: route ? [{ id: route.id }] : [],
      rowCount: route ? 1 : 0
    };
  }

  // Default fallback
  console.log(`Mock DB received unhandled query: ${queryStr}`);
  return { rows: [], rowCount: 0 };
}

export const query = async (text: string, params?: any[]) => {
  if (useMock || !pool) {
    return executeMockQuery(text, params);
  }

  try {
    return await pool.query(text, params);
  } catch (error) {
    console.warn('⚠️ [Warning] PostgreSQL query error, falling back to mock DB:', (error as Error).message);
    useMock = true; // Switch to mock on error
    return executeMockQuery(text, params);
  }
};
