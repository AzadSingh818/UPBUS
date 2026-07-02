import { StopState } from './StopStateMachine';

export interface RemainingStopInput {
  stopId: number;
  stopName: string;
  distanceFromStart: number;
  sequence: number;
  state: StopState;
}

export class RemainingStopEngine {
  static getRemainingStops(coveredDistance: number, stops: RemainingStopInput[]): string[] {
    const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
    return sorted
      .filter(s => s.distanceFromStart > coveredDistance && s.state !== 'COMPLETED')
      .map(s => s.stopName);
  }
}
