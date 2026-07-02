import { RouteProgressRepository } from '../repository/RouteProgressRepository';

export interface ProgressResult {
  coveredDistance: number;
  routeDistance: number;
  currentState: string;
  currentSegment: { from: string; to: string };
  completedStops: string[];
  remainingStops: string[];
  currentStop?: string | null;
}

export class CacheBuilder {
  static async buildAndSave(
    busId: number,
    coveredDistance: number,
    routeDistance: number,
    currentState: string,
    currentSegment: { from: string; to: string },
    completedStops: string[],
    remainingStops: string[],
    completedStopIndex: number,
    currentStop: string | null
  ): Promise<ProgressResult> {
    const result: ProgressResult = {
      coveredDistance,
      routeDistance,
      currentState,
      currentSegment,
      completedStops,
      remainingStops,
      currentStop
    };

    // Save to database cache
    await RouteProgressRepository.updateProgressCache({
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
