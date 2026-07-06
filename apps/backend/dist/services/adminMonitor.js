"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMonitor = void 0;
const db_1 = require("../db");
// A bus is considered stale if it hasn't sent a ping in this many milliseconds
const STALE_BUS_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
class AdminMonitorService {
    logs = [];
    activeBuses = new Map();
    maxLogs = 100;
    cleanupInterval = null;
    constructor() {
        this.addLog({
            type: 'SYSTEM',
            message: 'Admin Real-Time Monitoring Service started successfully.'
        });
        this.initializeActiveBuses();
        this.startStaleCleanup();
    }
    /**
     * Pre-load currently active buses from mockDb on startup
     */
    initializeActiveBuses() {
        try {
            const runningTrips = db_1.mockDb.trips?.filter((t) => t.status === 'running') || [];
            for (const trip of runningTrips) {
                const bus = db_1.mockDb.buses?.find((b) => b.id === trip.bus_id);
                const route = db_1.mockDb.routes?.find((r) => r.id === trip.route_id);
                const live = db_1.mockDb.live_bus_location?.find((l) => l.bus_id === trip.bus_id);
                const progress = db_1.mockDb.bus_progress_cache?.find((p) => p.bus_id === trip.bus_id);
                if (bus) {
                    const regNo = bus.registration_no;
                    this.activeBuses.set(trip.bus_id, {
                        busId: trip.bus_id,
                        regNo: regNo,
                        latitude: live?.latitude ?? 26.8467,
                        longitude: live?.longitude ?? 80.9462,
                        speed: live?.speed ?? 0,
                        heading: live?.heading ?? 0,
                        lastSeen: live?.updated_at || new Date().toISOString(),
                        routeCode: route?.route_code ?? `R_${trip.route_id}`,
                        routeName: route?.route_name ?? 'Dynamic Route',
                        currentStop: progress?.current_stop ?? 'En-route',
                        status: progress?.state ?? 'BETWEEN_STOPS'
                    });
                }
            }
            console.log(`[Admin Monitor] Pre-loaded ${this.activeBuses.size} running buses from database.`);
            this.addLog({
                type: 'SYSTEM',
                message: `Pre-loaded ${this.activeBuses.size} active buses from database.`
            });
        }
        catch (err) {
            console.error('[Admin Monitor] Error pre-loading active buses:', err);
        }
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
                    type: 'SYSTEM',
                    message: `Removed ${removedCount} stale bus(es) from active tracking (no ping for ${STALE_BUS_TIMEOUT_MS / 60000} min).`
                });
            }
        }, 60 * 1000); // Run cleanup every 1 minute
    }
    /**
     * Add a log entry to the in-memory circular buffer
     */
    addLog(item) {
        const logItem = {
            ...item,
            timestamp: new Date().toISOString()
        };
        this.logs.push(logItem);
        // Maintain maximum logs threshold
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
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
        const updated = {
            busId: busId,
            regNo: regNo || existing?.regNo || 'UP-UNKNOWN',
            latitude: data.latitude ?? existing?.latitude ?? 0,
            longitude: data.longitude ?? existing?.longitude ?? 0,
            speed: data.speed ?? existing?.speed ?? 0,
            heading: data.heading ?? existing?.heading ?? 0,
            lastSeen: new Date().toISOString(),
            routeCode: data.routeCode ?? existing?.routeCode,
            routeName: data.routeName ?? existing?.routeName,
            currentStop: data.currentStop ?? existing?.currentStop,
            zoneName: data.zoneName ?? existing?.zoneName,
            status: data.status ?? existing?.status ?? 'active'
        };
        this.activeBuses.set(busId, updated);
        // Log when a genuinely new bus first appears
        if (isNewBus) {
            console.log(`[Admin Monitor] NEW bus registered: busId=${busId}, regNo=${regNo}. Total active: ${this.activeBuses.size}`);
            // Mark as newly detected — NewBusDiscovery will update this once route is confirmed
            updated.isNewlyDetected = true;
            this.addLog({
                type: 'SYSTEM',
                busId,
                regNo,
                message: `New bus online: ${regNo} (ID: ${busId}). Total active buses: ${this.activeBuses.size}`
            });
        }
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
