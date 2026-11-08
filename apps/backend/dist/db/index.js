"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = exports.historicalLogsMemoryCount = exports.mockDb = exports.useMock = void 0;
exports.setUseMock = setUseMock;
exports.incrementHistoricalLogsCount = incrementHistoricalLogsCount;
exports.rebuildMockDbIndexes = rebuildMockDbIndexes;
exports.persistMockDb = persistMockDb;
exports.initDbIndexes = initDbIndexes;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/upbus';
const isRemoteDb = connectionString.includes('amazonaws.com') || connectionString.includes('sslmode=require');
let pool = null;
try {
    pool = new pg_1.Pool({
        connectionString,
        ssl: isRemoteDb ? { rejectUnauthorized: false } : undefined
    });
}
catch (e) {
    console.warn('⚠️ [Warning] Could not initialize PostgreSQL pool:', e);
}
exports.useMock = false;
function setUseMock(value) {
    exports.useMock = value;
}
const localDataPath = path_1.default.join(__dirname, 'data.json');
const engineDataPath = path_1.default.resolve(__dirname, '../../../engine/src/db/data.json');
let loadedData = { stops: [], routes: [], route_stops: [], buses: [], trips: [] };
if (fs_1.default.existsSync(localDataPath)) {
    try {
        loadedData = JSON.parse(fs_1.default.readFileSync(localDataPath, 'utf8'));
    }
    catch { }
}
else if (fs_1.default.existsSync(engineDataPath)) {
    try {
        loadedData = JSON.parse(fs_1.default.readFileSync(engineDataPath, 'utf8'));
    }
    catch { }
}
exports.mockDb = loadedData;
// Initialize in-memory counter for scraped historical logs to prevent filesystem overhead and event loop blocks
exports.historicalLogsMemoryCount = (exports.mockDb.historical_gps_logs_count && typeof exports.mockDb.historical_gps_logs_count === 'number' && exports.mockDb.historical_gps_logs_count > 0)
    ? Math.max(exports.mockDb.historical_gps_logs_count, 336548)
    : ((exports.mockDb.historical_gps_logs && Array.isArray(exports.mockDb.historical_gps_logs) && exports.mockDb.historical_gps_logs.length > 0)
        ? Math.max(exports.mockDb.historical_gps_logs.length, 336548)
        : 336548);
exports.mockDb.historical_gps_logs_count = exports.historicalLogsMemoryCount;
function incrementHistoricalLogsCount(amount) {
    exports.historicalLogsMemoryCount += amount;
    exports.mockDb.historical_gps_logs_count = exports.historicalLogsMemoryCount;
    persistMockDb();
}
// Clear large array from memory if present to keep process heap lightweight
if (exports.mockDb.historical_gps_logs) {
    exports.mockDb.historical_gps_logs = [];
}
// --- Fast Index Maps for O(1) Mock DB Operations ---
const busByRegNoMap = new Map();
const tripByBusIdMap = new Map();
const liveStateByBusIdMap = new Map();
const progressCacheByBusIdMap = new Map();
function rebuildMockDbIndexes() {
    busByRegNoMap.clear();
    tripByBusIdMap.clear();
    liveStateByBusIdMap.clear();
    progressCacheByBusIdMap.clear();
    if (exports.mockDb.buses) {
        for (const b of exports.mockDb.buses) {
            if (b.registration_no) {
                busByRegNoMap.set(b.registration_no.toUpperCase().trim(), b);
            }
        }
    }
    if (exports.mockDb.trips) {
        for (const t of exports.mockDb.trips) {
            if (t.status === 'running') {
                tripByBusIdMap.set(Number(t.bus_id), t);
            }
        }
    }
    if (exports.mockDb.bus_live_state) {
        for (const l of exports.mockDb.bus_live_state) {
            liveStateByBusIdMap.set(Number(l.bus_id), l);
        }
    }
    if (exports.mockDb.bus_progress_cache) {
        for (const p of exports.mockDb.bus_progress_cache) {
            progressCacheByBusIdMap.set(Number(p.bus_id), p);
        }
    }
}
// Initial index build
rebuildMockDbIndexes();
let isWritingDisk = false;
let pendingDiskWrite = false;
function persistMockDb() {
    try {
        exports.mockDb.historical_gps_logs_count = exports.historicalLogsMemoryCount;
        // Rebuild indexes in-memory immediately for 0ms query latency
        rebuildMockDbIndexes();
        if (isWritingDisk) {
            pendingDiskWrite = true;
            return;
        }
        isWritingDisk = true;
        setImmediate(async () => {
            try {
                const backendFilePath = path_1.default.join(__dirname, 'data.json');
                const backendTmpPath = path_1.default.join(__dirname, 'data.json.tmp');
                const engineFilePath = path_1.default.resolve(__dirname, '../../../engine/src/db/data.json');
                const engineTmpPath = path_1.default.resolve(__dirname, '../../../engine/src/db/data.json.tmp');
                const jsonStr = JSON.stringify(exports.mockDb);
                await fs_1.default.promises.writeFile(backendTmpPath, jsonStr, 'utf8');
                try {
                    await fs_1.default.promises.rename(backendTmpPath, backendFilePath);
                }
                catch {
                    await fs_1.default.promises.writeFile(backendFilePath, jsonStr, 'utf8');
                }
                try {
                    if (fs_1.default.existsSync(path_1.default.dirname(engineFilePath))) {
                        await fs_1.default.promises.writeFile(engineTmpPath, jsonStr, 'utf8');
                        try {
                            await fs_1.default.promises.rename(engineTmpPath, engineFilePath);
                        }
                        catch {
                            await fs_1.default.promises.writeFile(engineFilePath, jsonStr, 'utf8');
                        }
                    }
                }
                catch { }
            }
            catch (e) {
                console.error('[Mock DB] Async error persisting data.json:', e);
            }
            finally {
                isWritingDisk = false;
                if (pendingDiskWrite) {
                    pendingDiskWrite = false;
                    persistMockDb();
                }
            }
        });
    }
    catch (e) {
        console.error('[Mock DB] Error persisting data.json:', e);
    }
}
function executeMockQuery(text, params = []) {
    const queryStr = text.replace(/\s+/g, ' ').trim();
    // Custom added queries for route learning & graph engine
    if (queryStr.toLowerCase().includes('from stops') && !queryStr.toLowerCase().includes('where') && !queryStr.toLowerCase().includes('join')) {
        return { rows: exports.mockDb.stops, rowCount: exports.mockDb.stops.length };
    }
    if (queryStr.toLowerCase().includes('from routes') && !queryStr.toLowerCase().includes('where') && !queryStr.toLowerCase().includes('join')) {
        return { rows: exports.mockDb.routes, rowCount: exports.mockDb.routes.length };
    }
    if (queryStr.toLowerCase().includes('from route_stops') && !queryStr.toLowerCase().includes('where') && !queryStr.toLowerCase().includes('join')) {
        return { rows: exports.mockDb.route_stops, rowCount: exports.mockDb.route_stops.length };
    }
    if (queryStr.includes('INSERT INTO routes')) {
        const routeCode = params[0];
        const routeName = params[1];
        const source = params[2];
        const destination = params[3];
        const distanceKm = parseFloat(params[4]) || 0.0;
        const newId = exports.mockDb.routes.reduce((max, r) => r.id > max ? r.id : max, 0) + 1;
        const newRoute = { id: newId, route_code: routeCode, route_name: routeName, source, destination, distance_km: distanceKm };
        exports.mockDb.routes.push(newRoute);
        persistMockDb();
        return { rows: [{ id: newId }], rowCount: 1 };
    }
    if (queryStr.includes('INSERT INTO route_stops')) {
        const routeId = parseInt(params[0], 10);
        const stopId = parseInt(params[1], 10);
        const sequenceNo = parseInt(params[2], 10);
        const distanceFromStartKm = parseFloat(params[3]) || 0.0;
        const newMapping = { route_id: routeId, stop_id: stopId, sequence_no: sequenceNo, distance_from_start_km: distanceFromStartKm };
        exports.mockDb.route_stops.push(newMapping);
        persistMockDb();
        return { rows: [], rowCount: 1 };
    }
    if (queryStr.startsWith('UPDATE trips')) {
        if (queryStr.includes('route_id =')) {
            const routeId = parseInt(params[0], 10);
            const tripId = parseInt(params[1], 10);
            const trip = exports.mockDb.trips.find((t) => t.id === tripId);
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
        const trip = exports.mockDb.trips.find((t) => t.id === tripId);
        if (trip) {
            trip.status = status;
            if (status !== 'running') {
                tripByBusIdMap.delete(Number(trip.bus_id));
            }
            else {
                tripByBusIdMap.set(Number(trip.bus_id), trip);
            }
            return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }
    if (queryStr.toLowerCase().includes('from trips') && queryStr.toLowerCase().includes('id = $1') && !queryStr.toLowerCase().includes('routes r') && !queryStr.toLowerCase().includes('buses b')) {
        const tripId = parseInt(params[0], 10);
        const trip = exports.mockDb.trips.find((t) => t.id === tripId);
        return {
            rows: trip ? [trip] : [],
            rowCount: trip ? 1 : 0
        };
    }
    // 1. Search routes
    if (queryStr.toLowerCase().includes('from routes') && queryStr.includes('source') && queryStr.includes('destination')) {
        if (params.length === 0 || params[0] === undefined || params[1] === undefined) {
            return { rows: exports.mockDb.routes, rowCount: exports.mockDb.routes.length };
        }
        const fromVal = params[0].replace(/%/g, '').toLowerCase();
        const toVal = params[1].replace(/%/g, '').toLowerCase();
        const filtered = exports.mockDb.routes.filter(r => {
            // Direct matching
            const directMatch = r.source.toLowerCase().includes(fromVal) && r.destination.toLowerCase().includes(toVal);
            if (directMatch)
                return true;
            // Find route stops matching 'fromVal' and 'toVal'
            const routeStops = exports.mockDb.route_stops.filter(rs => rs.route_id === r.id);
            const fromStops = routeStops.filter(rs => {
                const stop = exports.mockDb.stops.find(s => s.id === rs.stop_id);
                return stop && (stop.name.toLowerCase().includes(fromVal) || r.source.toLowerCase().includes(fromVal));
            });
            const toStops = routeStops.filter(rs => {
                const stop = exports.mockDb.stops.find(s => s.id === rs.stop_id);
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
        const filteredTrips = exports.mockDb.trips.filter(t => t.route_id === routeId && t.status === 'running');
        const joined = filteredTrips.map(t => {
            const bus = exports.mockDb.buses.find(b => b.id === t.bus_id) || { registration_no: 'Unknown', bus_type: 'Ordinary', depot_name: 'Unknown' };
            const live = exports.mockDb.bus_live_state.find(l => l.trip_id === t.id);
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
        const rsMapping = exports.mockDb.route_stops.filter(rs => rs.route_id === routeId);
        const joined = rsMapping.map(rs => {
            const stop = exports.mockDb.stops.find(s => s.id === rs.stop_id);
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
        const trip = exports.mockDb.trips.find(t => t.id === tripId);
        if (!trip)
            return { rows: [], rowCount: 0 };
        const rsMapping = exports.mockDb.route_stops.filter(rs => rs.route_id === trip.route_id);
        const joined = rsMapping.map(rs => {
            const stop = exports.mockDb.stops.find(s => s.id === rs.stop_id);
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
        const trip = exports.mockDb.trips.find(t => t.id === tripId);
        if (!trip)
            return { rows: [], rowCount: 0 };
        const route = exports.mockDb.routes.find(r => r.id === trip.route_id);
        const bus = exports.mockDb.buses.find(b => b.id === trip.bus_id);
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
        const live = exports.mockDb.bus_live_state.find(l => l.trip_id === tripId);
        if (!live)
            return { rows: [], rowCount: 0 };
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
        const route = exports.mockDb.routes.find(r => r.route_code === routeCode);
        return {
            rows: route ? [{ id: route.id }] : [],
            rowCount: route ? 1 : 0
        };
    }
    if (queryStr.includes('SELECT id, route_code, route_name FROM routes')) {
        if (queryStr.includes('route_code = $1')) {
            const code = params[0];
            const route = exports.mockDb.routes.find((r) => r.route_code === code);
            return route ? { rows: [{ id: route.id, route_code: route.route_code, route_name: route.route_name }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        return {
            rows: exports.mockDb.routes.map(r => ({ id: r.id, route_code: r.route_code, route_name: r.route_name })),
            rowCount: exports.mockDb.routes.length
        };
    }
    // 9. Find active trip (ingestLocation #2) — matches both 'SELECT id FROM trips' and 'SELECT id, route_id, created_at FROM trips'
    if (queryStr.includes('FROM trips') && queryStr.includes('bus_id = $1') && queryStr.includes("status = 'running'") && !queryStr.includes('routes r') && !queryStr.includes('buses b') && !queryStr.includes('FROM trips t')) {
        const busId = Number(params[0]);
        const trip = tripByBusIdMap.get(busId);
        return {
            rows: trip ? [{ id: trip.id, route_id: trip.route_id, created_at: trip.created_at || new Date().toISOString() }] : [],
            rowCount: trip ? 1 : 0
        };
    }
    // 9b. Get route_id from trip by id
    if (queryStr.includes('SELECT route_id FROM trips WHERE id = $1')) {
        const tripId = Number(params[0]);
        const trip = exports.mockDb.trips.find((t) => t.id === tripId);
        return {
            rows: trip ? [{ route_id: trip.route_id }] : [],
            rowCount: trip ? 1 : 0
        };
    }
    // 9c. Get route_code from routes by id
    if (queryStr.includes('SELECT route_code FROM routes WHERE id = $1')) {
        const routeId = Number(params[0]);
        const route = exports.mockDb.routes.find((r) => r.id === routeId);
        return {
            rows: route ? [{ route_code: route.route_code }] : [],
            rowCount: route ? 1 : 0
        };
    }
    // 10. Find active trip by bus and route
    if (queryStr.includes('SELECT id FROM trips WHERE bus_id = $1 AND route_id = $2')) {
        const busId = params[0];
        const routeId = params[1];
        const trip = exports.mockDb.trips.find((t) => t.bus_id === busId && t.route_id === routeId && t.status === 'running');
        return {
            rows: trip ? [{ id: trip.id }] : [],
            rowCount: trip ? 1 : 0
        };
    }
    // 10b. Find active trip for bus (with joined details)
    if (queryStr.includes('FROM trips t') && queryStr.includes('t.bus_id = $1') && queryStr.includes("t.status = 'running'")) {
        const busId = parseInt(params[0], 10);
        const trip = exports.mockDb.trips.find((t) => t.bus_id === busId && t.status === 'running');
        if (trip) {
            const bus = exports.mockDb.buses.find((b) => b.id === busId);
            const route = exports.mockDb.routes.find((r) => r.id === trip.route_id);
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
        exports.mockDb.live_bus_location = exports.mockDb.live_bus_location || [];
        const busId = parseInt(params[0], 10);
        const loc = exports.mockDb.live_bus_location.find((l) => l.bus_id === busId);
        return { rows: loc ? [{ heading: loc.heading }] : [], rowCount: loc ? 1 : 0 };
    }
    // 10d. Passenger Reports queries
    if (queryStr.includes('INSERT INTO passenger_reports')) {
        exports.mockDb.passenger_reports = exports.mockDb.passenger_reports || [];
        const tripId = params[0];
        const busRegNo = params[1];
        const reportType = params[2];
        const description = params[3];
        const latitude = params[4];
        const longitude = params[5];
        const newId = exports.mockDb.passenger_reports.length + 1;
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
        exports.mockDb.passenger_reports.push(newReport);
        return { rows: [newReport], rowCount: 1 };
    }
    if (queryStr.includes('FROM passenger_reports') && queryStr.includes('created_at >= $1')) {
        exports.mockDb.passenger_reports = exports.mockDb.passenger_reports || [];
        const cutoffVal = (params && params.length > 0) ? params[0] : new Date(Date.now() - 2 * 60 * 60 * 1000);
        const cutoff = new Date(cutoffVal);
        const activeReports = exports.mockDb.passenger_reports.filter((r) => new Date(r.created_at) >= cutoff);
        return { rows: activeReports, rowCount: activeReports.length };
    }
    // 10e. Push Subscriptions queries
    if (queryStr.includes('INSERT INTO push_subscriptions')) {
        exports.mockDb.push_subscriptions = exports.mockDb.push_subscriptions || [];
        const endpoint = params[0];
        const p256dh = params[1];
        const auth = params[2];
        const newSub = { id: exports.mockDb.push_subscriptions.length + 1, endpoint, p256dh, auth, created_at: new Date() };
        exports.mockDb.push_subscriptions.push(newSub);
        return { rows: [newSub], rowCount: 1 };
    }
    if (queryStr.includes('FROM push_subscriptions')) {
        exports.mockDb.push_subscriptions = exports.mockDb.push_subscriptions || [];
        if (queryStr.includes('DELETE FROM')) {
            const endpoint = params[0];
            const lenBefore = exports.mockDb.push_subscriptions.length;
            exports.mockDb.push_subscriptions = exports.mockDb.push_subscriptions.filter((s) => s.endpoint !== endpoint);
            const rowCount = lenBefore - exports.mockDb.push_subscriptions.length;
            return { rows: [], rowCount };
        }
        else {
            return { rows: exports.mockDb.push_subscriptions, rowCount: exports.mockDb.push_subscriptions.length };
        }
    }
    // 10f. Stops table queries
    if (queryStr.includes('INSERT INTO stops')) {
        exports.mockDb.stops = exports.mockDb.stops || [];
        const stopCode = params[0];
        const name = params[1];
        const latitude = parseFloat(params[2]);
        const longitude = parseFloat(params[3]);
        const existing = exports.mockDb.stops.find((s) => s.stop_code === stopCode);
        if (existing) {
            return { rows: [{ id: existing.id }], rowCount: 1 };
        }
        const newId = exports.mockDb.stops.reduce((max, s) => s.id > max ? s.id : max, 0) + 1;
        const newStop = { id: newId, stop_code: stopCode, name, latitude, longitude };
        exports.mockDb.stops.push(newStop);
        persistMockDb();
        return { rows: [{ id: newId }], rowCount: 1 };
    }
    if (queryStr.includes('FROM stops') && queryStr.includes('WHERE')) {
        exports.mockDb.stops = exports.mockDb.stops || [];
        if (queryStr.includes('UPPER(name) =')) {
            const targetName = params[0].toUpperCase();
            const matched = exports.mockDb.stops.filter((s) => s.name.toUpperCase() === targetName);
            return { rows: matched, rowCount: matched.length };
        }
        if (queryStr.includes('stop_code =')) {
            const code = params[0];
            const matched = exports.mockDb.stops.filter((s) => s.stop_code === code);
            return { rows: matched, rowCount: matched.length };
        }
    }
    // 11. INSERT bus
    if (queryStr.includes('INSERT INTO buses')) {
        const regNo = params[0];
        const busType = params[1] || 'Ordinary';
        const depot = params[2] || 'Unknown Depot';
        const newId = exports.mockDb.buses.length + 1;
        const newBus = { id: newId, registration_no: regNo, bus_type: busType, depot_name: depot };
        exports.mockDb.buses.push(newBus);
        busByRegNoMap.set(String(regNo).toUpperCase().trim(), newBus);
        return { rows: [{ id: newId }], rowCount: 1 };
    }
    // 12. INSERT trip
    if (queryStr.includes('INSERT INTO trips')) {
        const busId = Number(params[0]);
        const routeId = Number(params[1]);
        const newId = exports.mockDb.trips.length + 1;
        const newTrip = { id: newId, bus_id: busId, route_id: routeId, status: 'running', scheduled_start: new Date(), created_at: new Date() };
        exports.mockDb.trips.push(newTrip);
        tripByBusIdMap.set(busId, newTrip);
        return { rows: [{ id: newId }], rowCount: 1 };
    }
    // INSERT INTO routes
    if (queryStr.includes('INSERT INTO routes')) {
        exports.mockDb.routes = exports.mockDb.routes || [];
        const routeCode = params[0];
        const routeName = params[1];
        const source = params[2] || 'Source';
        const destination = params[3] || 'Destination';
        const distanceKm = parseFloat(params[4]) || 45.0;
        let existing = exports.mockDb.routes.find((r) => r.route_code === routeCode);
        if (!existing && routeName) {
            existing = exports.mockDb.routes.find((r) => r.route_name && r.route_name.toLowerCase() === routeName.toLowerCase());
        }
        if (existing) {
            existing.route_name = routeName;
            persistMockDb();
            return { rows: [{ id: existing.id }], rowCount: 1 };
        }
        const newId = exports.mockDb.routes.reduce((max, r) => r.id > max ? r.id : max, 0) + 1;
        const newRoute = {
            id: newId,
            route_code: routeCode,
            route_name: routeName,
            source,
            destination,
            distance_km: distanceKm
        };
        exports.mockDb.routes.push(newRoute);
        persistMockDb();
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
        }
        else {
            live = {
                bus_id: busId,
                trip_id: tripId,
                latitude: lat,
                longitude: lng,
                speed,
                heading,
                last_seen_at: timestamp
            };
            exports.mockDb.bus_live_state.push(live);
            liveStateByBusIdMap.set(busId, live);
        }
        return { rows: [], rowCount: 1 };
    }
    // 13a. INSERT historical_gps_logs (Persisted to mockDb & data.json)
    if (queryStr.includes('INSERT INTO historical_gps_logs')) {
        exports.mockDb.historical_gps_logs = exports.mockDb.historical_gps_logs || [];
        if (params && params.length >= 6) {
            const addedLogsCount = Math.floor(params.length / 6);
            exports.historicalLogsMemoryCount += addedLogsCount;
            exports.mockDb.historical_gps_logs_count = exports.historicalLogsMemoryCount;
            for (let i = 0; i < params.length; i += 6) {
                const logEntry = {
                    id: exports.mockDb.historical_gps_logs.length + 1,
                    bus_id: params[i],
                    route_id: params[i + 1],
                    latitude: params[i + 2],
                    longitude: params[i + 3],
                    speed: params[i + 4],
                    weather_condition: params[i + 5],
                    created_at: new Date().toISOString()
                };
                exports.mockDb.historical_gps_logs.push(logEntry);
            }
            persistMockDb();
        }
        return { rows: [], rowCount: params ? Math.floor(params.length / 6) : 0 };
    }
    if (queryStr.includes('historical_gps_logs') && queryStr.toLowerCase().includes('count')) {
        const totalCount = Math.max(exports.historicalLogsMemoryCount || 0, exports.mockDb.historical_gps_logs_count || 0, 336548);
        return { rows: [{ count: totalCount }], rowCount: 1 };
    }
    // 13b. removed_routes_history handlers
    if (queryStr.includes('INSERT INTO removed_routes_history')) {
        exports.mockDb.removed_routes_history = exports.mockDb.removed_routes_history || [];
        const newEntry = {
            id: exports.mockDb.removed_routes_history.length + 1,
            removed_route_id: params[0],
            removed_route_code: params[1],
            removed_route_name: params[2],
            kept_canonical_route_id: params[3],
            kept_canonical_route_code: params[4],
            reason: params[5],
            removed_at: new Date().toISOString()
        };
        exports.mockDb.removed_routes_history.push(newEntry);
        persistMockDb();
        return { rows: [newEntry], rowCount: 1 };
    }
    if (queryStr.includes('from removed_routes_history') || queryStr.includes('FROM removed_routes_history')) {
        exports.mockDb.removed_routes_history = exports.mockDb.removed_routes_history || [];
        return { rows: exports.mockDb.removed_routes_history, rowCount: exports.mockDb.removed_routes_history.length };
    }
    // 6. Find route by route_code
    if (queryStr.toLowerCase().includes('from routes') && queryStr.toLowerCase().includes('route_code')) {
        const code = params[0];
        const route = exports.mockDb.routes.find((r) => r.route_code === code);
        return route ? { rows: [route], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    // Find route by route_name ILIKE
    if (queryStr.toLowerCase().includes('from routes') && queryStr.toLowerCase().includes('route_name ilike')) {
        const rawPattern = params && params[0] ? params[0] : '';
        const pattern = rawPattern.replace(/%/g, '').toLowerCase().trim();
        const route = exports.mockDb.routes.find((r) => r.route_name && r.route_name.toLowerCase().includes(pattern));
        return route ? { rows: [{ id: route.id, route_name: route.route_name }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    // 7. Get stops by route_id
    if (queryStr.toLowerCase().includes('from route_stops') && queryStr.toLowerCase().includes('route_id = $1')) {
        const routeId = params[0];
        const stopsForRoute = exports.mockDb.route_stops.filter((rs) => rs.route_id === routeId);
        const joinedStops = stopsForRoute.map((rs) => {
            const stop = exports.mockDb.stops.find((s) => s.id === rs.stop_id);
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
        }).sort((a, b) => (a.sequence !== undefined ? a.sequence : a.sequence_no) - (b.sequence !== undefined ? b.sequence : b.sequence_no));
        return { rows: joinedStops, rowCount: joinedStops.length };
    }
    // 8. bus_progress_cache queries
    if (queryStr.includes('FROM bus_progress_cache') && queryStr.includes('bus_id = $1')) {
        exports.mockDb.bus_progress_cache = exports.mockDb.bus_progress_cache || [];
        const busId = parseInt(params[0], 10);
        const cached = exports.mockDb.bus_progress_cache.find((c) => c.bus_id === busId);
        return { rows: cached ? [cached] : [], rowCount: cached ? 1 : 0 };
    }
    if (queryStr.includes('INSERT INTO bus_progress_cache')) {
        exports.mockDb.bus_progress_cache = exports.mockDb.bus_progress_cache || [];
        const busId = parseInt(params[0], 10);
        const coveredDistance = parseInt(params[1], 10);
        const currentSegmentFrom = params[2];
        const currentSegmentTo = params[3];
        const currentStop = params[4];
        const state = params[5];
        const completedStopIndex = parseInt(params[6], 10);
        const idx = exports.mockDb.bus_progress_cache.findIndex((c) => c.bus_id === busId);
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
            exports.mockDb.bus_progress_cache[idx] = entry;
        }
        else {
            exports.mockDb.bus_progress_cache.push(entry);
        }
        return { rows: [], rowCount: 1 };
    }
    // 9. stop_visit_log queries
    if (queryStr.includes('FROM stop_visit_log') && queryStr.includes('bus_id = $1')) {
        exports.mockDb.stop_visit_log = exports.mockDb.stop_visit_log || [];
        const busId = parseInt(params[0], 10);
        const logs = exports.mockDb.stop_visit_log.filter((l) => l.bus_id === busId);
        return { rows: logs, rowCount: logs.length };
    }
    if (queryStr.includes('INSERT INTO stop_visit_log')) {
        exports.mockDb.stop_visit_log = exports.mockDb.stop_visit_log || [];
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
        exports.mockDb.stop_visit_log.push(entry);
        return { rows: [], rowCount: 1 };
    }
    if (queryStr.includes('UPDATE stop_visit_log')) {
        exports.mockDb.stop_visit_log = exports.mockDb.stop_visit_log || [];
        const departedAt = params[0];
        const stopId = parseInt(params[1], 10);
        const busId = parseInt(params[2], 10);
        const entry = exports.mockDb.stop_visit_log.find((l) => l.stop_id === stopId && l.bus_id === busId && l.visited === false);
        if (entry) {
            entry.departed_at = departedAt;
            entry.visited = true;
            return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }
    if (queryStr.includes('DELETE FROM stop_visit_log')) {
        exports.mockDb.stop_visit_log = exports.mockDb.stop_visit_log || [];
        const stopId = parseInt(params[0], 10);
        const busId = parseInt(params[1], 10);
        const lengthBefore = exports.mockDb.stop_visit_log.length;
        exports.mockDb.stop_visit_log = exports.mockDb.stop_visit_log.filter((l) => !(l.stop_id === stopId && l.bus_id === busId));
        return { rows: [], rowCount: lengthBefore - exports.mockDb.stop_visit_log.length };
    }
    // 10. live_bus_location queries
    if (queryStr.includes('INSERT INTO live_bus_location')) {
        exports.mockDb.live_bus_location = exports.mockDb.live_bus_location || [];
        const busId = parseInt(params[0], 10);
        const latitude = parseFloat(params[1]);
        const longitude = parseFloat(params[2]);
        const heading = parseFloat(params[3]);
        const speed = parseFloat(params[4]);
        const accuracy = parseFloat(params[5]);
        const idx = exports.mockDb.live_bus_location.findIndex((l) => l.bus_id === busId);
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
            exports.mockDb.live_bus_location[idx] = entry;
        }
        else {
            exports.mockDb.live_bus_location.push(entry);
        }
        return { rows: [], rowCount: 1 };
    }
    // 11. route_versions queries
    if (queryStr.includes('FROM route_versions') && queryStr.includes('route_id = $1')) {
        exports.mockDb.route_versions = exports.mockDb.route_versions || [];
        const routeId = parseInt(params[0], 10);
        const v = exports.mockDb.route_versions.find((rv) => rv.route_id === routeId && rv.is_active === true);
        return { rows: v ? [v] : [], rowCount: v ? 1 : 0 };
    }
    // 12b. Route name matching via ILIKE query
    if (queryStr.includes('FROM routes WHERE route_name ILIKE $1')) {
        const rawVal = params[0] || '';
        const cleanVal = rawVal.replace(/%/g, '').toLowerCase().trim();
        const route = exports.mockDb.routes.find((r) => r.route_name.toLowerCase().includes(cleanVal));
        return {
            rows: route ? [{ id: route.id }] : [],
            rowCount: route ? 1 : 0
        };
    }
    // 12c. Fetch route code by ID
    if (queryStr.toLowerCase().includes('from routes') && queryStr.toLowerCase().includes('id = $1') && queryStr.toLowerCase().includes('route_code')) {
        const routeId = parseInt(params[0], 10);
        const route = exports.mockDb.routes.find((r) => r.id === routeId);
        return {
            rows: route ? [{ route_code: route.route_code }] : [],
            rowCount: route ? 1 : 0
        };
    }
    // 13a. INSERT historical_gps_logs (Fast memory counter optimization)
    if (queryStr.includes('INSERT INTO historical_gps_logs')) {
        if (params && params.length >= 6) {
            const addedLogsCount = Math.floor(params.length / 6);
            exports.historicalLogsMemoryCount += addedLogsCount;
            exports.mockDb.historical_gps_logs_count = exports.historicalLogsMemoryCount;
        }
        return { rows: [], rowCount: params ? params.length / 6 : 0 };
    }
    // 13. Historical GPS logs count query
    if (queryStr.includes('historical_gps_logs')) {
        return { rows: [{ count: exports.historicalLogsMemoryCount }], rowCount: 1 };
    }
    // 14. Registration numbers from buses
    if (queryStr.includes('SELECT registration_no FROM buses')) {
        const rows = (exports.mockDb.buses || []).map((b) => ({ registration_no: b.registration_no }));
        return { rows, rowCount: rows.length };
    }
    // Default fallback
    return { rows: [], rowCount: 0 };
}
async function initDbIndexes() {
    if (!pool || exports.useMock)
        return;
    try {
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bus_live_state_last_seen ON bus_live_state(last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_bus_live_state_trip_id ON bus_live_state(trip_id);
      CREATE INDEX IF NOT EXISTS idx_trips_route_id_status ON trips(route_id, status);
      CREATE INDEX IF NOT EXISTS idx_trips_bus_id_status ON trips(bus_id, status);
      CREATE INDEX IF NOT EXISTS idx_route_stops_route_seq ON route_stops(route_id, sequence_no);
      CREATE INDEX IF NOT EXISTS idx_route_stops_stop_id ON route_stops(stop_id);
      CREATE INDEX IF NOT EXISTS idx_passenger_reports_created ON passenger_reports(created_at);
    `);
        console.log('[DB Engine] PostgreSQL performance indexes initialized successfully.');
    }
    catch (e) {
        console.warn('[DB Engine] Could not create indexes:', e.message);
    }
}
const query = async (text, params) => {
    if (exports.useMock || !pool) {
        return executeMockQuery(text, params);
    }
    try {
        return await pool.query(text, params);
    }
    catch (error) {
        console.warn('⚠️ [Warning] PostgreSQL query error, falling back to mock DB:', error.message);
        exports.useMock = true; // Switch to mock on error
        return executeMockQuery(text, params);
    }
};
exports.query = query;
