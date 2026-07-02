import { haversineDistanceKm } from '../../../engine/geoUtils';

export class RouteDeviationDetector {
  static isDeviated(
    rawLat: number,
    rawLng: number,
    matchedLat: number,
    matchedLng: number,
    thresholdMeters: number = 150
  ): boolean {
    const distKm = haversineDistanceKm(
      { lat: rawLat, lng: rawLng },
      { lat: matchedLat, lng: matchedLng }
    );
    const distMeters = distKm * 1000;

    return distMeters > thresholdMeters;
  }
}
