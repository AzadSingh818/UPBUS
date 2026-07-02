export class DirectionLockEngine {
  static isWrongDirection(
    busHeading: number,
    fromStop: { latitude: number; longitude: number },
    toStop: { latitude: number; longitude: number },
    speedKmph: number
  ): boolean {
    if (speedKmph <= 10) {
      // Too slow or stationary, heading could be noisy/unreliable
      return false;
    }

    // Calculate bearing from fromStop to toStop
    const lat1 = fromStop.latitude * Math.PI / 180;
    const lat2 = toStop.latitude * Math.PI / 180;
    const dLon = (toStop.longitude - fromStop.longitude) * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const segmentBearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    // Calculate difference between segmentBearing and busHeading
    const diff = Math.abs(busHeading - segmentBearing);
    const normalizedDiff = diff > 180 ? 360 - diff : diff;

    // If difference is greater than 120 degrees, it's heading in wrong direction
    return normalizedDiff > 120;
  }
}
