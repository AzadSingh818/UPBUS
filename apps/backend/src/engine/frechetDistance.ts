/**
 * Discrete Fréchet Distance Algorithm
 * Used for merging and deduplicating route segments.
 * 
 * If two paths (sequences of coordinates) run parallel to each other within
 * a certain threshold (e.g. 200m), they are considered mathematically identical
 * even if their coordinate counts differ.
 */

export interface Coordinate {
  lat: number;
  lng: number;
}

/**
 * Haversine distance between two coordinates in meters.
 */
function haversineDistanceMeters(a: Coordinate, b: Coordinate): number {
  const R = 6371e3; // Earth radius in meters
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  
  const aVal = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

/**
 * Calculates the Discrete Fréchet Distance between two polygonal curves (paths).
 * @param P Path 1 (Array of coordinates)
 * @param Q Path 2 (Array of coordinates)
 * @returns The Fréchet distance in meters
 */
export function discreteFrechetDistance(P: Coordinate[], Q: Coordinate[]): number {
  const pLen = P.length;
  const qLen = Q.length;
  
  if (pLen === 0 || qLen === 0) return Infinity;

  // Initialize a 2D array with -1
  const ca: number[][] = Array.from({ length: pLen }, () => Array(qLen).fill(-1));

  function c(i: number, j: number): number {
    if (ca[i][j] > -1) {
      return ca[i][j];
    }
    
    const dist = haversineDistanceMeters(P[i], Q[j]);
    
    if (i === 0 && j === 0) {
      ca[i][j] = dist;
    } else if (i > 0 && j === 0) {
      ca[i][j] = Math.max(c(i - 1, 0), dist);
    } else if (i === 0 && j > 0) {
      ca[i][j] = Math.max(c(0, j - 1), dist);
    } else if (i > 0 && j > 0) {
      ca[i][j] = Math.max(
        Math.min(
          c(i - 1, j),
          c(i - 1, j - 1),
          c(i, j - 1)
        ),
        dist
      );
    }
    
    return ca[i][j];
  }
  
  return c(pLen - 1, qLen - 1);
}

/**
 * Compares two segments and determines if they are duplicates.
 * @param segmentA First segment coordinates
 * @param segmentB Second segment coordinates
 * @param thresholdMeters Threshold in meters to consider them parallel/duplicates (e.g. 200m)
 */
export function areSegmentsDuplicates(segmentA: Coordinate[], segmentB: Coordinate[], thresholdMeters: number = 200): boolean {
  const distance = discreteFrechetDistance(segmentA, segmentB);
  return distance <= thresholdMeters;
}
