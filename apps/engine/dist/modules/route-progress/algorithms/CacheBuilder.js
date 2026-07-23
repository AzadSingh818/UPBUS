"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheBuilder = void 0;
const RouteProgressRepository_1 = require("../repository/RouteProgressRepository");
class CacheBuilder {
    static async buildAndSave(busId, coveredDistance, routeDistance, currentState, currentSegment, completedStops, remainingStops, completedStopIndex, currentStop) {
        const result = {
            coveredDistance,
            routeDistance,
            currentState,
            currentSegment,
            completedStops,
            remainingStops,
            currentStop
        };
        // Save to database cache
        await RouteProgressRepository_1.RouteProgressRepository.updateProgressCache({
            bus_id: busId,
            covered_distance: coveredDistance,
            current_segment_from: currentSegment.from,
            current_segment_to: currentSegment.to,
            current_stop: currentStop,
            state: currentState,
            completed_stop_index: completedStopIndex
        });
        return result;
    }
}
exports.CacheBuilder = CacheBuilder;
