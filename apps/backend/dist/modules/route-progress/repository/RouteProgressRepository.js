"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteProgressRepository = void 0;
const db_1 = require("../../../db");
// In-memory cache for route stops to comply with Performance Rules (load assigned route once)
const routeStopsCache = new Map();
class RouteProgressRepository {
    static async getTrip(tripId) {
        const res = await (0, db_1.query)(`SELECT t.id, t.bus_id, t.route_id, t.status, b.registration_no, r.route_name
       FROM trips t
       JOIN buses b ON t.bus_id = b.id
       JOIN routes r ON t.route_id = r.id
       WHERE t.id = $1`, [tripId]);
        if (res.rows.length === 0)
            return null;
        return res.rows[0];
    }
    static async getTripForBus(busId) {
        const res = await (0, db_1.query)(`SELECT t.id, t.bus_id, t.route_id, t.status, b.registration_no, r.route_name
       FROM trips t
       JOIN buses b ON t.bus_id = b.id
       JOIN routes r ON t.route_id = r.id
       WHERE t.bus_id = $1 AND t.status = 'running'
       ORDER BY t.created_at DESC LIMIT 1`, [busId]);
        if (res.rows.length === 0)
            return null;
        return res.rows[0];
    }
    static async getRouteStops(routeId) {
        // Check in-memory cache first
        if (routeStopsCache.has(routeId)) {
            return routeStopsCache.get(routeId);
        }
        const res = await (0, db_1.query)(`SELECT s.id, COALESCE(s.stop_name, s.name) as stop_name, s.latitude, s.longitude,
              COALESCE(rs.sequence, rs.sequence_no) as sequence,
              COALESCE(rs.distance_from_start, CAST(rs.distance_from_start_km * 1000 AS INTEGER)) as distance_from_start
       FROM route_stops rs
       JOIN stops s ON rs.stop_id = s.id
       WHERE rs.route_id = $1
       ORDER BY COALESCE(rs.sequence, rs.sequence_no) ASC`, [routeId]);
        const stops = res.rows.map(r => ({
            id: r.id,
            stop_name: r.stop_name,
            latitude: parseFloat(r.latitude),
            longitude: parseFloat(r.longitude),
            sequence: parseInt(r.sequence, 10),
            distance_from_start: parseInt(r.distance_from_start, 10)
        }));
        routeStopsCache.set(routeId, stops);
        return stops;
    }
    static async getLastProgress(busId) {
        const res = await (0, db_1.query)(`SELECT bus_id, covered_distance, current_segment_from, current_segment_to, current_stop, state, completed_stop_index, updated_at
       FROM bus_progress_cache
       WHERE bus_id = $1`, [busId]);
        if (res.rows.length === 0)
            return null;
        const r = res.rows[0];
        // Fetch latest live location to get heading
        const liveLocRes = await (0, db_1.query)(`SELECT heading FROM live_bus_location WHERE bus_id = $1`, [busId]);
        const heading = liveLocRes.rows.length > 0 ? parseFloat(liveLocRes.rows[0].heading) : 0;
        return {
            bus_id: parseInt(r.bus_id, 10),
            covered_distance: parseInt(r.covered_distance, 10),
            current_segment_from: r.current_segment_from,
            current_segment_to: r.current_segment_to,
            current_stop: r.current_stop,
            state: r.state,
            completed_stop_index: parseInt(r.completed_stop_index, 10),
            updated_at: new Date(r.updated_at),
            heading
        };
    }
    static async getStopVisitLogs(busId) {
        const res = await (0, db_1.query)(`SELECT stop_id, bus_id, arrived_at, departed_at, visited
       FROM stop_visit_log
       WHERE bus_id = $1`, [busId]);
        return res.rows.map(r => ({
            stop_id: parseInt(r.stop_id, 10),
            bus_id: parseInt(r.bus_id, 10),
            arrived_at: new Date(r.arrived_at),
            departed_at: r.departed_at ? new Date(r.departed_at) : null,
            visited: r.visited === true || r.visited === 'true'
        }));
    }
    static async logStopArrival(stopId, busId, arrivedAt) {
        await (0, db_1.query)(`INSERT INTO stop_visit_log (stop_id, bus_id, arrived_at, visited)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (stop_id, bus_id, arrived_at) DO NOTHING`, [stopId, busId, arrivedAt]);
    }
    static async logStopDeparture(stopId, busId, departedAt) {
        await (0, db_1.query)(`UPDATE stop_visit_log
       SET departed_at = $1, visited = TRUE
       WHERE stop_id = $2 AND bus_id = $3 AND visited = FALSE`, [departedAt, stopId, busId]);
    }
    static async rollbackStopVisit(stopId, busId) {
        await (0, db_1.query)(`DELETE FROM stop_visit_log
       WHERE stop_id = $1 AND bus_id = $2`, [stopId, busId]);
    }
    static async updateProgressCache(data) {
        await (0, db_1.query)(`INSERT INTO bus_progress_cache (bus_id, covered_distance, current_segment_from, current_segment_to, current_stop, state, completed_stop_index, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (bus_id)
       DO UPDATE SET
          covered_distance = EXCLUDED.covered_distance,
          current_segment_from = EXCLUDED.current_segment_from,
          current_segment_to = EXCLUDED.current_segment_to,
          current_stop = EXCLUDED.current_stop,
          state = EXCLUDED.state,
          completed_stop_index = EXCLUDED.completed_stop_index,
          updated_at = NOW()`, [
            data.bus_id,
            data.covered_distance,
            data.current_segment_from,
            data.current_segment_to,
            data.current_stop,
            data.state,
            data.completed_stop_index
        ]);
    }
    static async upsertLiveLocation(busId, latitude, longitude, heading, speed, accuracy) {
        await (0, db_1.query)(`INSERT INTO live_bus_location (bus_id, latitude, longitude, heading, speed, accuracy, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (bus_id)
       DO UPDATE SET
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          heading = EXCLUDED.heading,
          speed = EXCLUDED.speed,
          accuracy = EXCLUDED.accuracy,
          updated_at = NOW()`, [busId, latitude, longitude, heading, speed, accuracy]);
    }
    static clearCache() {
        routeStopsCache.clear();
    }
}
exports.RouteProgressRepository = RouteProgressRepository;
