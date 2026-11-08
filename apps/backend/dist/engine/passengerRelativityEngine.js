"use strict";
/**
 * Phase 5: Dynamic Passenger Search & Relativity UX Engine
 *
 * Rules:
 *   1. Evaluates all active in-transit trips against passenger search query (Origin -> Destination).
 *   2. Stop Relativity:
 *      - Bus is approaching boarding stop -> Include in search with ETA.
 *      - Bus already passed boarding stop -> Exclude from search or mark "Aage nikal chuki hai".
 *   3. Divergence Branch Filtering:
 *      - If passenger is boarding at Ambehta Peer (which is on Branch B), and bus has diverged to Branch A (Kheda Afghan):
 *        -> DO NOT show bus as available for Ambehta Peer passenger!
 *      - If divergence not yet resolved (Approaching Phandpuri):
 *        -> Show bus with clear badge: "Route confirm nahi hua (Near Phandpuri)"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchBusesForPassenger = searchBusesForPassenger;
function searchBusesForPassenger(boardingStopName, destinationStopName, activeBuses, routeStops) {
    const boardingIndex = routeStops.findIndex(s => s.stopName.toLowerCase().includes(boardingStopName.toLowerCase()));
    const destIndex = routeStops.findIndex(s => s.stopName.toLowerCase().includes(destinationStopName.toLowerCase()));
    if (boardingIndex === -1 || destIndex === -1 || boardingIndex >= destIndex) {
        return [];
    }
    const boardingStop = routeStops[boardingIndex];
    const candidates = [];
    for (const bus of activeBuses) {
        // Check if bus is in active transit
        if (bus.lifecycle.state === 'IDLE_AT_DEPOT' || bus.lifecycle.state === 'COMPLETED') {
            continue;
        }
        // Branch match check
        const isStopOnBranch = Boolean(boardingStop.branchName);
        let divergenceStatus = 'CONFIRMED_ON_CORRIDOR';
        if (isStopOnBranch) {
            if (bus.divergenceState.status === 'BRANCH_CONFIRMED') {
                if (bus.divergenceState.confirmedBranchName === boardingStop.branchName) {
                    divergenceStatus = 'CONFIRMED_ON_CORRIDOR';
                }
                else {
                    // Bus took the OTHER fork! Exclude for this passenger!
                    divergenceStatus = 'DIVERGED_AWAY';
                }
            }
            else if (bus.divergenceState.status === 'APPROACHING_NODE' || bus.divergenceState.status === 'EVALUATING_BRANCH') {
                divergenceStatus = 'PENDING_AT_NODE';
            }
        }
        if (divergenceStatus === 'DIVERGED_AWAY') {
            // Do not mislead the waiting passenger!
            continue;
        }
        // Distance & Relativity to Boarding Stop
        const distToStopKm = Math.hypot((bus.currentLat - boardingStop.lat) * 111.0, (bus.currentLng - boardingStop.lng) * 111.0 * Math.cos(boardingStop.lat * Math.PI / 180));
        // Speed-based ETA estimation
        const effectiveSpeed = Math.max(25, bus.currentSpeed);
        const etaMinutes = Math.max(1, Math.round((distToStopKm / effectiveSpeed) * 60));
        let badgeNotice = bus.divergenceState.badgeText;
        if (divergenceStatus === 'PENDING_AT_NODE') {
            badgeNotice = `${bus.divergenceState.badgeText} - Route confirm nahi hua`;
        }
        candidates.push({
            regNo: bus.lifecycle.regNo,
            tripId: bus.lifecycle.tripId,
            routeName: bus.divergenceState.badgeText,
            badgeNotice,
            isApproachingBoardingStop: true,
            distanceToBoardingKm: Number(distToStopKm.toFixed(1)),
            etaMinutes,
            isConfirmedForStop: divergenceStatus === 'CONFIRMED_ON_CORRIDOR',
            divergenceStatus
        });
    }
    // Sort by nearest ETA
    candidates.sort((a, b) => a.etaMinutes - b.etaMinutes);
    return candidates;
}
