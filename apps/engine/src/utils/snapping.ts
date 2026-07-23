import * as turf from '@turf/turf';
import { mockDb } from '../db';

/**
 * Fetch ordered stop coordinates for a route from the database
 */
export function getRouteStopCoordinates(routeId: number): [number, number][] {
  if (!mockDb || !mockDb.route_stops || !mockDb.stops) {
    return [];
  }
  const rsList = mockDb.route_stops
    .filter((rs: any) => Number(rs.route_id) === Number(routeId))
    .sort((a: any, b: any) => a.sequence_no - b.sequence_no);
  
  return rsList
    .map((rs: any) => {
      const stop = mockDb.stops.find((s: any) => Number(s.id) === Number(rs.stop_id));
      return stop ? [Number(stop.latitude), Number(stop.longitude)] : null;
    })
    .filter((c: any) => c !== null) as [number, number][];
}

/**
 * Snap raw coordinates to the nearest point on the route's path (sequence of stops)
 */
export function snapToRoute(lat: number, lng: number, routeId: number): { latitude: number, longitude: number } {
  try {
    const stopCoords = getRouteStopCoordinates(routeId);
    if (!stopCoords || stopCoords.length < 2) {
      return { latitude: lat, longitude: lng };
    }
    
    // Turf lineString expects coordinates in [Longitude, Latitude] format
    const line = turf.lineString(stopCoords.map(c => [c[1], c[0]]));
    const pt = turf.point([lng, lat]);
    
    const snapped = turf.nearestPointOnLine(line, pt);
    const coords = snapped.geometry.coordinates;
    
    return { latitude: coords[1], longitude: coords[0] };
  } catch (error) {
    // Return original coordinate as safe fallback
    return { latitude: lat, longitude: lng };
  }
}
