import { haversineDistanceKm } from '../../../engine/geoUtils';
import { GPSPacket } from './GPSValidator';

const lastValidCache = new Map<number, { latitude: number; longitude: number; timestamp: number }>();

export class NoiseFilter {
  static filter(packet: GPSPacket): boolean {
    const { busId, latitude, longitude, speed, timestamp } = packet;
    const currentMs = new Date(timestamp).getTime();

    const last = lastValidCache.get(busId);
    if (!last) {
      // First packet, accept
      lastValidCache.set(busId, { latitude, longitude, timestamp: currentMs });
      return true;
    }

    const elapsedSeconds = (currentMs - last.timestamp) / 1000;
    if (elapsedSeconds <= 0) {
      return false;
    }

    // Calculate actual distance in meters
    const distanceKm = haversineDistanceKm(
      { lat: last.latitude, lng: last.longitude },
      { lat: latitude, lng: longitude }
    );
    const distanceMeters = distanceKm * 1000;

    // speed is in km/h. Convert to m/s.
    // If speed is very low or 0, assume a minimum speed of 40 km/h for the allowed threshold
    // to handle GPS drift and starting acceleration.
    const referenceSpeedKmph = Math.max(speed, 40);
    const speedMps = referenceSpeedKmph / 3.6;

    // Add a 50 meter buffer for GPS accuracy drift
    const maxAllowedMeters = speedMps * elapsedSeconds + 50;

    if (distanceMeters > maxAllowedMeters) {
      console.warn(`[NoiseFilter] Rejected jump for bus ${busId}: jumped ${Math.round(distanceMeters)}m in ${elapsedSeconds.toFixed(1)}s (max allowed ${Math.round(maxAllowedMeters)}m)`);
      return false;
    }

    // Update last valid cache
    lastValidCache.set(busId, { latitude, longitude, timestamp: currentMs });
    return true;
  }

  static clearCache() {
    lastValidCache.clear();
  }
}
