"use strict";
/**
 * routeVillages.ts
 * Express router: GET /api/routes/:routeId/villages
 *
 * Query param:  ?maxDistanceKm=<number>   (default 3)
 * Returns:      { villages: [{ name, latitude, longitude }] }
 *
 * Caching strategy:
 *   - Per-route cache stored as JSON files in <cacheDir>/<routeId>.json
 *   - Cache is considered fresh if younger than CACHE_TTL_MS
 *   - POST /api/routes/:routeId/villages/refresh forces a re-fetch
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const routeGeometry_1 = require("../engine/routeGeometry");
const overpass_1 = require("../utils/overpass");
const villageFilter_1 = require("../utils/villageFilter");
exports.router = express_1.default.Router();
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
/** Cache directory – sibling of src/db so it survives hot-reloads */
const CACHE_DIR = path.join(__dirname, '../db/village_cache');
/**
 * Cache TTL: 7 days.
 * Village geography changes rarely; re-fetch weekly or on manual refresh.
 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Ensure cache directory exists at module load time
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}
function cachePath(routeId) {
    return path.join(CACHE_DIR, `${routeId}.json`);
}
function readCache(routeId) {
    const p = cachePath(routeId);
    if (!fs.existsSync(p))
        return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    catch {
        return null;
    }
}
function isCacheFresh(entry) {
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    return age < CACHE_TTL_MS;
}
function writeCache(routeId, villages) {
    const entry = { fetchedAt: new Date().toISOString(), villages };
    fs.writeFileSync(cachePath(routeId), JSON.stringify(entry, null, 2), 'utf8');
}
// ---------------------------------------------------------------------------
// Core fetcher (Overpass → filter → cache)
// ---------------------------------------------------------------------------
async function fetchAndCacheVillages(routeId, maxDistanceKm) {
    const geom = (0, routeGeometry_1.getRouteGeometry)(routeId);
    if (!geom || geom.points.length < 2) {
        throw new Error(`No geometry available for route ${routeId}`);
    }
    // Build polyline from all geometry points (stops + waypoints)
    const polyline = geom.points.map(p => ({
        lat: p.latitude,
        lng: p.longitude,
    }));
    // Bounding box with 5 km padding to catch villages slightly outside the direct line
    const bbox = (0, overpass_1.computeBbox)(geom.points.map(p => ({ latitude: p.latitude, longitude: p.longitude })), 5);
    console.log(`[Villages] Fetching from Overpass for route ${routeId} bbox:`, bbox);
    const raw = await (0, overpass_1.fetchVillagesInBbox)(bbox.south, bbox.west, bbox.north, bbox.east);
    console.log(`[Villages] Overpass returned ${raw.length} candidates for route ${routeId}`);
    // Always cache at the DEFAULT distance (5 km) so we can re-filter on demand
    const cacheFiltered = (0, villageFilter_1.filterVillagesByDistance)(raw, polyline, villageFilter_1.DEFAULT_MAX_DISTANCE_KM);
    const cacheVillages = cacheFiltered.map(v => ({
        name: v.name,
        latitude: v.latitude,
        longitude: v.longitude,
    }));
    writeCache(routeId, cacheVillages);
    const filtered = (0, villageFilter_1.filterVillagesByDistance)(raw, polyline, maxDistanceKm);
    console.log(`[Villages] ${filtered.length} within ${maxDistanceKm} km for route ${routeId}`);
    return filtered.map(v => ({
        name: v.name,
        latitude: v.latitude,
        longitude: v.longitude,
    }));
}
// ---------------------------------------------------------------------------
// GET /api/routes/:routeId/villages
// ---------------------------------------------------------------------------
exports.router.get('/:routeId/villages', async (req, res) => {
    const routeId = parseInt(req.params.routeId, 10);
    if (isNaN(routeId)) {
        return res.status(400).json({ error: 'routeId must be a number' });
    }
    const maxDistanceKm = parseFloat(req.query.maxDistanceKm) || 0.2; // Default to 0.2 km (200m) to match PRD
    try {
        // 1. Check cache
        const cached = readCache(routeId);
        if (cached && isCacheFresh(cached)) {
            // Re-filter from cached pool in case maxDistanceKm differs from cache
            const geom = (0, routeGeometry_1.getRouteGeometry)(routeId);
            if (!geom || geom.points.length < 2) {
                return res.status(404).json({ error: `No route geometry for routeId ${routeId}` });
            }
            const polyline = geom.points.map(p => ({
                lat: p.latitude,
                lng: p.longitude,
            }));
            // The cached list was already filtered at DEFAULT distance; re-filter for custom distances
            const filtered = (0, villageFilter_1.filterVillagesByDistance)(cached.villages.map(v => ({ name: v.name, latitude: v.latitude, longitude: v.longitude })), polyline, maxDistanceKm);
            return res.json({
                villages: filtered.map(v => ({ name: v.name, latitude: v.latitude, longitude: v.longitude })),
                _meta: { source: 'cache', cachedAt: cached.fetchedAt, count: filtered.length },
            });
        }
        // 2. Cache miss or stale → fetch from Overpass
        const villages = await fetchAndCacheVillages(routeId, maxDistanceKm);
        return res.json({
            villages,
            _meta: { source: 'overpass', count: villages.length },
        });
    }
    catch (err) {
        console.error(`[Villages] Error for route ${routeId}:`, err.message);
        // Fallback: serve stale cache rather than error
        const stale = readCache(routeId);
        if (stale) {
            console.warn(`[Villages] Serving stale cache for route ${routeId}`);
            return res.json({
                villages: stale.villages,
                _meta: { source: 'stale_cache', cachedAt: stale.fetchedAt, count: stale.villages.length },
            });
        }
        return res.status(503).json({
            error: 'Failed to fetch village data and no cache available.',
            detail: err.message,
        });
    }
});
// ---------------------------------------------------------------------------
// POST /api/routes/:routeId/villages/refresh
// Force a fresh Overpass fetch, replacing the cache
// ---------------------------------------------------------------------------
exports.router.post('/:routeId/villages/refresh', async (req, res) => {
    const routeId = parseInt(req.params.routeId, 10);
    if (isNaN(routeId)) {
        return res.status(400).json({ error: 'routeId must be a number' });
    }
    const maxDistanceKm = parseFloat(req.query.maxDistanceKm) || villageFilter_1.DEFAULT_MAX_DISTANCE_KM;
    try {
        const villages = await fetchAndCacheVillages(routeId, maxDistanceKm);
        return res.json({ ok: true, count: villages.length, villages });
    }
    catch (err) {
        console.error(`[Villages/refresh] Error for route ${routeId}:`, err.message);
        res.status(503).json({ error: err.message });
    }
});
