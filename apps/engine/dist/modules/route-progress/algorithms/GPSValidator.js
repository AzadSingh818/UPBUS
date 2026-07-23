"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GPSValidator = void 0;
const adminMonitor_1 = require("../../../services/adminMonitor");
const lastProcessedCache = new Map();
class GPSValidator {
    static validate(packet) {
        const { busId, latitude, longitude, accuracy, timestamp } = packet;
        // 1. Valid Lat/Lng check
        if (typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90) {
            console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid latitude ${latitude}`);
            adminMonitor_1.adminMonitor.addLog({
                type: 'VALIDATION',
                busId,
                status: 'rejected',
                message: `Rejected packet for bus ${busId}: Invalid latitude ${latitude}`
            });
            return false;
        }
        if (typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180) {
            console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid longitude ${longitude}`);
            adminMonitor_1.adminMonitor.addLog({
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
            adminMonitor_1.adminMonitor.addLog({
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
            adminMonitor_1.adminMonitor.addLog({
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
                adminMonitor_1.adminMonitor.addLog({
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
                adminMonitor_1.adminMonitor.addLog({
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
        adminMonitor_1.adminMonitor.addLog({
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
exports.GPSValidator = GPSValidator;
