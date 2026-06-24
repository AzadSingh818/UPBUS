/**
 * villageFilter.ts
 * Pure distance-filtering logic: given a list of candidate villages and a
 * route polyline, return only those within maxDistanceKm.
 *
 * Deliberately isolated from ETA / live-distance logic (see eta.ts).
 */

import { distanceToPolylineKm, Coordinate } from '../engine/geoUtils';
import type { OverpassVillage } from './overpass';

export const DEFAULT_MAX_DISTANCE_KM = 3;

export interface FilteredVillage {
  name: string;
  latitude: number;
  longitude: number;
  distanceToRouteKm: number; // informational
}

/**
 * Filter villages to those within maxDistanceKm of the given polyline.
 *
 * @param villages  Candidate villages (from Overpass cache)
 * @param polyline  Ordered route coordinates (stops + optional waypoints)
 * @param maxDistanceKm  Maximum perpendicular distance to include (default: DEFAULT_MAX_DISTANCE_KM)
 */
export function filterVillagesByDistance(
  villages: OverpassVillage[],
  polyline: Coordinate[],
  maxDistanceKm: number = DEFAULT_MAX_DISTANCE_KM
): FilteredVillage[] {
  if (polyline.length < 2) return [];

  const result: FilteredVillage[] = [];
  for (const v of villages) {
    const p: Coordinate = { lat: v.latitude, lng: v.longitude };
    const dist = distanceToPolylineKm(p, polyline);
    if (dist <= maxDistanceKm) {
      result.push({
        name: v.name,
        latitude: v.latitude,
        longitude: v.longitude,
        distanceToRouteKm: Number(dist.toFixed(3)),
      });
    }
  }

  // Sort by distance ascending so nearest villages come first
  return result.sort((a, b) => a.distanceToRouteKm - b.distanceToRouteKm);
}
