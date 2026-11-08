"use strict";
/**
 * Master Stops Ingestion & Quality Flagging Engine (Phase 1)
 * Parses 14,762 stops from Margdarshi raw dataset and structures them with:
 * - Easting = Longitude (76-84°), Northing = Latitude (23-32°)
 * - Strict quality classification: 'valid' | 'missing' | 'out_of_bounds'
 * - Preserves zero-coordinate stops as 'missing' without fake overwriting
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMasterStops = processMasterStops;
const fs = __importStar(require("fs"));
function processMasterStops(rawJsonPath) {
    if (!fs.existsSync(rawJsonPath)) {
        throw new Error(`Raw stops file not found at ${rawJsonPath}`);
    }
    const rawData = JSON.parse(fs.readFileSync(rawJsonPath, 'utf8'));
    const stops = [];
    const stats = {
        totalProcessed: rawData.length,
        validWithCoords: 0,
        missingCoords: 0,
        outOfBoundsCoords: 0
    };
    for (const item of rawData) {
        const stopCode = Number(item.StopAreaCode);
        const name = (item.Name || '').trim();
        const adminAreaCode = (item.AdministrativeAreaCode || '').trim() || undefined;
        const easting = Number(item.Easting) || 0;
        const northing = Number(item.Northing) || 0;
        let latitude = null;
        let longitude = null;
        let quality = 'missing';
        // In Indian Transit Standards & Margdarshi telemetry:
        // Easting = Longitude (UP is ~77.0 to ~84.5)
        // Northing = Latitude (UP is ~23.8 to ~31.5)
        if (easting === 0 && northing === 0) {
            quality = 'missing';
            stats.missingCoords++;
        }
        else {
            // Validate geographical bounding box of Uttar Pradesh and neighboring NCR/Punjab/Uttarakhand links
            const lat = northing;
            const lng = easting;
            if (lat >= 20.0 && lat <= 36.0 && lng >= 70.0 && lng <= 88.0) {
                latitude = Number(lat.toFixed(6));
                longitude = Number(lng.toFixed(6));
                quality = 'valid';
                stats.validWithCoords++;
            }
            else {
                latitude = Number(lat.toFixed(6));
                longitude = Number(lng.toFixed(6));
                quality = 'out_of_bounds';
                stats.outOfBoundsCoords++;
            }
        }
        stops.push({
            stopCode,
            name,
            adminAreaCode,
            latitude,
            longitude,
            sourceQuality: quality,
            rawEasting: easting,
            rawNorthing: northing
        });
    }
    return { stops, stats };
}
