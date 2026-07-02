"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StopStateMachine = void 0;
class StopStateMachine {
    static evaluate(coveredDistance, stop, currentState, visited) {
        // If already visited, state is permanently COMPLETED
        if (visited || currentState === 'COMPLETED') {
            return {
                stopId: stop.stopId,
                stopName: stop.stopName,
                state: 'COMPLETED',
                shouldLogArrival: false,
                shouldLogDeparture: false
            };
        }
        const distToStop = stop.distanceFromStart - coveredDistance;
        // Transition logic:
        // NOT_REACHED -> APPROACHING
        if (currentState === 'NOT_REACHED') {
            if (distToStop >= 0 && distToStop <= 500) {
                return {
                    stopId: stop.stopId,
                    stopName: stop.stopName,
                    state: 'APPROACHING',
                    shouldLogArrival: false,
                    shouldLogDeparture: false
                };
            }
            return {
                stopId: stop.stopId,
                stopName: stop.stopName,
                state: 'NOT_REACHED',
                shouldLogArrival: false,
                shouldLogDeparture: false
            };
        }
        // APPROACHING -> AT_STOP
        if (currentState === 'APPROACHING') {
            if (distToStop >= 0 && distToStop <= 100) {
                return {
                    stopId: stop.stopId,
                    stopName: stop.stopName,
                    state: 'AT_STOP',
                    shouldLogArrival: true, // Entered 100m radius -> Log Arrival!
                    shouldLogDeparture: false
                };
            }
            if (distToStop > 500) {
                // Fallback to NOT_REACHED
                return {
                    stopId: stop.stopId,
                    stopName: stop.stopName,
                    state: 'NOT_REACHED',
                    shouldLogArrival: false,
                    shouldLogDeparture: false
                };
            }
            return {
                stopId: stop.stopId,
                stopName: stop.stopName,
                state: 'APPROACHING',
                shouldLogArrival: false,
                shouldLogDeparture: false
            };
        }
        // AT_STOP -> DEPARTING
        if (currentState === 'AT_STOP') {
            if (coveredDistance > stop.distanceFromStart) {
                return {
                    stopId: stop.stopId,
                    stopName: stop.stopName,
                    state: 'DEPARTING',
                    shouldLogArrival: false,
                    shouldLogDeparture: false
                };
            }
            if (distToStop > 100) {
                return {
                    stopId: stop.stopId,
                    stopName: stop.stopName,
                    state: 'APPROACHING',
                    shouldLogArrival: false,
                    shouldLogDeparture: false
                };
            }
            return {
                stopId: stop.stopId,
                stopName: stop.stopName,
                state: 'AT_STOP',
                shouldLogArrival: false,
                shouldLogDeparture: false
            };
        }
        // DEPARTING -> COMPLETED
        if (currentState === 'DEPARTING') {
            if (coveredDistance > stop.distanceFromStart + 120) {
                return {
                    stopId: stop.stopId,
                    stopName: stop.stopName,
                    state: 'COMPLETED',
                    shouldLogArrival: false,
                    shouldLogDeparture: true // Crossed 120m -> Log Departure!
                };
            }
            if (coveredDistance <= stop.distanceFromStart) {
                return {
                    stopId: stop.stopId,
                    stopName: stop.stopName,
                    state: 'AT_STOP',
                    shouldLogArrival: false,
                    shouldLogDeparture: false
                };
            }
            return {
                stopId: stop.stopId,
                stopName: stop.stopName,
                state: 'DEPARTING',
                shouldLogArrival: false,
                shouldLogDeparture: false
            };
        }
        return {
            stopId: stop.stopId,
            stopName: stop.stopName,
            state: currentState,
            shouldLogArrival: false,
            shouldLogDeparture: false
        };
    }
}
exports.StopStateMachine = StopStateMachine;
