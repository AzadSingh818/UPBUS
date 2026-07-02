"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const adminMonitor_1 = require("../services/adminMonitor");
const graph_1 = require("../engine/graph");
exports.router = (0, express_1.Router)();
// 1. Get live logs circular buffer
exports.router.get('/monitor/logs', (req, res) => {
    res.json({ logs: adminMonitor_1.adminMonitor.getLogs() });
});
// 2. Get active tracked buses grid
exports.router.get('/monitor/buses', (req, res) => {
    res.json({ buses: adminMonitor_1.adminMonitor.getActiveBuses() });
});
// 3. Get database stats summary
exports.router.get('/monitor/stats', async (req, res) => {
    const stats = await adminMonitor_1.adminMonitor.getStats();
    res.json({ stats });
});
// 4. Get stops and route lines for map rendering
const db_1 = require("../db");
exports.router.get('/monitor/map-data', async (req, res) => {
    try {
        const stopsMap = (0, graph_1.getStopsMap)();
        const routeStopsMap = (0, graph_1.getRouteStopsMap)();
        // Fetch route names map
        const routeNamesRes = await (0, db_1.query)('SELECT id, route_name FROM routes');
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
