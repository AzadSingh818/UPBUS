"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteDeviationDetector = void 0;
const geoUtils_1 = require("../../../engine/geoUtils");
class RouteDeviationDetector {
    static isDeviated(rawLat, rawLng, matchedLat, matchedLng, thresholdMeters = 150) {
        const distKm = (0, geoUtils_1.haversineDistanceKm)({ lat: rawLat, lng: rawLng }, { lat: matchedLat, lng: matchedLng });
        const distMeters = distKm * 1000;
        return distMeters > thresholdMeters;
    }
}
exports.RouteDeviationDetector = RouteDeviationDetector;
