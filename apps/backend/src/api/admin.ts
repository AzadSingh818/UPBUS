import { Router } from 'express';
import { adminMonitor } from '../services/adminMonitor';
import { getStopsMap, getRouteStopsMap } from '../engine/graph';

export const router = Router();

// 1. Get live logs circular buffer
router.get('/monitor/logs', (req, res) => {
  res.json({ logs: adminMonitor.getLogs() });
});

// 2. Get active tracked buses grid
router.get('/monitor/buses', (req, res) => {
  res.json({ buses: adminMonitor.getActiveBuses() });
});

// 3. Get database stats summary
router.get('/monitor/stats', async (req, res) => {
  const stats = await adminMonitor.getStats();
  res.json({ stats });
});

// 4. Get stops and route lines for map rendering
import { query } from '../db';

router.get('/monitor/map-data', async (req, res) => {
  try {
    const stopsMap = getStopsMap();
    const routeStopsMap = getRouteStopsMap();

    // Fetch route names map
    const routeNamesRes = await query('SELECT id, route_name FROM routes');
    const routeNamesMap = new Map<number, string>(
      routeNamesRes.rows.map((r: any) => [r.id, r.route_name])
    );

    const stops = Array.from(stopsMap.values()).map((s: any) => ({
      id: s.id,
      name: s.name,
      lat: s.latitude,
      lng: s.longitude
    }));

    const routes: any[] = [];
    for (const [routeId, rStops] of routeStopsMap.entries()) {
      const pathPoints = rStops
        .slice() // copy array to avoid sorting mutation side-effects
        .sort((a, b) => a.sequence_no - b.sequence_no)
        .map(rs => {
          const stop = stopsMap.get(rs.stop_id);
          return stop ? [stop.latitude, stop.longitude] : null;
        })
        .filter(p => p !== null);

      if (pathPoints.length > 1) {
        routes.push({
          routeId,
          routeName: routeNamesMap.get(routeId) || `Route ${routeId}`,
          path: pathPoints
        });
      }
    }

    res.json({ stops, routes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

