"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompletedStopEngine = void 0;
class CompletedStopEngine {
    static getCompletedStops(stops) {
        const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
        return sorted
            .filter(s => s.state === 'COMPLETED')
            .map(s => s.stopName);
    }
    static getLastCompletedStopIndex(stops) {
        const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
        let lastIdx = -1;
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].state === 'COMPLETED') {
                lastIdx = i;
            }
        }
        return lastIdx;
    }
}
exports.CompletedStopEngine = CompletedStopEngine;
