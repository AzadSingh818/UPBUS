"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SegmentDetector = void 0;
class SegmentDetector {
    static detect(coveredDistance, stops) {
        if (stops.length === 0) {
            return {
                fromStopId: 0,
                fromStopName: 'Unknown',
                toStopId: 0,
                toStopName: 'Unknown'
            };
        }
        if (stops.length < 2) {
            return {
                fromStopId: stops[0].id,
                fromStopName: stops[0].stop_name,
                toStopId: stops[0].id,
                toStopName: stops[0].stop_name
            };
        }
        // Sort stops by sequence
        const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);
        // If before first stop
        if (coveredDistance <= sortedStops[0].distance_from_start) {
            return {
                fromStopId: sortedStops[0].id,
                fromStopName: sortedStops[0].stop_name,
                toStopId: sortedStops[1].id,
                toStopName: sortedStops[1].stop_name
            };
        }
        // Find the segment containing coveredDistance
        for (let i = 0; i < sortedStops.length - 1; i++) {
            const fromStop = sortedStops[i];
            const toStop = sortedStops[i + 1];
            if (coveredDistance >= fromStop.distance_from_start && coveredDistance <= toStop.distance_from_start) {
                return {
                    fromStopId: fromStop.id,
                    fromStopName: fromStop.stop_name,
                    toStopId: toStop.id,
                    toStopName: toStop.stop_name
                };
            }
        }
        // If beyond last stop
        return {
            fromStopId: sortedStops[sortedStops.length - 2].id,
            fromStopName: sortedStops[sortedStops.length - 2].stop_name,
            toStopId: sortedStops[sortedStops.length - 1].id,
            toStopName: sortedStops[sortedStops.length - 1].stop_name
        };
    }
}
exports.SegmentDetector = SegmentDetector;
