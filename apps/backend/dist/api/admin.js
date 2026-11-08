"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const adminMonitor_1 = require("../services/adminMonitor");
const graph_1 = require("../engine/graph");
const db_1 = require("../db");
exports.router = (0, express_1.Router)();
// 1. Get live logs circular buffer
exports.router.get('/monitor/logs', (req, res) => {
    res.json({ logs: adminMonitor_1.adminMonitor.getLogs() });
});
// 2. Get active tracked buses grid
exports.router.get('/monitor/buses', async (req, res) => {
    const buses = adminMonitor_1.adminMonitor.getActiveBuses();
    try {
        const { redisGet } = require('../utils/redis');
        const updatedBuses = await Promise.all(buses.map(async (bus) => {
            const liveRouteData = await redisGet(`bus:${bus.regNo}`);
            if (liveRouteData && liveRouteData.route_name) {
                return {
                    ...bus,
                    routeName: liveRouteData.route_name,
                    routeCode: liveRouteData.trip_id !== 'UNKNOWN' ? liveRouteData.trip_id : bus.routeCode
                };
            }
            return bus;
        }));
        res.json({ buses: updatedBuses });
    }
    catch (err) {
        res.json({ buses });
    }
});
// 3. Get database stats summary
exports.router.get('/monitor/stats', async (req, res) => {
    const stats = await adminMonitor_1.adminMonitor.getStats();
    res.json({ stats });
});
// ─── INTERNAL BRIDGE ─────────────────────────────────────────────────────────
// POST /api/v1/admin/monitor/push
// Called by the Engine process to forward GPS logs & bus state updates
// so the Admin UI (which polls backend) sees live data from the engine.
exports.router.post('/monitor/push', (req, res) => {
    try {
        const { logs, busUpdates } = req.body || {};
        // Accept array of log items from engine
        if (Array.isArray(logs)) {
            for (const log of logs) {
                adminMonitor_1.adminMonitor.addLog({
                    terminalId: log.terminalId || 'engine',
                    service: log.service,
                    level: log.level,
                    entityId: log.entityId,
                    type: log.type || 'SYSTEM',
                    busId: log.busId,
                    regNo: log.regNo,
                    status: log.status,
                    message: log.message || '',
                    latencyMs: log.latencyMs
                });
                if (log.message && (log.message.includes('Successfully seeded route') ||
                    log.message.includes('Successfully learned new route') ||
                    log.message.includes('learned new route variant') ||
                    log.message.includes('Route variation created'))) {
                    adminMonitor_1.adminMonitor.seededRoutesCount += 1;
                }
                if (log.message && (log.message.includes('Successfully geocoded and saved stop') ||
                    log.message.includes('New stop registered') ||
                    log.message.includes('geocoded stop'))) {
                    adminMonitor_1.adminMonitor.seededStopsCount += 1;
                }
            }
        }
        // Accept array of bus state updates from engine
        if (Array.isArray(busUpdates)) {
            try {
                const { incrementHistoricalLogsCount } = require('../db');
                incrementHistoricalLogsCount(busUpdates.length);
            }
            catch { }
            for (const bus of busUpdates) {
                if (bus.busId) {
                    adminMonitor_1.adminMonitor.updateBus(bus.busId, bus.regNo || 'UNKNOWN', {
                        latitude: bus.latitude,
                        longitude: bus.longitude,
                        speed: bus.speed,
                        heading: bus.heading,
                        routeCode: bus.routeCode,
                        routeName: bus.routeName,
                        tripId: bus.tripId,
                        currentStop: bus.currentStop,
                        zoneName: bus.zoneName,
                        status: bus.status,
                        originalRouteStr: bus.originalRouteStr,
                        isNewlyDetected: bus.isNewlyDetected
                    });
                    // Sync into mockDb.bus_live_state so passenger queries work without PostgreSQL
                    if (db_1.mockDb.bus_live_state && bus.tripId) {
                        const idx = db_1.mockDb.bus_live_state.findIndex((l) => l.bus_id === bus.busId);
                        const liveEntry = {
                            bus_id: bus.busId,
                            trip_id: bus.tripId,
                            latitude: bus.latitude,
                            longitude: bus.longitude,
                            speed: bus.speed || 0,
                            heading: bus.heading || 0,
                            last_seen_at: new Date().toISOString()
                        };
                        if (idx >= 0) {
                            db_1.mockDb.bus_live_state[idx] = liveEntry;
                        }
                        else {
                            db_1.mockDb.bus_live_state.push(liveEntry);
                        }
                    }
                }
            }
        }
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 4. Get stops and route lines for map rendering
const db_2 = require("../db");
exports.router.get('/monitor/map-data', async (req, res) => {
    try {
        const stopsMap = (0, graph_1.getStopsMap)();
        const routeStopsMap = (0, graph_1.getRouteStopsMap)();
        // Fetch route names map
        const routeNamesRes = await (0, db_2.query)('SELECT id, route_name FROM routes');
        const routeNamesMap = new Map(routeNamesRes.rows.map((r) => [r.id, r.route_name]));
        const stops = Array.from(stopsMap.values()).map((s) => ({
            id: s.id,
            name: s.name,
            lat: s.latitude,
            lng: s.longitude
        }));
        const routes = [];
        for (const [routeId, rStops] of routeStopsMap.entries()) {
            const pathPoints = rStops
                .slice() // copy array to avoid sorting mutation side-effects
                .sort((a, b) => a.sequence_no - b.sequence_no)
                .map(rs => {
                const stop = stopsMap.get(rs.stop_id);
                return stop ? [stop.latitude, stop.longitude] : null;
            })
                .filter(p => p !== null);
            if (pathPoints.length > 1) {
                routes.push({
                    routeId,
                    routeName: routeNamesMap.get(routeId) || `Route ${routeId}`,
                    path: pathPoints
                });
            }
        }
        res.json({ stops, routes });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 8. Get removed routes history audit trail
exports.router.get('/monitor/removed-routes', (req, res) => {
    const history = db_1.mockDb.removed_routes_history || [];
    res.json({ removedRoutes: history });
});
// 9. Trigger deduplication scan endpoint
exports.router.post('/monitor/deduplicate', async (req, res) => {
    try {
        const { runRouteDeduplicationCycle } = require('../engine/routeDeduplicationEngine');
        const result = await runRouteDeduplicationCycle();
        res.json({ success: true, result, history: result.history || db_1.mockDb.removed_routes_history || [] });
    }
    catch (err) {
        res.json({ success: false, error: err.message, history: db_1.mockDb.removed_routes_history || [] });
    }
});
// 10. Master Stops Ingestion & Quality Audit (14,762 Margdarshi Stops)
let cachedMasterStopsResult = null;
exports.router.get('/monitor/master-stops', (req, res) => {
    try {
        if (!cachedMasterStopsResult) {
            const { processMasterStops } = require('../engine/masterStopsIngestion');
            const path = require('path');
            const fs = require('fs');
            let rawPath = path.resolve(__dirname, '../db/margdarshi_raw_stops.json');
            if (!fs.existsSync(rawPath)) {
                rawPath = path.resolve(__dirname, '../../src/db/margdarshi_raw_stops.json');
            }
            cachedMasterStopsResult = processMasterStops(rawPath);
        }
        const { page = 1, limit = 50, quality, search } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
        let filtered = cachedMasterStopsResult.stops;
        if (quality && quality !== 'all') {
            filtered = filtered.filter((s) => s.sourceQuality === quality);
        }
        if (search && typeof search === 'string' && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter((s) => (s.name && s.name.toLowerCase().includes(q)) ||
                String(s.stopCode).includes(q) ||
                (s.adminAreaCode && s.adminAreaCode.toLowerCase().includes(q)));
        }
        const total = filtered.length;
        const totalPages = Math.ceil(total / limitNum);
        const offset = (pageNum - 1) * limitNum;
        const pagedStops = filtered.slice(offset, offset + limitNum);
        res.json({
            stats: cachedMasterStopsResult.stats,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages,
            stops: pagedStops
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
