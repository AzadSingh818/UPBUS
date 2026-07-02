import { RouteProgressRepository } from '../repository/RouteProgressRepository';

export class RouteProgressService {
  static async getProgress(busId: number) {
    const progress = await RouteProgressRepository.getLastProgress(busId);
    if (!progress) return null;

    const trip = await RouteProgressRepository.getTripForBus(busId);
    if (!trip) return null;

    const stops = await RouteProgressRepository.getRouteStops(trip.route_id);

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
