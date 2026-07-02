"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressSocketHandler = void 0;
const ws_1 = require("ws");
const subscriptions = new Set();
class ProgressSocketHandler {
    static register(ws, busId) {
        const sub = { ws, busId };
        subscriptions.add(sub);
        ws.on('close', () => {
            subscriptions.delete(sub);
        });
        console.log(`[ProgressSocketHandler] Client subscribed to progress updates for bus: ${busId}`);
    }
    static broadcast(busId, payload) {
        const message = JSON.stringify({
            event: 'BUS_PROGRESS_UPDATED',
            payload: {
                busId,
                completed: payload.completedStops || [],
                current: {
                    type: payload.currentState === 'AT_STOP' ? 'AT_STOP' : 'BETWEEN_STOPS',
                    from: payload.currentSegment?.from || '',
                    to: payload.currentSegment?.to || '',
                    ...(payload.currentState === 'AT_STOP' ? { stopName: payload.currentSegment?.from } : {})
                },
                remaining: payload.remainingStops || [],
                coveredDistance: payload.coveredDistance,
                routeDistance: payload.routeDistance,
                currentState: payload.currentState
            }
        });
        let count = 0;
        for (const sub of subscriptions) {
            if (sub.busId === busId && sub.ws.readyState === ws_1.WebSocket.OPEN) {
                sub.ws.send(message);
                count++;
            }
        }
        if (count > 0) {
            console.log(`[ProgressSocketHandler] Broadcasted BUS_PROGRESS_UPDATED to ${count} clients for bus ${busId}`);
        }
    }
    static clear() {
        subscriptions.clear();
    }
}
exports.ProgressSocketHandler = ProgressSocketHandler;
