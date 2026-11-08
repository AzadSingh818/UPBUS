"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GPSValidator = void 0;
const adminMonitor_1 = require("../../../services/adminMonitor");
const lastProcessedCache = new Map();
// Process Noise (Q) - How much we expect the bus to move randomly
const Q = 0.00001;
// Measurement Noise (R) - How much we trust the GPS (scaled by accuracy later)
const R_BASE = 0.0001;
class GPSValidator {
    /**
     * Validates and applies a Kalman Filter to smooth out raw GPS data.
     * Returns the smoothed packet, or null if the packet is rejected.
     */
    static validateAndSmooth(packet) {
        const { busId, latitude, longitude, accuracy, timestamp } = packet;
        // 1. Valid Lat/Lng check
        if (typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90) {
            console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid latitude ${latitude}`);
            return null;
        }
        if (typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180) {
            console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid longitude ${longitude}`);
            return null;
        }
        // 2. Accuracy check (accuracy > 50 meters => reject)
        if (typeof accuracy === 'number' && accuracy > 50) {
            console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Poor accuracy ${accuracy}m`);
            return null;
        }
        // 3. Timestamp check
        const currentMs = new Date(timestamp).getTime();
        if (isNaN(currentMs)) {
            console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Invalid timestamp`);
            return null;
        }
        const last = lastProcessedCache.get(busId);
        let smoothedLat = latitude;
        let smoothedLng = longitude;
        let newVarLat = 1.0;
        let newVarLng = 1.0;
        if (last) {
            if (currentMs <= last.timestamp) {
                console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Out-of-order or duplicate timestamp`);
                return null;
            }
            // Time elapsed in seconds
            const dt = (currentMs - last.timestamp) / 1000;
            // KALMAN FILTER - PREDICT STEP
            let predLat = last.latitude;
            let predLng = last.longitude;
            let predVarLat = last.varianceLat + Q * dt;
            let predVarLng = last.varianceLng + Q * dt;
            // KALMAN FILTER - UPDATE STEP
            const R = R_BASE * (accuracy ? (accuracy / 10) : 1);
            const kLat = predVarLat / (predVarLat + R);
            const kLng = predVarLng / (predVarLng + R);
            smoothedLat = predLat + kLat * (latitude - predLat);
            smoothedLng = predLng + kLng * (longitude - predLng);
            newVarLat = (1 - kLat) * predVarLat;
            newVarLng = (1 - kLng) * predVarLng;
            // Reject anomalous teleportation (jump > 5km in a few seconds)
            const R_EARTH = 6371e3;
            const dLat = (latitude - predLat) * Math.PI / 180;
            const dLon = (longitude - predLng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(predLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const distJump = R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (distJump > 5000 && dt < 60) {
                console.warn(`[GPSValidator] Rejected packet for bus ${busId}: Teleportation detected (${distJump.toFixed(0)}m in ${dt}s)`);
                return null;
            }
        }
        // Update cache on validation success
        lastProcessedCache.set(busId, {
            latitude: smoothedLat,
            longitude: smoothedLng,
            timestamp: currentMs,
            varianceLat: newVarLat,
            varianceLng: newVarLng
        });
        adminMonitor_1.adminMonitor.addLog({
            type: 'VALIDATION',
            busId,
            status: 'accepted',
            message: `Accepted & Smoothed GPS packet for bus ${busId}`
        });
        return {
            ...packet,
            latitude: smoothedLat,
            longitude: smoothedLng
        };
    }
    // Backwards compatibility for existing code that just calls validate()
    static validate(packet) {
        const result = this.validateAndSmooth(packet);
        if (result) {
            // Modify object in place if needed by caller
            packet.latitude = result.latitude;
            packet.longitude = result.longitude;
            return true;
        }
        return false;
    }
    static clearCache() {
        lastProcessedCache.clear();
    }
}
exports.GPSValidator = GPSValidator;
