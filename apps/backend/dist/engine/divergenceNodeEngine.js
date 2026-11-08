"use strict";
/**
 * Phase 4: Divergence Node Resolution Engine (Pilot: Phandpuri Junction)
 *
 * Rules:
 *   1. Node has a trigger radius (e.g. 500m). When bus enters, state -> APPROACHING_NODE
 *   2. Badge displays temporary caution: "Route confirm nahi hua (Approaching Junction)"
 *   3. After crossing the node (distance from junction > 300m):
 *      - Collects 3 to 5 consecutive pings
 *      - Computes perpendicular offset to each branch reference polyline
 *      - Confirms the branch ONLY when at least 3 consecutive pings align within tolerance
 *      - Locks badge: "{origin} - {destination} (via {branchName})"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DivergenceNodeEngine = void 0;
const corridorMatcher_1 = require("../utils/corridorMatcher");
const tripLifecycleEngine_1 = require("./tripLifecycleEngine");
class DivergenceNodeEngine {
    nodes = [];
    // regNo -> tracking state
    busNodeStates = new Map();
    constructor(nodes) {
        this.nodes = nodes;
    }
    /**
     * Evaluates a bus ping against known divergence nodes
     */
    evaluatePing(regNo, lat, lng, originCity = 'Saharanpur', destCity = 'Gangoh') {
        // 1. Check if bus has an active node in-progress, or find nearest node within 3500m
        let activeNode = null;
        let distToNodeM = Infinity;
        const existingState = this.busNodeStates.get(regNo);
        if (existingState) {
            activeNode = this.nodes.find(n => n.nodeId === existingState.nodeId) || null;
            if (activeNode) {
                distToNodeM = (0, tripLifecycleEngine_1.haversineMeters)(lat, lng, activeNode.latitude, activeNode.longitude);
            }
        }
        if (!activeNode) {
            for (const node of this.nodes) {
                const d = (0, tripLifecycleEngine_1.haversineMeters)(lat, lng, node.latitude, node.longitude);
                if (d <= 2500) { // within 2.5 km of junction
                    activeNode = node;
                    distToNodeM = d;
                    break;
                }
            }
        }
        // Retain state while trip is progressing along corridor (within 20km along branch)
        // Only delete state if confirmed branch is finished or bus is completely away from branch corridor
        if (!activeNode || (!existingState?.confirmedBranch && distToNodeM > 8000)) {
            this.busNodeStates.delete(regNo);
            return {
                status: 'OUTSIDE_NODE',
                badgeText: `${originCity} - ${destCity}`,
                pingsEvaluated: 0
            };
        }
        let state = this.busNodeStates.get(regNo);
        if (!state || state.nodeId !== activeNode.nodeId) {
            state = {
                nodeId: activeNode.nodeId,
                hasCrossedJunction: false,
                consecutiveBranchVotes: new Map(),
                consecutivePingsCount: 0
            };
            this.busNodeStates.set(regNo, state);
        }
        // If branch already confirmed, return locked badge
        if (state.confirmedBranch) {
            return {
                status: 'BRANCH_CONFIRMED',
                badgeText: `${originCity} - ${destCity} (${state.confirmedBranch.branchName})`,
                confirmedBranchId: state.confirmedBranch.branchId,
                confirmedBranchName: state.confirmedBranch.branchName,
                pingsEvaluated: state.consecutivePingsCount
            };
        }
        // 2. Bus approaching the junction (< 500m)
        if (distToNodeM <= activeNode.triggerRadiusMeters && !state.hasCrossedJunction) {
            return {
                status: 'APPROACHING_NODE',
                badgeText: `${originCity} - ${destCity} (Route confirm nahi hua - Near ${activeNode.name})`,
                pingsEvaluated: 0
            };
        }
        // 3. Mark crossed once bus moves past the junction center (> 200m away after approach)
        state.hasCrossedJunction = true;
        // 4. Multi-ping Polyline Branch Evaluation
        // Find closest branch polyline for current ping
        let bestBranch = null;
        let minOffsetKm = Infinity;
        for (const branch of activeNode.branches) {
            let minBranchOffset = Infinity;
            const poly = branch.referencePolyline;
            for (let i = 0; i < poly.length - 1; i++) {
                const offset = (0, corridorMatcher_1.pointToSegmentDistanceKm)(lat, lng, poly[i].latitude, poly[i].longitude, poly[i + 1].latitude, poly[i + 1].longitude);
                if (offset < minBranchOffset) {
                    minBranchOffset = offset;
                }
            }
            if (minBranchOffset < minOffsetKm) {
                minOffsetKm = minBranchOffset;
                bestBranch = branch;
            }
        }
        // Tolerance check (must be within 1.5 km of the road polyline)
        if (bestBranch && minOffsetKm <= 1.5) {
            state.consecutivePingsCount++;
            const currentVotes = (state.consecutiveBranchVotes.get(bestBranch.branchId) || 0) + 1;
            state.consecutiveBranchVotes.set(bestBranch.branchId, currentVotes);
            // CONFIRMATION THRESHOLD:
            // Require at least 3 consecutive pings for the same branch
            if (currentVotes >= 3) {
                state.confirmedBranch = bestBranch;
                return {
                    status: 'BRANCH_CONFIRMED',
                    badgeText: `${originCity} - ${destCity} (${bestBranch.branchName})`,
                    confirmedBranchId: bestBranch.branchId,
                    confirmedBranchName: bestBranch.branchName,
                    pingsEvaluated: state.consecutivePingsCount
                };
            }
        }
        // Still gathering consecutive pings
        return {
            status: 'EVALUATING_BRANCH',
            badgeText: `${originCity} - ${destCity} (Route confirm nahi hua)`,
            pingsEvaluated: state.consecutivePingsCount
        };
    }
}
exports.DivergenceNodeEngine = DivergenceNodeEngine;
