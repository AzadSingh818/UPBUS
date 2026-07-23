"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteProgressService = void 0;
const RouteProgressRepository_1 = require("../repository/RouteProgressRepository");
class RouteProgressService {
    static async getProgress(busId) {
        const progress = await RouteProgressRepository_1.RouteProgressRepository.getLastProgress(busId);
        if (!progress)
            return null;
        const trip = await RouteProgressRepository_1.RouteProgressRepository.getTripForBus(busId);
        if (!trip)
            return null;
        const stops = await RouteProgressRepository_1.RouteProgressRepository.getRouteStops(trip.route_id);
        const completed = stops
            .filter((s, idx) => idx <= progress.completed_stop_index)
            .map(s => s.stop_name);
        const remaining = stops
            .filter((s, idx) => idx > progress.completed_stop_index)
            .map(s => s.stop_name);
        return {
            coveredDistance: progress.covered_distance,
            routeDistance: stops.length > 0 ? stops[stops.length - 1].distance_from_start : 0,
            currentState: progress.state,
            currentSegment: {
                from: progress.current_segment_from,
                to: progress.current_segment_to
            },
            completedStops: completed,
            remainingStops: remaining,
            // API Contract mapping
            completed,
            current: {
                type: progress.state === 'AT_STOP' ? 'AT_STOP' : 'BETWEEN_STOPS',
                from: progress.current_segment_from,
                to: progress.current_segment_to,
                stopName: progress.state === 'AT_STOP' ? progress.current_stop : null
            },
            remaining
        };
    }
}
exports.RouteProgressService = RouteProgressService;
