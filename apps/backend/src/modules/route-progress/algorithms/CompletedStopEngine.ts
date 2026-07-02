import { StopState } from './StopStateMachine';

export interface EvaluatedStop {
  stopId: number;
  stopName: string;
  sequence: number;
  state: StopState;
}

export class CompletedStopEngine {
  static getCompletedStops(stops: EvaluatedStop[]): string[] {
    const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
    return sorted
      .filter(s => s.state === 'COMPLETED')
      .map(s => s.stopName);
  }

  static getLastCompletedStopIndex(stops: EvaluatedStop[]): number {
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
