import { adminMonitor } from '../../../services/adminMonitor';

export interface GPSPacket {
  busId: number;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  accuracy: number;
  timestamp: string | Date;
}

const lastProcessedCache = new Map<number, { latitude: number; longitude: number; timestamp: number }>();

export class GPSValidator {
  static validate(packet: GPSPacket): boolean {
    const { busId, latitude, longitude, accuracy, timestamp } = packet;

    // 1. Valid Lat/Lng check
    if (typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90) {
      console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid latitude ${latitude}`);
      adminMonitor.addLog({
        type: 'VALIDATION',
        busId,
        status: 'rejected',
        message: `Rejected packet for bus ${busId}: Invalid latitude ${latitude}`
      });
      return false;
    }
    if (typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180) {
      console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid longitude ${longitude}`);
      adminMonitor.addLog({
        type: 'VALIDATION',
        busId,
        status: 'rejected',
        message: `Rejected packet for bus ${busId}: Invalid longitude ${longitude}`
      });
      return false;
    }

    // 2. Accuracy check (accuracy > 50 meters => reject)
    if (typeof accuracy === 'number' && accuracy > 50) {
      console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Poor accuracy ${accuracy}m`);
      adminMonitor.addLog({
        type: 'VALIDATION',
        busId,
        status: 'rejected',
        message: `Rejected packet for bus ${busId}: Poor accuracy ${accuracy}m`
      });
      return false;
    }

    // 3. Timestamp check
    const currentMs = new Date(timestamp).getTime();
    if (isNaN(currentMs)) {
      console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid timestamp`);
      adminMonitor.addLog({
        type: 'VALIDATION',
        busId,
        status: 'rejected',
        message: `Rejected packet for bus ${busId}: Invalid timestamp`
      });
      return false;
    }

    const last = lastProcessedCache.get(busId);
    if (last) {
      if (currentMs < last.timestamp) {
        console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Out-of-order timestamp`);
        adminMonitor.addLog({
          type: 'VALIDATION',
          busId,
          status: 'rejected',
          message: `Rejected packet for bus ${busId}: Out-of-order timestamp`
        });
        return false;
      }
      
      // 4. Duplicate packet check
      if (latitude === last.latitude && longitude === last.longitude && currentMs === last.timestamp) {
        console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Duplicate packet`);
        adminMonitor.addLog({
          type: 'VALIDATION',
          busId,
          status: 'duplicate',
          message: `Rejected packet for bus ${busId}: Duplicate packet at (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
        });
        return false;
      }
    }

    // Update cache on validation success
    lastProcessedCache.set(busId, { latitude, longitude, timestamp: currentMs });
    
    adminMonitor.addLog({
      type: 'VALIDATION',
      busId,
      status: 'accepted',
      message: `Accepted GPS packet for bus ${busId} at (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`
    });
    
    return true;
  }

  static clearCache() {
    lastProcessedCache.clear();
  }
}
