import { Router } from 'express';
import { adminMonitor } from '../services/adminMonitor';
import { getStopsMap, getRouteStopsMap } from '../engine/graph';
import { mockDb } from '../db';

export const router = Router();

// 1. Get live logs circular buffer
router.get('/monitor/logs', (req, res) => {
  res.json({ logs: adminMonitor.getLogs() });
});

// 2. Get active tracked buses grid
router.get('/monitor/buses', async (req, res) => {
  const buses = adminMonitor.getActiveBuses();
  try {
    const { redisGet } = require('../utils/redis');
    const updatedBuses = await Promise.all(
      buses.map(async (bus) => {
        const liveRouteData = await redisGet(`bus:${bus.regNo}`);
        if (liveRouteData && liveRouteData.route_name) {
          return {
            ...bus,
            routeName: liveRouteData.route_name,
            routeCode: liveRouteData.trip_id !== 'UNKNOWN' ? liveRouteData.trip_id : bus.routeCode
          };
        }
        return bus;
      })
    );
    res.json({ buses: updatedBuses });
  } catch (err) {
    res.json({ buses });
  }
});

// 3. Get database stats summary
router.get('/monitor/stats', async (req, res) => {
  const stats = await adminMonitor.getStats();
  res.json({ stats });
});

// ─── INTERNAL BRIDGE ─────────────────────────────────────────────────────────
// POST /api/v1/admin/monitor/push
// Called by the Engine process to forward GPS logs & bus state updates
// so the Admin UI (which polls backend) sees live data from the engine.
router.post('/monitor/push', (req, res) => {
  try {
    const { logs, busUpdates } = req.body || {};

    // Accept array of log items from engine
    if (Array.isArray(logs)) {
      for (const log of logs) {
        adminMonitor.addLog({
          terminalId: log.terminalId || 'engine',
          service: log.service,
          level: log.level,
          entityId: log.entityId,
          type: log.type || 'SYSTEM',
          busId: log.busId,
          regNo: log.regNo,
          status: log.status,
          message: log.message || '',
          latencyMs: log.latencyMs
        });

        if (log.message && log.message.includes('Successfully seeded route')) {
          adminMonitor.seededRoutesCount += 1;
        }
        if (log.message && log.message.includes('Successfully geocoded and saved stop')) {
          adminMonitor.seededStopsCount += 1;
        }
      }
    }

    // Accept array of bus state updates from engine
    if (Array.isArray(busUpdates)) {
      try {
        const { incrementHistoricalLogsCount } = require('../db');
        incrementHistoricalLogsCount(busUpdates.length);
      } catch {}

      for (const bus of busUpdates) {
        if (bus.busId) {
          adminMonitor.updateBus(bus.busId, bus.regNo || 'UNKNOWN', {
            latitude: bus.latitude,
            longitude: bus.longitude,
            speed: bus.speed,
            heading: bus.heading,
            routeCode: bus.routeCode,
            routeName: bus.routeName,
            tripId: bus.tripId,
            currentStop: bus.currentStop,
            zoneName: bus.zoneName,
            status: bus.status,
            originalRouteStr: bus.originalRouteStr,
            isNewlyDetected: bus.isNewlyDetected
          });

          // Sync into mockDb.bus_live_state so passenger queries work without PostgreSQL
          if (mockDb.bus_live_state && bus.tripId) {
            const idx = mockDb.bus_live_state.findIndex((l: any) => l.bus_id === bus.busId);
            const liveEntry = {
              bus_id: bus.busId,
              trip_id: bus.tripId,
              latitude: bus.latitude,
              longitude: bus.longitude,
              speed: bus.speed || 0,
              heading: bus.heading || 0,
              last_seen_at: new Date().toISOString()
            };
            if (idx >= 0) {
              mockDb.bus_live_state[idx] = liveEntry;
            } else {
              mockDb.bus_live_state.push(liveEntry);
            }
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
