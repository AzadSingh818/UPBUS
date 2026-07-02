"use strict";
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
exports.ingestLocation = ingestLocation;
exports.fetchLiveLocations = fetchLiveLocations;
exports.startIngestion = startIngestion;
exports.stopIngestion = stopIngestion;
const db_1 = require("../db");
const routeLearning_1 = require("../engine/routeLearning");
const RouteProgressEngine_1 = require("../modules/route-progress/service/RouteProgressEngine");
const { STOPS, simulatedBuses } = require('./simulation_data.json');
let ingestionTimer = null;
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}
async function ingestLocation(location) {
    try {
        let busRes = await (0, db_1.query)('SELECT id FROM buses WHERE registration_no = $1', [location.registrationNo]);
        if (busRes.rows.length === 0)
            return;
        let busId = busRes.rows[0].id;
        let tripRes = await (0, db_1.query)("SELECT id FROM trips WHERE bus_id = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 1", [busId]);
        if (tripRes.rows.length === 0)
            return;
        let tripId = tripRes.rows[0].id;
        await (0, db_1.query)(`INSERT INTO bus_live_state (bus_id, trip_id, latitude, longitude, speed, heading, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bus_id) 
       DO UPDATE SET 
          trip_id = EXCLUDED.trip_id,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          speed = EXCLUDED.speed,
          heading = EXCLUDED.heading,
          last_seen_at = EXCLUDED.last_seen_at`, [busId, tripId, location.latitude, location.longitude, location.speed, location.heading, location.timestamp]);
        // Record the location ping in the route learning engine
        (0, routeLearning_1.recordLiveLocation)(tripId, location.latitude, location.longitude, location.speed).catch(err => {
            console.error('[Route Learning] Error recording location ping:', err);
        });
        // Process Route Progress Pipeline
        RouteProgressEngine_1.RouteProgressEngine.process({
            busId,
            latitude: location.latitude,
            longitude: location.longitude,
            speed: location.speed,
            heading: location.heading,
            accuracy: 5,
            timestamp: location.timestamp
        }).catch(err => {
            console.error('[Route Progress Engine] Error processing location update:', err);
        });
    }
    catch (error) {
        console.error('Error ingesting location:', error);
    }
}
async function fetchLiveLocations() {
    try {
        const fetch = (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
        const response = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', { method: 'POST' });
        const rawText = await response.text();
        const data = JSON.parse(rawText);
        if (Array.isArray(data)) {
            for (const bus of data) {
                const regNo = bus.RegNo || bus.regNum || bus.bus_id;
                const latVal = bus.latitude !== undefined ? bus.latitude : bus.lat;
                const lngVal = bus.longitude !== undefined ? bus.longitude : bus.long;
                if (!regNo || latVal === undefined || lngVal === undefined)
                    continue;
                const speed = parseFloat(bus.speed) || 0;
                await ingestLocation({
                    registrationNo: regNo,
                    latitude: parseFloat(latVal),
                    longitude: parseFloat(lngVal),
                    speed,
                    heading: parseFloat(bus.heading) || 0,
                    timestamp: bus.LogrecTime || bus.timestamp ? new Date(bus.LogrecTime || bus.timestamp) : new Date(),
                    status: speed > 0 ? 'moving' : 'halted'
                });
            }
        }
    }
    catch (err) { }
}
function startIngestion() {
    if (ingestionTimer)
        return;
    fetchLiveLocations();
    ingestionTimer = setInterval(fetchLiveLocations, 2000);
}
function stopIngestion() {
    if (ingestionTimer) {
        clearInterval(ingestionTimer);
        ingestionTimer = null;
    }
}
