"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMonitor = void 0;
const db_1 = require("../db");
// A bus is considered stale if it hasn't sent a ping in this many milliseconds
const STALE_BUS_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
class AdminMonitorService {
    logs = [];
    activeBuses = new Map();
    maxLogs = 300;
    cleanupInterval = null;
    // ── Batched push buffer ───────────────────────────────────────────────────
    // Instead of one HTTP request per GPS event (thousands/sec → port exhaustion),
    // we batch all pending logs & bus updates and flush every 2 seconds.
    pendingLogs = [];
    pendingBusUpdates = new Map();
    flushInterval = null;
    constructor() {
        this.addLog({
            terminalId: 'engine',
            service: 'GEO-MATCH',
            level: 'INFO',
            type: 'SYSTEM',
            message: 'Admin Real-Time Monitoring Service started successfully.'
        });
        this.initializeActiveBuses();
        this.startStaleCleanup();
        this.startBatchFlush();
    }
    /**
     * Active buses are dynamically populated from real-time Margdarshi API pings.
     */
    initializeActiveBuses() {
        // No-op: live pings populate this map dynamically
    }
    /**
     * Periodically remove buses that haven't sent a GPS ping recently.
     * This ensures the count naturally drops when a bus stops transmitting.
     */
    startStaleCleanup() {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            let removedCount = 0;
            for (const [busId, bus] of this.activeBuses.entries()) {
                const lastSeenMs = new Date(bus.lastSeen).getTime();
                if (now - lastSeenMs > STALE_BUS_TIMEOUT_MS) {
                    this.activeBuses.delete(busId);
                    removedCount++;
                    console.log(`[Admin Monitor] Removed stale bus ${busId} (${bus.regNo}) - last seen ${Math.round((now - lastSeenMs) / 60000)} min ago`);
                }
            }
            if (removedCount > 0) {
                this.addLog({
                    terminalId: 'engine',
                    service: 'STALE-TRACKER',
                    level: 'WARN',
                    type: 'SYSTEM',
                    message: `Removed ${removedCount} stale bus(es) from active tracking (no ping for ${STALE_BUS_TIMEOUT_MS / 60000} min).`
                });
            }
        }, 60 * 1000); // Run cleanup every 1 minute
    }
    /**
     * Add a log entry to the in-memory circular buffer.
     * VALIDATION logs are console-only (too frequent to push to backend).
     * Other important logs (SEEDER, LEARNING, NEW_BUS, ERROR) are batched & pushed.
     */
    addLog(item) {
        const termId = item.terminalId || 'engine';
        const logItem = {
            ...item,
            terminalId: termId,
            service: item.service || (item.type === 'SEEDER' ? 'GEOCODER-SEEDER' : item.type === 'NEW_BUS' ? 'NEW-BUS-DISCOVERY' : 'GEO-MATCH'),
            level: item.level || (item.type === 'ERROR' ? 'ERROR' : item.status === 'rejected' ? 'WARN' : 'INFO'),
            timestamp: new Date().toISOString()
        };
        this.logs.push(logItem);
        // Maintain maximum logs threshold
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        // Cap pendingLogs to prevent memory buildup between flushes
        if (this.pendingLogs.length < 200) {
            this.pendingLogs.push(logItem);
        }
    }
    /**
     * Update the live tracking state of a bus.
     * If the bus is NEW (never seen before), it is automatically registered.
     * This means any bus that sends a GPS ping — even a brand new one —
     * will immediately appear in the active list and increment the count.
     */
    updateBus(busId, regNo, data) {
        if (!busId)
            return;
        const existing = this.activeBuses.get(busId);
        const isNewBus = !existing;
        let finalRouteName = data.routeName ?? existing?.routeName;
        let finalRouteCode = data.routeCode ?? existing?.routeCode;
        let finalCurrentStop = data.currentStop ?? existing?.currentStop;
        const busLat = data.latitude ?? existing?.latitude ?? 0;
        const busLng = data.longitude ?? existing?.longitude ?? 0;
        const busZone = data.zoneName ?? existing?.zoneName;
        const busHeading = data.heading ?? existing?.heading ?? 0;
        const busSpeed = data.speed ?? existing?.speed ?? 0;
        // 1. Resolve Intelligent Route Name (Eliminating repetitive generic corridor assignments)
        const isGenericFallback = finalRouteName && (finalRouteName.includes(' - Delhi') ||
            finalRouteName.includes(' - Lucknow') ||
            finalRouteName === 'Lucknow - Kanpur Express' ||
            finalRouteName === 'UNKNOWN');
        if (!finalRouteName || isGenericFallback) {
            try {
                const { resolveSmartRouteName } = require('../engine/smartRouteResolver');
                const resolved = resolveSmartRouteName(regNo, busLat, busLng, data.originalRouteStr || (isGenericFallback ? undefined : data.routeName), undefined, busZone, busHeading, busSpeed);
                if (resolved && resolved.routeName) {
                    finalRouteName = resolved.routeName;
                    finalRouteCode = resolved.routeCode;
                }
            }
            catch { }
        }
        // 2. Resolve Dynamic Landmark Stop (Eliminating repetitive 'Near: En-route')
        if (!finalCurrentStop || finalCurrentStop.toLowerCase().includes('en-route') || finalCurrentStop === 'Unknown' || finalCurrentStop.toLowerCase().includes('en route')) {
            try {
                const { resolveNearestStopName } = require('../utils/nearestStopResolver');
                finalCurrentStop = resolveNearestStopName(busLat, busLng, busZone);
            }
            catch { }
        }
        const updated = {
            busId: busId,
            regNo: regNo || existing?.regNo || 'UP-UNKNOWN',
            latitude: busLat,
            longitude: busLng,
            speed: data.speed ?? existing?.speed ?? 0,
            heading: data.heading ?? existing?.heading ?? 0,
            lastSeen: new Date().toISOString(),
            routeCode: finalRouteCode,
            routeName: finalRouteName,
            tripId: data.tripId ?? existing?.tripId,
            currentStop: finalCurrentStop,
            zoneName: busZone,
            status: data.status ?? existing?.status ?? 'active'
        };
        this.activeBuses.set(busId, updated);
        // Log when a genuinely new bus first appears
        if (isNewBus) {
            console.log(`[Admin Monitor] NEW bus registered: busId=${busId}, regNo=${regNo}. Total active: ${this.activeBuses.size}`);
            // Mark as newly detected — NewBusDiscovery will update this once route is confirmed
            updated.isNewlyDetected = true;
        }
        // Queue for next batch flush — NOT an immediate HTTP call
        this.pendingBusUpdates.set(busId, updated);
    }
    /**
     * Mark a bus as COMPLETED and remove it from the active list.
     * Call this when a trip finishes so the count decreases immediately.
     */
    removeBus(busId) {
        const bus = this.activeBuses.get(busId);
        if (bus) {
            this.activeBuses.delete(busId);
            console.log(`[Admin Monitor] Bus ${busId} (${bus.regNo}) removed from active tracking (trip completed).`);
            this.addLog({
                type: 'SYSTEM',
                busId,
                regNo: bus.regNo,
                message: `Bus ${bus.regNo} (ID: ${busId}) trip completed. Removed from active tracking. Total active: ${this.activeBuses.size}`
            });
        }
    }
    /**
     * Batch flush: collect all pending logs & bus updates, send ONE HTTP request
     * to backend every 1000ms. Prevents port exhaustion on Windows.
     */
    startBatchFlush() {
        this.flushInterval = setInterval(async () => {
            const logs = this.pendingLogs.splice(0); // drain & clear
            const busUpdates = Array.from(this.pendingBusUpdates.values());
            this.pendingBusUpdates.clear();
            if (logs.length === 0 && busUpdates.length === 0)
                return; // nothing to send
            await this.flushToBackend({ logs, busUpdates });
        }, 1000); // Flush every 1000ms — smooth real-time stream without port exhaustion
    }
    /**
     * Single fire-and-forget HTTP push to backend bridge.
     * Called only by startBatchFlush — never directly per-event.
     */
    async flushToBackend(payload) {
        const primaryUrl = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:5000';
        const fallbackUrl = 'http://localhost:5000';
        const bodyStr = JSON.stringify(payload);
        const tryPush = async (baseUrl) => {
            const fetchFn = globalThis.fetch || (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
            return await fetchFn(`${baseUrl}/api/v1/admin/monitor/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: bodyStr
            });
        };
        try {
            let response = await tryPush(primaryUrl);
            if (!response.ok && primaryUrl.includes('127.0.0.1')) {
                response = await tryPush(fallbackUrl);
            }
            if (response.ok && payload.busUpdates.length > 0) {
                // Log periodically or on first push
                if (Math.random() < 0.1) {
                    console.log(`[Admin Monitor Bridge] Pushed ${payload.busUpdates.length} active bus telemetry states to Backend.`);
                }
            }
            else if (!response.ok) {
                console.error(`[Admin Monitor Bridge] Failed to push to backend: HTTP ${response.status}`);
            }
        }
        catch (err) {
            try {
                const fetchFn = globalThis.fetch || (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
                const fallbackRes = await fetchFn(`${fallbackUrl}/api/v1/admin/monitor/push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: bodyStr
                });
                if (fallbackRes.ok && payload.busUpdates.length > 0) {
                    console.log(`[Admin Monitor Bridge] Pushed ${payload.busUpdates.length} active bus telemetry states to Backend (via fallback).`);
                }
            }
            catch (fallbackErr) {
                if (err.code === 'ECONNREFUSED' || fallbackErr.code === 'ECONNREFUSED') {
                    console.warn('[Admin Monitor Bridge] Warning: Backend server on port 5000 is not running yet (waiting for backend to start).');
                }
                else {
                    console.warn('[Admin Monitor Bridge] Backend connection pending:', err.message);
                }
            }
        }
    }
    /**
     * Get all validation & seeder logs
     */
    getLogs() {
        return [...this.logs];
    }
    /**
     * Get all currently active (non-stale) buses.
     * Count will naturally grow as new buses come online and
     * shrink as buses finish their trips or go silent.
     */
    getActiveBuses(limit = 10000) {
        return Array.from(this.activeBuses.values())
            .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
            .slice(0, limit);
    }
    /**
     * Retrieve total database stats dynamically
     */
    async getStats() {
        try {
            const stopsCount = db_1.mockDb.stops.length;
            const routesCount = db_1.mockDb.routes.length;
            const routeStopsCount = db_1.mockDb.route_stops.length;
            const busesCount = db_1.mockDb.buses.length;
            const tripsCount = db_1.mockDb.trips.length;
            const learnedRoutes = db_1.mockDb.routes.filter((r) => (r.route_code || '').includes('VAR') ||
                (r.route_code || '').includes('LEARNED') ||
                r.id > 300).length;
            return {
                stopsCount,
                routesCount,
                routeStopsCount,
                busesCount,
                tripsCount,
                learnedRoutesCount: learnedRoutes,
                activeBusesCount: this.activeBuses.size
            };
        }
        catch (e) {
            return {
                error: e.message || e,
                stopsCount: 0,
                routesCount: 0,
                routeStopsCount: 0,
                busesCount: 0,
                tripsCount: 0,
                learnedRoutesCount: 0,
                activeBusesCount: 0
            };
        }
    }
}
exports.adminMonitor = new AdminMonitorService();
