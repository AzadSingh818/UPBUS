export interface MapMatchResult {
  matchedLatitude: number;
  matchedLongitude: number;
  coveredDistance: number; // in meters
}

export class MapMatcher {
  static match(
    lat: number,
    lng: number,
    stops: { latitude: number; longitude: number; distance_from_start: number }[]
  ): MapMatchResult {
    if (stops.length === 0) {
      return {
        matchedLatitude: lat,
        matchedLongitude: lng,
        coveredDistance: 0
      };
    }

    if (stops.length < 2) {
      return {
        matchedLatitude: stops[0].latitude,
        matchedLongitude: stops[0].longitude,
        coveredDistance: stops[0].distance_from_start
      };
    }

    let bestDist = Infinity;
    let bestLat = lat;
    let bestLng = lng;
    let bestCoveredDistance = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];

      const dx = b.longitude - a.longitude;
      const dy = b.latitude - a.latitude;
      const lenSq = dx * dx + dy * dy;

      let t = 0;
      if (lenSq !== 0) {
        t = ((lng - a.longitude) * dx + (lat - a.latitude) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t)); // clamp to segment
      }

      const projLat = a.latitude + t * dy;
      const projLng = a.longitude + t * dx;

      // Haversine distance from raw GPS to projected point on segment
      const R = 6371;
      const dLat = (projLat - lat) * Math.PI / 180;
      const dLon = (projLng - lng) * Math.PI / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(projLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const distKm = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
      const distMeters = distKm * 1000;

      if (distMeters < bestDist) {
        bestDist = distMeters;
        bestLat = projLat;
        bestLng = projLng;

        // Covered distance along route in meters:
        // distance_from_start(a) + t * (distance_from_start(b) - distance_from_start(a))
        const segLength = b.distance_from_start - a.distance_from_start;
        bestCoveredDistance = Math.round(a.distance_from_start + t * segLength);
      }
    }

    return {
      matchedLatitude: bestLat,
      matchedLongitude: bestLng,
      coveredDistance: bestCoveredDistance
    };
  }
}
