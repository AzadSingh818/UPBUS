"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemainingStopEngine = void 0;
class RemainingStopEngine {
    static getRemainingStops(coveredDistance, stops) {
        const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
        return sorted
            .filter(s => s.distanceFromStart > coveredDistance && s.state !== 'COMPLETED')
            .map(s => s.stopName);
    }
}
exports.RemainingStopEngine = RemainingStopEngine;
