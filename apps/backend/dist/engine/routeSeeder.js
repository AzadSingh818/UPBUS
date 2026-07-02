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
exports.initSeeder = initSeeder;
exports.processMargdarshiBuses = processMargdarshiBuses;
exports.startRouteSeeder = startRouteSeeder;
exports.stopRouteSeeder = stopRouteSeeder;
const db_1 = require("../db");
const geoUtils_1 = require("./geoUtils");
const adminMonitor_1 = require("../services/adminMonitor");
const processedRoutes = new Set();
const processingRoutes = new Set();
const stopsCache = new Map();
let seederInterval = null;
let lastGeocodeTime = 0;
let isProcessing = false;
async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
    const fetch = (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
    ]);
}
function cleanStopName(name) {
    return name
        .replace(/\b(BUS STATION|BUS STAND|DEPOT|TERMINAL|ISBT|OLD|NEW)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function parseRouteStops(routeDesc) {
    const viaIndex = routeDesc.toUpperCase().indexOf(' VIA ');
    if (viaIndex !== -1) {
        const mainPart = routeDesc.substring(0, viaIndex);
        const viaPart = routeDesc.substring(viaIndex + 5);
        const toParts = mainPart.split(/\s+TO\s+/i);
        if (toParts.length === 2) {
            const source = cleanStopName(toParts[0]);
            const dest = cleanStopName(toParts[1]);
            const vias = viaPart
                .split(/[,-\/]| and /gi)
                .map(s => cleanStopName(s))
                .filter(s => s.length > 2 && s !== 'RETURN' && s !== 'EXPRESS' && s !== 'DEPOT');
            if (source && dest) {
                return [source, ...vias, dest];
            }
        }
    }
    return routeDesc
        .split(/[-\/]| via | to /i)
        .map((s) => cleanStopName(s))
        .filter((s) => s.length > 2 && s !== 'RETURN' && s !== 'EXPRESS' && s !== 'DEPOT');
}
/**
 * Initialize Seeder: loads existing stops and routes into local caches
 */
async function initSeeder() {
    try {
        processedRoutes.clear();
        stopsCache.clear();
        // 1. Load existing stops
        const stopsRes = await (0, db_1.query)('SELECT id, name, latitude, longitude FROM stops');
        stopsRes.rows.forEach((s) => {
            stopsCache.set(s.name.toUpperCase().trim(), {
                id: s.id,
                name: s.name,
                latitude: parseFloat(s.latitude),
                longitude: parseFloat(s.longitude)
            });
        });
        // 2. Load existing routes
        const routesRes = await (0, db_1.query)('SELECT route_name FROM routes');
        routesRes.rows.forEach((r) => {
            if (r.route_name) {
                processedRoutes.add(r.route_name.toUpperCase().trim());
            }
        });
        console.log(`[Route Seeder] Initialized. Cached ${stopsCache.size} stops and ${processedRoutes.size} routes.`);
    }
    catch (error) {
        console.error('[Route Seeder] Error during initialization:', error);
    }
}
/**
 * Keyless Photon Geocoding (Fast, case-insensitive, generous rate limit)
 */
async function geocodePhoton(stopName) {
    try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(stopName + ', Uttar Pradesh, India')}&limit=1`;
        const res = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': 'UPBusTracker/1.0 (contact: upbustracker@upsrtc.in)'
            }
        }, 3000);
        if (!res.ok)
            return null;
        const data = await res.json();
        if (data && Array.isArray(data.features) && data.features.length > 0) {
            const geometry = data.features[0].geometry;
            if (geometry && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
                return {
                    lat: parseFloat(geometry.coordinates[1]),
                    lng: parseFloat(geometry.coordinates[0])
                };
            }
        }
    }
    catch (e) {
        console.error(`[Photon Geocoder] Error geocoding ${stopName}:`, e);
    }
    return null;
}
/**
 * Keyless Nominatim Geocoding with Rate Limiting (1 request per second max)
 */
async function geocodeNominatim(stopName) {
    const now = Date.now();
    const elapsed = now - lastGeocodeTime;
    if (elapsed < 1000) {
        // Delay to respect rate limit
        await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
    }
    lastGeocodeTime = Date.now();
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(stopName + ', Uttar Pradesh, India')}&format=json&limit=1`;
        const res = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': 'UPBusTracker/1.0 (contact: upbustracker@upsrtc.in)'
            }
        }, 3000);
        if (!res.ok)
            return null;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
        }
    }
    catch (e) {
        console.error(`[Nominatim Geocoder] Error geocoding ${stopName}:`, e);
    }
    return null;
}
/**
 * Keyless Overpass API Geocoding using exact matches (fast index lookup, timeout prevention)
 */
async function geocodeOverpass(stopName) {
    const titleName = stopName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    const queryStr = `
[out:json][timeout:5];
(
  node["place"]["name"="${titleName}"](23.8,77.0,31.5,84.8);
  node["place"]["name:en"="${titleName}"](23.8,77.0,31.5,84.8);
  node["place"]["name"="${stopName}"](23.8,77.0,31.5,84.8);
  node["place"]["name:en"="${stopName}"](23.8,77.0,31.5,84.8);
  relation["boundary"="administrative"]["name"="${titleName}"](23.8,77.0,31.5,84.8);
  relation["boundary"="administrative"]["name"="${stopName}"](23.8,77.0,31.5,84.8);
);
out center;
  `.trim();
    const ENDPOINTS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];
    for (const endpoint of ENDPOINTS) {
        try {
            const res = await fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': 'upbus-backend/1.0 (UP Bus Live Tracker)',
                },
                body: `data=${encodeURIComponent(queryStr)}`,
            }, 4000);
            if (!res.ok)
                continue;
            const data = await res.json();
            if (data && Array.isArray(data.elements) && data.elements.length > 0) {
                const el = data.elements[0];
                let lat = el.lat;
                let lon = el.lon;
                if (lat === undefined && el.center) {
                    lat = el.center.lat;
                    lon = el.center.lon;
                }
                if (lat !== undefined && lon !== undefined) {
                    return { lat, lng: lon };
                }
            }
        }
        catch (e) {
            // Fail silently and try next mirror
        }
    }
    return null;
}
/**
 * Resolves stop name to Stop item (with lat/lng).
 * Uses Cache -> GPS Halt Approximation -> Overpass Geocoder -> Nominatim Geocoder.
 */
async function resolveStop(stopName, busLat, busLng, busSpeed, isLastStop) {
    const key = stopName.toUpperCase().trim();
    if (stopsCache.has(key)) {
        return stopsCache.get(key);
    }
    let lat = 0;
    let lng = 0;
    let resolved = false;
    // Method 1: GPS Halt Approximation
    if (busSpeed < 5 && isLastStop && busLat && busLng) {
        lat = busLat;
        lng = busLng;
        resolved = true;
        console.log(`[Route Seeder] GPS Halt approximation used for stop: ${stopName} (${lat}, ${lng})`);
    }
    // Method 2: Photon Geocoding (Primary - fast & robust)
    if (!resolved) {
        const coords = await geocodePhoton(stopName);
        if (coords) {
            lat = coords.lat;
            lng = coords.lng;
            resolved = true;
        }
    }
    // Method 3: Overpass Geocoding (Secondary - fast exact index search)
    if (!resolved) {
        const coords = await geocodeOverpass(stopName);
        if (coords) {
            lat = coords.lat;
            lng = coords.lng;
            resolved = true;
        }
    }
    // Method 4: Nominatim Geocoding (Tertiary fallback)
    if (!resolved) {
        const coords = await geocodeNominatim(stopName);
        if (coords) {
            lat = coords.lat;
            lng = coords.lng;
            resolved = true;
        }
    }
    if (resolved) {
        try {
            const stopCode = `S_AUTO_${key.replace(/[^A-Z0-9]/g, '_')}`;
            const insertRes = await (0, db_1.query)(`INSERT INTO stops (stop_code, name, latitude, longitude)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (stop_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`, [stopCode, stopName, lat, lng]);
            const newId = insertRes.rows[0].id;
            const item = { id: newId, name: stopName, latitude: lat, longitude: lng };
            stopsCache.set(key, item);
            adminMonitor_1.adminMonitor.addLog({
                type: 'SEEDER',
                status: 'success',
                message: `Successfully geocoded and saved stop: "${stopName}" (${lat.toFixed(5)}, ${lng.toFixed(5)})`
            });
            return item;
        }
        catch (e) {
            console.error(`[Route Seeder] Error inserting stop ${stopName}:`, e);
        }
    }
    adminMonitor_1.adminMonitor.addLog({
        type: 'SEEDER',
        status: 'failed',
        message: `Failed to geocode stop: "${stopName}"`
    });
    return null;
}
// Deleted old cleanStopName from here
/**
 * Polls Margdarshi GPS stream and parses/inserts newly discovered routes
 */
async function processMargdarshiBuses() {
    if (isProcessing)
        return;
    isProcessing = true;
    try {
        const res = await fetchWithTimeout('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', {
            method: 'POST',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }, 5000);
        if (!res.ok) {
            isProcessing = false;
            return;
        }
        const data = JSON.parse(await res.text());
        if (!Array.isArray(data)) {
            isProcessing = false;
            return;
        }
        for (const bus of data) {
            const regNo = bus.RegNo || bus.regNum || bus.bus_id;
            const latVal = bus.latitude !== undefined ? bus.latitude : bus.lat;
            const lngVal = bus.longitude !== undefined ? bus.longitude : bus.long;
            if (!regNo || latVal === undefined || lngVal === undefined || !bus.route_description)
                continue;
            const routeDesc = bus.route_description.toUpperCase().trim();
            if (processedRoutes.has(routeDesc) || processingRoutes.has(routeDesc))
                continue;
            const stopNames = parseRouteStops(routeDesc);
            if (stopNames.length < 2)
                continue;
            console.log(`[Route Seeder] Found new route description to parse: "${routeDesc}"`);
            adminMonitor_1.adminMonitor.addLog({
                type: 'SEEDER',
                message: `Found new route description to parse: "${routeDesc}"`
            });
            // Resolve coordinates for all stops
            const stopObjs = [];
            let allResolved = true;
            processingRoutes.add(routeDesc);
            for (let i = 0; i < stopNames.length; i++) {
                const name = stopNames[i];
                const isLast = i === stopNames.length - 1;
                const resolved = await resolveStop(name, parseFloat(latVal), parseFloat(lngVal), parseFloat(bus.speed) || 0, isLast);
                if (resolved) {
                    stopObjs.push(resolved);
                }
                else {
                    allResolved = false;
                    break; // Stop parsing this route if geocoding fails for any stop
                }
            }
            if (!allResolved || stopObjs.length < 2) {
                console.warn(`[Route Seeder] Could not resolve all stops for route: "${routeDesc}"`);
                adminMonitor_1.adminMonitor.addLog({
                    type: 'SEEDER',
                    status: 'failed',
                    message: `Failed to resolve stops for route: "${routeDesc}"`
                });
                processingRoutes.delete(routeDesc);
                continue;
            }
            // Calculate total route distance (cumulative haversine segment distances * 1.15 winding factor)
            let totalDistanceKm = 0;
            const sequenceStops = [{ stopId: stopObjs[0].id, distance: 0 }];
            for (let i = 1; i < stopObjs.length; i++) {
                const prev = stopObjs[i - 1];
                const curr = stopObjs[i];
                const segDist = (0, geoUtils_1.haversineDistanceKm)({ lat: prev.latitude, lng: prev.longitude }, { lat: curr.latitude, lng: curr.longitude }) * 1.15; // 1.15 multiplier for road winding
                totalDistanceKm += segDist;
                sequenceStops.push({ stopId: curr.id, distance: totalDistanceKm });
            }
            // Save Route
            try {
                const routeCode = `R_AUTO_${stopObjs[0].id}_${stopObjs[stopObjs.length - 1].id}`;
                const sourceName = stopObjs[0].name;
                const destName = stopObjs[stopObjs.length - 1].name;
                const routeInsert = await (0, db_1.query)(`INSERT INTO routes (route_code, route_name, source, destination, distance_km)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (route_code) DO UPDATE SET route_name = EXCLUDED.route_name
           RETURNING id`, [routeCode, routeDesc, sourceName, destName, parseFloat(totalDistanceKm.toFixed(2))]);
                const routeId = routeInsert.rows[0].id;
                // Save Route stops mapping
                for (let i = 0; i < sequenceStops.length; i++) {
                    const s = sequenceStops[i];
                    await (0, db_1.query)(`INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (route_id, stop_id) DO NOTHING`, [routeId, s.stopId, i + 1, parseFloat(s.distance.toFixed(2))]);
                }
                processedRoutes.add(routeDesc);
                console.log(`[Route Seeder] Successfully seeded route: "${routeDesc}" (${totalDistanceKm.toFixed(1)} km, ${stopObjs.length} stops)`);
                adminMonitor_1.adminMonitor.addLog({
                    type: 'SEEDER',
                    status: 'success',
                    message: `Successfully seeded route: "${routeDesc}" (${totalDistanceKm.toFixed(1)} km, ${stopObjs.length} stops)`
                });
                // Rebuild the pathfinder graph in-memory so the new route is immediately searchable
                try {
                    const { buildGraph } = require('./graph');
                    await buildGraph();
                }
                catch (graphErr) {
                    console.error('[Route Seeder] Error rebuilding graph in-memory:', graphErr);
                }
            }
            catch (e) {
                console.error(`[Route Seeder] Error seeding route "${routeDesc}":`, e);
                adminMonitor_1.adminMonitor.addLog({
                    type: 'SEEDER',
                    status: 'failed',
                    message: `Error seeding route "${routeDesc}": ${e.message || e}`
                });
            }
            finally {
                processingRoutes.delete(routeDesc);
            }
        }
    }
    catch (error) {
        console.error('[Route Seeder] Error running seeder cycle:', error);
    }
    finally {
        isProcessing = false;
    }
}
/**
 * Start the seeder daemon in background
 */
async function startRouteSeeder() {
    if (seederInterval)
        return;
    console.log('[Route Seeder] Starting Autonomous Network Seeder...');
    await initSeeder();
    // Poll Margdarshi every 2 seconds
    seederInterval = setInterval(processMargdarshiBuses, 2000);
}
/**
 * Stop the seeder daemon
 */
function stopRouteSeeder() {
    if (seederInterval) {
        clearInterval(seederInterval);
        seederInterval = null;
        console.log('[Route Seeder] Stopped Autonomous Network Seeder.');
    }
}
