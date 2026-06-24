import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/upbus';

let pool: Pool | null = null;
try {
  pool = new Pool({ connectionString });
} catch (e) {
  console.warn('⚠️ [Warning] Could not initialize PostgreSQL pool:', e);
}
let useMock = false;

// Seed data — UP 75-District Depot Corridor Network
const mockDb: any = require('./data.json');

function executeMockQuery(text: string, params: any[] = []): { rows: any[]; rowCount: number } {
  const queryStr = text.replace(/\s+/g, ' ').trim();

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
    const bus = mockDb.buses.find(b => b.registration_no === regNo);
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
    const busId = params[0];
    const trip = mockDb.trips.find((t: any) => t.bus_id === busId && t.status === 'running');
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

  // 11. INSERT bus
  if (queryStr.includes('INSERT INTO buses')) {
    const regNo = params[0];
    const busType = params[1] || 'Ordinary';
    const depot = params[2] || 'Unknown Depot';
    const newId = mockDb.buses.length + 1;
    const newBus = { id: newId, registration_no: regNo, bus_type: busType, depot_name: depot };
    mockDb.buses.push(newBus);
    return { rows: [{ id: newId }], rowCount: 1 };
  }

  // 12. INSERT trip
  if (queryStr.includes('INSERT INTO trips')) {
    const busId = params[0];
    const routeId = params[1];
    const newId = mockDb.trips.length + 1;
    const newTrip = { id: newId, bus_id: busId, route_id: routeId, status: 'running', scheduled_start: new Date(), created_at: new Date() };
    mockDb.trips.push(newTrip);
    return { rows: [{ id: newId }], rowCount: 1 };
  }

  // 13. UPSERT bus_live_state
  if (queryStr.includes('INSERT INTO bus_live_state')) {
    const busId = params[0];
    const tripId = params[1];
    const lat = params[2];
    const lng = params[3];
    const speed = params[4];
    const heading = params[5];
    const timestamp = params[6];

    const idx = mockDb.bus_live_state.findIndex((l: any) => l.bus_id === busId);
    if (idx !== -1) {
      mockDb.bus_live_state[idx] = {
        bus_id: busId,
        trip_id: tripId,
        latitude: lat,
        longitude: lng,
        speed,
        heading,
        last_seen_at: timestamp
      };
    } else {
      mockDb.bus_live_state.push({
        bus_id: busId,
        trip_id: tripId,
        latitude: lat,
        longitude: lng,
        speed,
        heading,
        last_seen_at: timestamp
      });
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
      return {
        sequence_no: rs.sequence_no,
        distance_from_start_km: rs.distance_from_start_km,
        stop_id: stop?.id,
        name: stop?.name,
        latitude: stop?.latitude,
        longitude: stop?.longitude
      };
    }).sort((a: any, b: any) => a.sequence_no - b.sequence_no);

    return { rows: joinedStops, rowCount: joinedStops.length };
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
