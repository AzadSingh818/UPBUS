"use strict";
/**
 * overpass.ts
 * Helpers to build Overpass API queries and parse raw results into
 * lightweight village objects.
 *
 * USAGE (one-shot, cached externally):
 *   const raw  = await fetchVillagesInBbox(south, west, north, east);
 *   const list = parseOverpassVillages(raw);
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
exports.buildOverpassQuery = buildOverpassQuery;
exports.parseOverpassVillages = parseOverpassVillages;
exports.fetchVillagesInBbox = fetchVillagesInBbox;
exports.computeBbox = computeBbox;
/** Build the Overpass QL query that fetches named villages inside a bounding box. */
function buildOverpassQuery(south, west, north, east) {
    // We query:
    //   - place=village (small settlement)
    //   - place=hamlet  (even smaller, but often on bus routes in UP)
    //   - place=locality (named locality)
    // All must have a "name" tag.
    const bbox = `${south},${west},${north},${east}`;
    return `
[out:json][timeout:60];
(
  node["place"="village"]["name"](${bbox});
  node["place"="hamlet"]["name"](${bbox});
  node["place"="locality"]["name"](${bbox});
);
out center;
  `.trim();
}
/** Parse the raw Overpass JSON response into a flat array of villages. */
function parseOverpassVillages(raw) {
    if (!raw || !Array.isArray(raw.elements))
        return [];
    const result = [];
    for (const el of raw.elements) {
        const name = el.tags?.name_hi // prefer Hindi name if present
            || el.tags?.name;
        if (!name)
            continue;
        let lat;
        let lon;
        if (el.type === 'node') {
            lat = el.lat;
            lon = el.lon;
        }
        else if (el.center) {
            lat = el.center.lat;
            lon = el.center.lon;
        }
        if (lat === undefined || lon === undefined)
            continue;
        result.push({ name, latitude: lat, longitude: lon });
    }
    return result;
}
/**
 * Fetch villages from the Overpass API for a given bounding box.
 * Uses node-fetch (same as the rest of the backend).
 * Tries the primary endpoint first, then a public mirror on failure.
 * Throws only when both endpoints fail — callers should catch and fall back to cache.
 */
async function fetchVillagesInBbox(south, west, north, east) {
    // Multiple public Overpass endpoints — try primary, then mirrors
    const ENDPOINTS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ];
    const fetch = (await Promise.resolve().then(() => __importStar(require('node-fetch')))).default;
    const query = buildOverpassQuery(south, west, north, east);
    const body = `data=${encodeURIComponent(query)}`;
    let lastError = new Error('No endpoint tried');
    for (const endpoint of ENDPOINTS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 70_000); // 70 s hard timeout
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': 'upbus-backend/1.0 (UP Bus Live Tracker)',
                },
                body,
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!response.ok) {
                const text = await response.text();
                lastError = new Error(`Overpass HTTP ${response.status} from ${endpoint}: ${text.slice(0, 200)}`);
                console.warn(`[Overpass] ${endpoint} returned ${response.status} — trying next mirror`);
                continue; // try next endpoint
            }
            const raw = await response.json();
            return parseOverpassVillages(raw);
        }
        catch (err) {
            clearTimeout(timer);
            lastError = new Error(`Overpass network error at ${endpoint}: ${err.message}`);
            console.warn(`[Overpass] ${endpoint} failed: ${err.message} — trying next mirror`);
        }
    }
    throw lastError;
}
/** Compute an axis-aligned bounding box with a padding margin (km). */
function computeBbox(coords, paddingKm = 5) {
    const lats = coords.map(c => c.latitude);
    const lons = coords.map(c => c.longitude);
    const padLat = paddingKm / 111; // ~111 km per degree latitude
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const padLon = paddingKm / (111 * Math.cos((midLat * Math.PI) / 180));
    return {
        south: Math.min(...lats) - padLat,
        west: Math.min(...lons) - padLon,
        north: Math.max(...lats) + padLat,
        east: Math.max(...lons) + padLon,
    };
}
