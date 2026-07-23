"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.divergenceCache = void 0;
exports.initDivergenceCache = initDivergenceCache;
exports.matchBranchForBus = matchBranchForBus;
// divergenceBinding.ts
const divergenceNode_1 = require("./divergenceNode");
const geoUtils_1 = require("./geoUtils");
const divergenceConfig_1 = require("./divergenceConfig");
// Cache loaded nodes for fast lookup
exports.divergenceCache = [];
/** Initialize divergence node cache – call once at server start */
function initDivergenceCache() {
    exports.divergenceCache = (0, divergenceNode_1.loadDivergenceNodes)();
    console.log(`[Divergence] Loaded ${exports.divergenceCache.length} divergence nodes`);
}
/**
 * Determine which branch a bus matches at a given divergence node.
 * Returns the matching DivergenceBranch or null if none within threshold.
 */
function matchBranchForBus(busLat, busLng, nodeId) {
    const node = exports.divergenceCache.find(n => n.id === nodeId);
    if (!node)
        return null;
    for (const branch of node.branches) {
        const dist = (0, geoUtils_1.distanceToPolylineKm)({ lat: busLat, lng: busLng }, branch.polyline);
        if (dist <= divergenceConfig_1.DIV_DISTANCE_THRESHOLD_KM) {
            return branch;
        }
    }
    return null;
}
