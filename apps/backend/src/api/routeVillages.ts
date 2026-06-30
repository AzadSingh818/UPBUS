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

import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

import { getRouteGeometry } from '../engine/routeGeometry';
import { fetchVillagesInBbox, computeBbox } from '../utils/overpass';
import { filterVillagesByDistance, DEFAULT_MAX_DISTANCE_KM } from '../utils/villageFilter';
import { Coordinate } from '../engine/geoUtils';

export const router = express.Router();

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

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

interface CacheEntry {
  fetchedAt: string;       // ISO timestamp
  villages: { name: string; latitude: number; longitude: number }[];
}

function cachePath(routeId: number): string {
  return path.join(CACHE_DIR, `${routeId}.json`);
}

function readCache(routeId: number): CacheEntry | null {
  const p = cachePath(routeId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as CacheEntry;
  } catch {
    return null;
  }
}

function isCacheFresh(entry: CacheEntry): boolean {
  const age = Date.now() - new Date(entry.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

function writeCache(routeId: number, villages: CacheEntry['villages']): void {
  const entry: CacheEntry = { fetchedAt: new Date().toISOString(), villages };
  fs.writeFileSync(cachePath(routeId), JSON.stringify(entry, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Core fetcher (Overpass → filter → cache)
// ---------------------------------------------------------------------------

async function fetchAndCacheVillages(
  routeId: number,
  maxDistanceKm: number
): Promise<{ name: string; latitude: number; longitude: number }[]> {
  const geom = getRouteGeometry(routeId);
  if (!geom || geom.points.length < 2) {
    throw new Error(`No geometry available for route ${routeId}`);
  }

  // Build polyline from all geometry points (stops + waypoints)
  const polyline: Coordinate[] = geom.points.map(p => ({
    lat: p.latitude,
    lng: p.longitude,
  }));

  // Bounding box with 5 km padding to catch villages slightly outside the direct line
  const bbox = computeBbox(
    geom.points.map(p => ({ latitude: p.latitude, longitude: p.longitude })),
    5
  );

  console.log(`[Villages] Fetching from Overpass for route ${routeId} bbox:`, bbox);
  const raw = await fetchVillagesInBbox(bbox.south, bbox.west, bbox.north, bbox.east);
  console.log(`[Villages] Overpass returned ${raw.length} candidates for route ${routeId}`);

  // Always cache at the DEFAULT distance (5 km) so we can re-filter on demand
  const cacheFiltered = filterVillagesByDistance(raw, polyline, DEFAULT_MAX_DISTANCE_KM);
  const cacheVillages = cacheFiltered.map(v => ({
    name: v.name,
    latitude: v.latitude,
    longitude: v.longitude,
  }));
  writeCache(routeId, cacheVillages);

  const filtered = filterVillagesByDistance(raw, polyline, maxDistanceKm);
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

router.get('/:routeId/villages', async (req: Request, res: Response) => {
  const routeId = parseInt(req.params.routeId, 10);
  if (isNaN(routeId)) {
    return res.status(400).json({ error: 'routeId must be a number' });
  }

  const maxDistanceKm = parseFloat(req.query.maxDistanceKm as string) || 0.2; // Default to 0.2 km (200m) to match PRD

  try {
    // 1. Check cache
    const cached = readCache(routeId);
    if (cached && isCacheFresh(cached)) {
      // Re-filter from cached pool in case maxDistanceKm differs from cache
      const geom = getRouteGeometry(routeId);
      if (!geom || geom.points.length < 2) {
        return res.status(404).json({ error: `No route geometry for routeId ${routeId}` });
      }
      const polyline: Coordinate[] = geom.points.map(p => ({
        lat: p.latitude,
        lng: p.longitude,
      }));
      // The cached list was already filtered at DEFAULT distance; re-filter for custom distances
      const filtered = filterVillagesByDistance(
        cached.villages.map(v => ({ name: v.name, latitude: v.latitude, longitude: v.longitude })),
        polyline,
        maxDistanceKm
      );
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

  } catch (err: any) {
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

router.post('/:routeId/villages/refresh', async (req: Request, res: Response) => {
  const routeId = parseInt(req.params.routeId, 10);
  if (isNaN(routeId)) {
    return res.status(400).json({ error: 'routeId must be a number' });
  }
  const maxDistanceKm = parseFloat(req.query.maxDistanceKm as string) || DEFAULT_MAX_DISTANCE_KM;

  try {
    const villages = await fetchAndCacheVillages(routeId, maxDistanceKm);
    return res.json({ ok: true, count: villages.length, villages });
  } catch (err: any) {
    console.error(`[Villages/refresh] Error for route ${routeId}:`, err.message);
    res.status(503).json({ error: err.message });
  }
});

