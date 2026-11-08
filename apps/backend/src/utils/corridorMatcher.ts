/**
 * Universal Spatial Corridor Matcher
 * Finds active buses operating physically along a route's corridor
 * (regardless of whether Margdarshi provided route text or left it blank).
 */

export interface Point2D {
  latitude: number;
  longitude: number;
  name?: string;
}

/**
 * Calculates perpendicular distance from a GPS point (lat, lng)
 * to a road segment line (lat1, lng1) -> (lat2, lng2) in kilometers.
 */
export function pointToSegmentDistanceKm(
  plat: number,
  plng: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dx = (lat2 - lat1) * 111.0;
  const dy = (lng2 - lng1) * 111.0 * Math.cos((lat1 * Math.PI) / 180);

  if (dx === 0 && dy === 0) {
    return Math.hypot((plat - lat1) * 111.0, (plng - lng1) * 111.0 * Math.cos((lat1 * Math.PI) / 180));
  }

  const pdx = (plat - lat1) * 111.0;
  const pdy = (plng - plng) * 111.0 * Math.cos((lat1 * Math.PI) / 180);

  const t = Math.max(0, Math.min(1, (pdx * dx + pdy * dy) / (dx * dx + dy * dy)));

  const nearestLat = lat1 + t * (lat2 - lat1);
  const nearestLng = lng1 + t * (lng2 - lng1);

  return Math.hypot(
    (plat - nearestLat) * 111.0,
    (plng - nearestLng) * 111.0 * Math.cos((plat * Math.PI) / 180)
  );
}

/**
 * Checks whether a bus at (busLat, busLng) is travelling along the corridor
 * of a given sequence of route stops.
 * Returns { isMatch: boolean; minOffsetKm: number; nearestStopIndex: number; distanceToBoardingKm: number }
 */
export function matchBusToCorridor(
  busLat: number,
  busLng: number,
  routeStops: Point2D[],
  maxOffsetKm = 3.2
): { isMatch: boolean; minOffsetKm: number; nearestStopIndex: number; distanceToBoardingKm: number } {
  if (!routeStops || routeStops.length < 2) {
    return { isMatch: false, minOffsetKm: 999, nearestStopIndex: -1, distanceToBoardingKm: 999 };
  }

  let minOffsetKm = Infinity;
  let nearestSegIdx = 0;

  for (let i = 0; i < routeStops.length - 1; i++) {
    const s1 = routeStops[i];
    const s2 = routeStops[i + 1];
    if (s1.latitude == null || s1.longitude == null || s2.latitude == null || s2.longitude == null) continue;

    const offset = pointToSegmentDistanceKm(
      busLat,
      busLng,
      Number(s1.latitude),
      Number(s1.longitude),
      Number(s2.latitude),
      Number(s2.longitude)
    );

    if (offset < minOffsetKm) {
      minOffsetKm = offset;
      nearestSegIdx = i;
    }
  }

  if (minOffsetKm > maxOffsetKm) {
    return { isMatch: false, minOffsetKm, nearestStopIndex: -1, distanceToBoardingKm: 999 };
  }

  // Calculate distance from first stop (boarding) to bus position along the corridor
  let distToBusKm = 0;
  for (let i = 0; i < nearestSegIdx; i++) {
    const s1 = routeStops[i];
    const s2 = routeStops[i + 1];
    distToBusKm += Math.hypot(
      (Number(s2.latitude) - Number(s1.latitude)) * 111.0,
      (Number(s2.longitude) - Number(s1.longitude)) * 111.0 * Math.cos((Number(s1.latitude) * Math.PI) / 180)
    );
  }

  const sNear = routeStops[nearestSegIdx];
  distToBusKm += Math.hypot(
    (busLat - Number(sNear.latitude)) * 111.0,
    (busLng - Number(sNear.longitude)) * 111.0 * Math.cos((busLat * Math.PI) / 180)
  );

  return {
    isMatch: true,
    minOffsetKm: Math.round(minOffsetKm * 100) / 100,
    nearestStopIndex: nearestSegIdx,
    distanceToBoardingKm: Math.round(distToBusKm * 10) / 10
  };
}
