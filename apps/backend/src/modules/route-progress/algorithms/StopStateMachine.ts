export type StopState = 'NOT_REACHED' | 'APPROACHING' | 'AT_STOP' | 'DEPARTING' | 'COMPLETED';

export interface StopStateMachineInput {
  stopId: number;
  stopName: string;
  distanceFromStart: number; // in meters
  sequence: number;
}

export interface StopStateResult {
  stopId: number;
  stopName: string;
  state: StopState;
  shouldLogArrival: boolean;
  shouldLogDeparture: boolean;
}

export class StopStateMachine {
  static evaluate(
    coveredDistance: number,
    stop: StopStateMachineInput,
    currentState: StopState,
    visited: boolean
  ): StopStateResult {
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
