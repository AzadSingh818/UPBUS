"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRouteSequenceHash = generateRouteSequenceHash;
exports.generateDirectPairKey = generateDirectPairKey;
exports.runRouteDeduplicationCycle = runRouteDeduplicationCycle;
const db_1 = require("../db");
const adminMonitor_1 = require("../services/adminMonitor");
/**
 * Generate a deterministic sequence hash for an ordered list of stop IDs
 */
function generateRouteSequenceHash(stopIds) {
    if (!stopIds || stopIds.length === 0)
        return '';
    return stopIds.join('-');
}
/**
 * Generate a canonical pair key for direct 2-stop routes (1 <-> 2)
 */
function generateDirectPairKey(stopA, stopB) {
    const minId = Math.min(stopA, stopB);
    const maxId = Math.max(stopA, stopB);
    return `PAIR_${minId}_${maxId}`;
}
/**
 * Main Deduplication Cycle Execution
 */
async function runRouteDeduplicationCycle() {
    console.log('[Route Deduplication Engine] 🔍 Starting route deduplication scan...');
    adminMonitor_1.adminMonitor.addLog({
        terminalId: 'engine',
        service: 'ROUTE-DEDUP',
        level: 'INFO',
        type: 'SYSTEM',
        message: 'Starting automated Master-Mapping route deduplication scan...'
    });
    try {
        db_1.mockDb.removed_routes_history = db_1.mockDb.removed_routes_history || [];
        db_1.mockDb.routes = db_1.mockDb.routes || [];
        db_1.mockDb.route_stops = db_1.mockDb.route_stops || [];
        // Map routeId -> ordered array of stop IDs
        const routeStopsMap = new Map();
        for (const rs of db_1.mockDb.route_stops) {
            const rId = rs.route_id;
            if (!routeStopsMap.has(rId)) {
                routeStopsMap.set(rId, []);
            }
            routeStopsMap.get(rId).push({
                stopId: rs.stop_id,
                sequenceNo: rs.sequence_no || rs.sequence || 1
            });
        }
        // Sort stops by sequenceNo for each route
        for (const [rId, stops] of routeStopsMap.entries()) {
            stops.sort((a, b) => a.sequenceNo - b.sequenceNo);
        }
        const sequenceMap = new Map();
        const directPairMap = new Map();
        const routesToRemove = [];
        for (const route of db_1.mockDb.routes) {
            const stops = routeStopsMap.get(route.id) || [];
            const stopIds = stops.map(s => s.stopId);
            // Check Rule 1: Direct 2-Stop Bidirectional Pair Normalization (1 <-> 2)
            if (stopIds.length === 2) {
                const pairKey = generateDirectPairKey(stopIds[0], stopIds[1]);
                if (directPairMap.has(pairKey)) {
                    const keptRoute = directPairMap.get(pairKey);
                    if (keptRoute.id !== route.id) {
                        const existingStops = routeStopsMap.get(keptRoute.id) || [];
                        const existingStopIds = existingStops.map(s => s.stopId);
                        if (existingStopIds[0] === stopIds[0] && existingStopIds[1] === stopIds[1]) {
                            routesToRemove.push({
                                route,
                                keptRoute,
                                reason: `Duplicate direct point-to-point corridor segment (${pairKey})`
                            });
                            continue;
                        }
                    }
                }
                else {
                    directPairMap.set(pairKey, route);
                }
            }
            // Check Rule 2: Multi-Stop Sequence Hashing
            if (stopIds.length > 0) {
                const seqHash = generateRouteSequenceHash(stopIds);
                if (sequenceMap.has(seqHash)) {
                    const keptRoute = sequenceMap.get(seqHash);
                    if (keptRoute.id !== route.id) {
                        routesToRemove.push({
                            route,
                            keptRoute,
                            reason: `Identical stop sequence match [${seqHash}] with Master Route ${keptRoute.route_code || keptRoute.id}`
                        });
                    }
                }
                else {
                    sequenceMap.set(seqHash, route);
                }
            }
        }
        if (routesToRemove.length === 0) {
            console.log('[Route Deduplication Engine] ✅ Scan complete. 0 duplicate routes found.');
            adminMonitor_1.adminMonitor.addLog({
                terminalId: 'engine',
                service: 'ROUTE-DEDUP',
                level: 'INFO',
                type: 'SYSTEM',
                message: 'Deduplication scan complete. 0 duplicate routes found.'
            });
            return { removedCount: 0, keptCount: db_1.mockDb.routes.length };
        }
        // Execute Pruning
        const removeIds = new Set(routesToRemove.map(r => r.route.id));
        for (const item of routesToRemove) {
            const logEntry = {
                id: db_1.mockDb.removed_routes_history.length + 1,
                removed_route_id: item.route.id,
                removed_route_code: item.route.route_code || `R_${item.route.id}`,
                removed_route_name: item.route.route_name || 'Unnamed Route',
                kept_canonical_route_id: item.keptRoute.id,
                kept_canonical_route_code: item.keptRoute.route_code || `R_${item.keptRoute.id}`,
                reason: item.reason,
                removed_at: new Date().toISOString()
            };
            db_1.mockDb.removed_routes_history.push(logEntry);
            adminMonitor_1.adminMonitor.addLog({
                terminalId: 'engine',
                service: 'ROUTE-DEDUP',
                level: 'WARN',
                type: 'SYSTEM',
                message: `Pruned Duplicate Route ${logEntry.removed_route_code} (ID: ${logEntry.removed_route_id}) ➔ Kept Master Route ${logEntry.kept_canonical_route_code}. Reason: ${item.reason}`
            });
        }
        // Filter mockDb arrays
        db_1.mockDb.routes = db_1.mockDb.routes.filter((r) => !removeIds.has(r.id));
        db_1.mockDb.route_stops = db_1.mockDb.route_stops.filter((rs) => !removeIds.has(rs.route_id));
        // Persist to disk
        (0, db_1.persistMockDb)();
        console.log(`[Route Deduplication Engine] ✂️ Pruned ${routesToRemove.length} duplicate routes. Kept ${db_1.mockDb.routes.length} canonical master routes.`);
        adminMonitor_1.adminMonitor.addLog({
            terminalId: 'engine',
            service: 'ROUTE-DEDUP',
            level: 'INFO',
            type: 'SYSTEM',
            message: `Deduplication complete: Pruned ${routesToRemove.length} duplicate routes. ${db_1.mockDb.routes.length} master routes active.`
        });
        return { removedCount: routesToRemove.length, keptCount: db_1.mockDb.routes.length };
    }
    catch (err) {
        console.error('[Route Deduplication Engine] Error during deduplication:', err);
        return { removedCount: 0, keptCount: db_1.mockDb?.routes?.length || 0 };
    }
}
