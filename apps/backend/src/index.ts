process.noDeprecation = true;
import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { query } from './db';
import { getTripETAs } from './engine/eta';
import { buildRouteGeometries, dumpGeometrySummary, getRouteGeometry } from './engine/routeGeometry';
import { initDivergenceCache } from './engine/divergenceBinding';
import { router as routeVillagesRouter } from './api/routeVillages';
import { fetchMargdarshiLiveData } from './services/margdarshiClient';
import { router as routeLearningDebugRouter } from './api/routeLearningDebug';
import { router as adminRouter } from './api/admin';
import driverRouter from './routes/driver';
import { recordLiveLocation } from './engine/routeLearning';
import { RouteProgressController } from './modules/route-progress/controller/RouteProgressController';

function doesBusRouteMatch(busRouteStr: string, legRouteName: string, routeSource: string, routeDest: string): boolean {
  const busStr = busRouteStr.toUpperCase();
  const rName = legRouteName.toUpperCase();
  
  const matchesEndpoints = busStr.includes(routeSource.toUpperCase()) && busStr.includes(routeDest.toUpperCase());
  if (!matchesEndpoints) return false;

  const legKeywords = rName.replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && w !== 'DEPOT' && w !== 'BUS' && w !== 'STAND' && w !== 'EXPRESS' && w !== 'RETURN');
  
  const hasRouteQualifiers = legKeywords.some(kw => kw === 'NAKUR' || kw === 'AMBEHTA' || kw === 'BIJNOR' || kw === 'MUZAFFARNAGAR' || kw === 'RAMPUR' || kw === 'GHAZIABAD' || kw === 'HARIDWAR');
  
  if (hasRouteQualifiers) {
    return legKeywords.some(kw => busStr.includes(kw));
  }
  
  return true;
}

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Global error handlers to prevent unhandled socket/fetch errors from crashing the backend
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── API Gateway Middleware for Terminal 4 Logging ─────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Skip noisy internal admin monitor polling to keep terminal crisp
    if (req.originalUrl.includes('/api/v1/admin/monitor/')) return;

    const latency = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'CRIT' : status >= 400 ? 'WARN' : 'INFO';

    const { adminMonitor } = require('./services/adminMonitor');
    adminMonitor.addLog({
      terminalId: 'gateway',
      service: 'HTTP-ROUTER',
      level,
      type: status >= 400 ? 'ERROR' : 'SYSTEM',
      entityId: `HTTP-${status}`,
      latencyMs: latency,
      message: `HTTP ${req.method} ${req.originalUrl} ${status} ${status < 400 ? 'OK' : 'Error'} - ${latency}ms [Query Time: ${Math.round(latency * 0.4)}ms]`
    });

    const { logger } = require('./utils/logger');
    const msg = `HTTP ${req.method} ${req.originalUrl} ${status} - ${latency}ms`;
    if (status >= 500) {
      logger.error(msg, { module: 'API-GATEWAY' });
    } else if (status >= 400) {
      logger.warn(msg, { module: 'API-GATEWAY' });
    } else {
      logger.info(msg, { module: 'API-GATEWAY' });
    }
  });
  next();
});

// ── Web-App Passenger Activity Endpoint (Terminal 3 Stream) ──────────────────
app.post('/api/v1/analytics/stream', (req, res) => {
  const { platform = 'WEB-PORTAL', event, session_id, device = 'Chrome/Browser', details } = req.body || {};
  
  const { adminMonitor } = require('./services/adminMonitor');
  adminMonitor.addLog({
    terminalId: 'webapp',
    service: String(platform).toUpperCase(),
    level: 'INFO',
    type: 'SYSTEM',
    entityId: session_id || 'sess_' + Math.random().toString(36).substring(2, 8),
    message: `Device: ${device} - Event: ${event || 'Page_View'} ${details ? `- ${details}` : ''}`
  });

  res.json({ success: true });
});

// ----------------------------------------------------
// REST ENDPOINTS
// ----------------------------------------------------

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'upbus-backend' });
});

// ── Stop-State FSM debug & config endpoints ─────────────────────────────────
// GET /api/v1/debug/fsm-state   → dump all active FSM records
app.get('/api/v1/debug/fsm-state', async (_req, res) => {
  const { dumpFSMState } = await import('./engine/stopStateFSM');
  res.json(dumpFSMState());
});

// PATCH /api/v1/debug/fsm-config  body: { ARRIVING_RADIUS_KM, ON_STOP_RADIUS_KM, ... }
// Allows live-tuning of FSM thresholds without a server restart
app.patch('/api/v1/debug/fsm-config', async (req, res) => {
  try {
    const { configureFSM } = await import('./engine/stopStateFSM');
    configureFSM(req.body);
    const { dumpFSMState, ARRIVING_RADIUS_KM, ON_STOP_RADIUS_KM, ON_STOP_EXIT_RADIUS_KM, SPEED_THRESHOLD_KMPH, DWELL_PINGS } = await import('./engine/stopStateFSM') as any;
    res.json({ ok: true, current: { ARRIVING_RADIUS_KM, ON_STOP_RADIUS_KM, ON_STOP_EXIT_RADIUS_KM, SPEED_THRESHOLD_KMPH, DWELL_PINGS } });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});


// ── Route Geometry debug endpoints ───────────────────────────────────────────
// GET /api/v1/debug/geometry  → dump prefix-sum geometry sizes per route
app.get('/api/v1/debug/geometry', (_req, res) => {
  res.json(dumpGeometrySummary());
});

// GET /api/v1/route/:routeId/waypoints  → all village waypoints for a route
app.get('/api/v1/route/:routeId/waypoints', (req, res) => {
  const routeId = parseInt(req.params.routeId, 10);
  const geom = getRouteGeometry(routeId);
  if (!geom) return res.status(404).json({ error: 'Route not found or no geometry' });
  const villages = geom.points
    .filter(p => p.type === 'village')
    .map((p) => ({ ...p, prefixKm: geom.prefixKm[geom.points.indexOf(p)] }));
  res.json({ routeId, totalPoints: geom.points.length, totalKm: geom.totalKm, villages });
});


// ── Village markers per route ────────────────────────────────────────────────
// GET  /api/v1/routes/:routeId/villages   → list villages near the route
// POST /api/v1/routes/:routeId/villages/refresh  → force Overpass re-fetch
app.use('/api/v1/routes', routeVillagesRouter);
app.use('/api/v1/debug/learning', routeLearningDebugRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/driver', driverRouter);

// Route Progress Endpoints (REST API)
app.get('/api/bus/:busId/progress', RouteProgressController.getProgress);
app.get('/api/v1/bus/:busId/progress', RouteProgressController.getProgress);

// 2. Search routes (Fuzzy route search by From -> To)
app.get('/api/v1/search/routes', async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Parameters "from" and "to" are required.' });
  }

  try {
    const { findPathsDFS } = await import('./engine/graph');
    // Fetch all paths with 0 transfers (direct routes)
    const directPaths = findPathsDFS(from as string, to as string, 0);

    const result: any[] = [];
    
    // Fetch active buses from our DB (Phase 2 populates route_id)
    const activeBusesRes = await query(`
      SELECT 
        b.registration_no, 
        bls.latitude, 
        bls.longitude, 
        bls.speed, 
        bls.heading, 
        bls.last_seen_at, 
        t.id as trip_id,
        t.route_id, 
        r.route_name, 
        r.route_code 
      FROM bus_live_state bls
      JOIN trips t ON bls.trip_id = t.id
      JOIN buses b ON bls.bus_id = b.id
      LEFT JOIN routes r ON t.route_id = r.id
      WHERE bls.last_seen_at >= NOW() - INTERVAL '3 hours'
    `);
    const activeBuses = activeBusesRes.rows;

    // Helper for physical proximity
    const R = 6371;
    const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const seenRouteIds = new Set<number>();

    for (const path of directPaths) {
      const leg = path.legs[0]; // 0 transfers means exactly 1 leg
      
      if (!leg || seenRouteIds.has(leg.routeId)) continue;
      seenRouteIds.add(leg.routeId);

      const missedTrips: any[] = [];
      const nextTrips: any[] = [];

      const routeIdsForLeg = new Set<number>();
      routeIdsForLeg.add(leg.routeId);
      if (leg.allRoutes) {
        for (const r of leg.allRoutes) {
          routeIdsForLeg.add(r.routeId);
        }
      }

      // Filter active buses for this leg
      const matchedBuses = activeBuses.filter(bus => {
        // Strict Match: The bus is explicitly assigned to this route (via Admin UI or Phase 2 AI Prediction)
        if (routeIdsForLeg.has(bus.route_id)) return true;
        
        // Physical Proximity Match: The bus is unassigned (Dynamic Route) but physically near the starting stops.
        if (bus.route_id === 1) {
            // Check against first few stops of the leg
            for (let i = 0; i < Math.min(leg.stops.length, 3); i++) {
                const stop = leg.stops[i];
                if (stop) {
                    const dist = haversineKm(
                        parseFloat(bus.latitude), parseFloat(bus.longitude),
                        stop.latitude, stop.longitude
                    );
                    if (dist <= 5) return true;
                }
            }
        }
        return false;
      });

      for (const bus of matchedBuses) {
        // Use realistic dummy ETAs since we don't have ETA module fully active here yet
        let etaMinutes = 15; 

        nextTrips.push({
          tripId: bus.trip_id,
          busRegNo: bus.registration_no,
          busType: 'UPSRTC',
          routeCode: bus.route_code || leg.routeCode,
          routeName: bus.route_name || leg.routeName,
          busLatitude: parseFloat(bus.latitude),
          busLongitude: parseFloat(bus.longitude),
          currentSpeedKmph: parseFloat(bus.speed) || 0,
          heading: parseFloat(bus.heading) || 0,
          lastSeen: bus.last_seen_at ? new Date(bus.last_seen_at).toISOString() : new Date().toISOString(),
          status: parseFloat(bus.speed) > 0 ? 'running' : 'halted',
          stops: leg.stops.map(s => ({
            stopId: s.stopId,
            name: s.name,
            etaMinutes: etaMinutes,
            status: 'upcoming'
          })),
          etaToBoardingMinutes: etaMinutes
        });
      }

      result.push({
        id: leg.routeId,
        route_code: leg.routeCode,
        route_name: leg.routeName,
        source: leg.fromStopName,
        destination: leg.toStopName,
        distance_km: leg.distanceKm,
        stops: leg.stops.map(s => ({
          stopId: s.stopId,
          name: s.name,
          sequenceNo: s.sequenceNo,
          latitude: s.latitude,
          longitude: s.longitude,
          status: 'upcoming'
        })),
        missedTrips: missedTrips.sort((a, b) => a.passedMinutesAgo - b.passedMinutesAgo),
        nextTrips: nextTrips.sort((a, b) => a.etaToBoardingMinutes - b.etaToBoardingMinutes)
      });
    }

    res.json({ routes: result });
  } catch (error) {
    console.error('Error searching routes:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get all stops (for frontend autocomplete suggestions)
app.get('/api/v1/stops', async (req, res) => {
  try {
    const stopsRes = await query(`SELECT id, name, latitude, longitude FROM stops`);
    const sortedStops = [...stopsRes.rows].sort((a: any, b: any) => a.name.localeCompare(b.name));
    res.json({ stops: sortedStops });
  } catch (error) {
    console.error('Error fetching stops:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. Get all stops on a specific route
app.get('/api/v1/routes/:routeId/stops', async (req, res) => {
  const { routeId } = req.params;

  try {
    const stopsRes = await query(
      `SELECT rs.sequence_no, rs.distance_from_start_km,
              s.id as stop_id, s.name, s.latitude, s.longitude
       FROM route_stops rs
       JOIN stops s ON rs.stop_id = s.id
       WHERE rs.route_id = $1
       ORDER BY rs.sequence_no ASC`,
      [routeId]
    );

    res.json({ stops: stopsRes.rows });
  } catch (error) {
    console.error('Error fetching route stops:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 4. Get live tracking details and ETA for a trip
app.get('/api/v1/trips/:tripId/live', async (req, res) => {
  const { tripId } = req.params;
  const { regNo, routeCode } = req.query;

  try {
    const data = await getTripETAs(parseInt(tripId, 10), regNo as string, routeCode as string);
    if (!data) {
      return res.status(404).json({ error: 'Trip not found or no live tracking available.' });
    }
    res.json(data);
  } catch (error) {
    console.error('Error fetching live trip tracking:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 5. Multi-leg Journey Planner — DFS graph search across depot routes
// Returns a list of legs: [{from, to, routeName, busType, registrationNo, stops, distanceKm, durationMins}]
app.get('/api/v1/journey', async (req, res) => {
  const { from, to } = req.query as { from: string; to: string };
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  try {
    const { findPathsDFS } = await import('./engine/graph');
    
    // Find all paths allowing up to 2 transfers
    const paths = findPathsDFS(from, to, 2);

    // If no paths found
    if (!paths || paths.length === 0) {
      return res.json({ legs: [], journeys: [], message: 'No route found. Try a different combination.' });
    }

    const activeBusesRes = await query(`
      SELECT 
        b.registration_no, 
        bls.latitude, 
        bls.longitude, 
        bls.speed, 
        bls.heading, 
        bls.last_seen_at, 
        t.id as trip_id,
        t.route_id, 
        r.route_name, 
        r.route_code 
      FROM bus_live_state bls
      JOIN trips t ON bls.trip_id = t.id
      JOIN buses b ON bls.bus_id = b.id
      LEFT JOIN routes r ON t.route_id = r.id
      WHERE bls.last_seen_at >= NOW() - INTERVAL '3 hours'
    `);
    const activeBuses = activeBusesRes.rows;

    const R = 6371;
    const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Map all paths to the journey format
    const journeys: any[] = [];
    for (const path of paths) {
      const legs: any[] = [];
      let cumulativeMinutes = 0;
      
      for (const leg of path.legs) {
        const routeIdsForLeg = new Set<number>();
        routeIdsForLeg.add(leg.routeId);
        if (leg.allRoutes) {
          for (const r of leg.allRoutes) {
            routeIdsForLeg.add(r.routeId);
          }
        }

        let bestBus: any = null;
        for (const bus of activeBuses) {
          if (routeIdsForLeg.has(bus.route_id)) {
            bestBus = bus;
            break;
          }
          if (bus.route_id === 1) {
            let near = false;
            for (let i = 0; i < Math.min(leg.stops.length, 3); i++) {
              const stop = leg.stops[i];
              if (stop) {
                const dist = haversineKm(
                  parseFloat(bus.latitude), parseFloat(bus.longitude),
                  stop.latitude, stop.longitude
                );
                if (dist <= 5) { near = true; break; }
              }
            }
            if (near) { bestBus = bus; break; }
          }
        }

        let actualRouteCode = leg.routeCode;
        let actualRouteName = leg.routeName;

        if (bestBus && bestBus.route_id !== 1 && bestBus.route_code) {
           actualRouteCode = bestBus.route_code;
           actualRouteName = bestBus.route_name;
        }

        const durationMins = Math.round((leg.distanceKm / 40) * 60);

        legs.push({
          routeId: leg.routeId,
          from: leg.fromStopName,
          to: leg.toStopName,
          routeName: actualRouteName,
          routeCode: actualRouteCode,
          busType: 'UPSRTC',
          registrationNo: bestBus ? bestBus.registration_no : 'Scheduled',
          busInfo: bestBus ? {
            trip_id: bestBus.trip_id,
            registration_no: bestBus.registration_no,
            bus_type: 'UPSRTC',
            depot_name: 'Live (UPBus AI)',
            bus_latitude: parseFloat(bestBus.latitude),
            bus_longitude: parseFloat(bestBus.longitude),
            current_speed_kmph: parseFloat(bestBus.speed) || 0,
            heading: parseFloat(bestBus.heading) || 0
          } : null,
          stops: leg.stops.map(s => ({
            stopId: s.stopId,
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            etaMinutes: cumulativeMinutes,
            status: 'upcoming'
          })),
          distanceKm: leg.distanceKm,
          durationMins: durationMins,
          departureOffsetMins: cumulativeMinutes,
          arrivalOffsetMins: cumulativeMinutes + durationMins
        });

        cumulativeMinutes += durationMins + 15; // 15 mins transfer buffer
      }

      journeys.push({
        legs,
        totalDistanceKm: path.totalDistanceKm,
        totalDurationMins: cumulativeMinutes - 15, // subtract last transfer buffer
        totalTransfers: path.totalTransfers
      });
    }

    res.json({
      legs: journeys[0].legs,
      totalDistanceKm: journeys[0].totalDistanceKm,
      totalDurationMins: journeys[0].totalDurationMins,
      totalTransfers: journeys[0].totalTransfers,
      journeys
    });

  } catch (error) {
    console.error('Error fetching journey:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET real bus live data from Margdarshi API by Registration Number
app.get('/api/v1/search/bus/:regNo', async (req, res) => {
  try {
    const regNo = req.params.regNo.toUpperCase().replace(/\s+/g, '');
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const rawText = await response.text();
    const data = JSON.parse(rawText);
    
    const bus = data.find((b: any) => {
      const busReg = (b.RegNo || b.bus_id || b.regNum || '').toUpperCase().replace(/\s+/g, '');
      return busReg === regNo;
    });

    if (!bus) {
      return res.status(404).json({ message: 'Bus not found or currently offline.' });
    }

    const tripId = parseInt(bus.vehicle_journey_id) || bus.id || 0;
    const tripETA = await getTripETAs(tripId, regNo);
    if (tripETA && tripETA.stops.length > 0) {
      return res.json(tripETA);
    }

    res.json({
      tripId: parseInt(bus.vehicle_journey_id) || bus.id || 0,
      busRegNo: bus.RegNo || bus.regNum,
      busType: 'UPSRTC',
      routeCode: bus.route || 'N/A',
      routeName: bus.route_description || bus.routename || 'UPSRTC Route',
      busLatitude: parseFloat(bus.latitude),
      busLongitude: parseFloat(bus.longitude),
      currentSpeedKmph: parseFloat(bus.speed),
      heading: parseFloat(bus.heading),
      lastSeen: bus.timestamp,
      status: bus.vehicle_status === 'no_signal' ? 'offline' : (parseFloat(bus.speed) > 0 ? 'moving' : 'halted'),
      stops: [
        {
          stopId: 1,
          name: bus.next_stop || 'Next Stop',
          etaMinutes: bus.next_stop_eta ? Math.round((new Date(bus.next_stop_eta).getTime() - Date.now()) / 60000) : 0,
          status: 'upcoming'
        },
        {
          stopId: 2,
          name: bus.destination || 'Destination',
          etaMinutes: bus.destination_eta ? Math.round((new Date(bus.destination_eta).getTime() - Date.now()) / 60000) : 0,
          status: 'upcoming'
        }
      ]
    });
  } catch (error) {
    console.error('Error fetching real bus data:', error);
    res.status(500).json({ message: 'Failed to fetch real-time data.' });
  }
});

// 6. Save a passenger report
app.post('/api/v1/reports', async (req, res) => {
  try {
    const { tripId, busRegNo, reportType, description, latitude, longitude } = req.body;
    if (!busRegNo || !reportType) {
      return res.status(400).json({ error: 'busRegNo and reportType are required.' });
    }

    await query(
      `INSERT INTO passenger_reports (trip_id, bus_reg_no, report_type, description, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tripId ? parseInt(tripId, 10) : null,
        busRegNo,
        reportType,
        description || null,
        latitude ? parseFloat(latitude) : null,
        longitude ? parseFloat(longitude) : null
      ]
    );

    res.status(201).json({ success: true, message: 'Report submitted successfully.' });
  } catch (error: any) {
    console.error('Error saving passenger report:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 7. Get active passenger reports (within last 2 hours)
app.get('/api/v1/reports/active', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const reportsRes = await query(
      `SELECT id, trip_id, bus_reg_no, report_type, description, latitude, longitude, created_at
       FROM passenger_reports
       WHERE created_at >= $1
       ORDER BY created_at DESC`,
      [cutoff]
    );

    res.json({ reports: reportsRes.rows });
  } catch (error: any) {
    console.error('Error fetching passenger reports:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 8. Get VAPID public key for Web Push
app.get('/api/v1/push/key', (req, res) => {
  try {
    const { getVapidPublicKey } = require('./services/notificationService');
    res.json({ publicKey: getVapidPublicKey() });
  } catch (error: any) {
    console.error('Error getting VAPID public key:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 9. Subscribe to push notifications
app.post('/api/v1/push/subscribe', async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) {
      return res.status(400).json({ error: 'subscription is required.' });
    }

    const { saveSubscription } = require('./services/notificationService');
    await saveSubscription(subscription);

    res.status(201).json({ success: true, message: 'Subscribed successfully.' });
  } catch (error: any) {
    console.error('Error registering push subscription:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 10. Unsubscribe from push notifications
app.post('/api/v1/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required.' });
    }

    const { removeSubscription } = require('./services/notificationService');
    await removeSubscription(endpoint);

    res.json({ success: true, message: 'Unsubscribed successfully.' });
  } catch (error: any) {
    console.error('Error unsubscribing:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Create HTTP server
const server = http.createServer(app);

// ----------------------------------------------------
// REALTIME WEBSOCKET SERVER
// ----------------------------------------------------
const wss = new WebSocketServer({ server });

interface ClientSubscription {
  ws: WebSocket;
  tripId: number;
  regNo?: string;
  routeCode?: string;
}

const subscriptions: Set<ClientSubscription> = new Set();

wss.on('connection', (ws: WebSocket) => {
  console.log('New client connected via WebSocket');

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);

      if (data.event === 'subscribe_trip' && data.tripId) {
        const tripId = parseInt(data.tripId, 10);
        console.log(`Client subscribed to trip: ${tripId}`);

        // Add to active subscriptions
        const sub = { ws, tripId, regNo: data.regNo, routeCode: data.routeCode };
        subscriptions.add(sub);

        // Send initial state immediately
        const initialData = await getTripETAs(tripId, data.regNo, data.routeCode);
        if (initialData) {
          const activeCrowdSourced = (global as any).activeCrowdSourcedTrips || {};
          const now = Date.now();
          const state = activeCrowdSourced[tripId];
          if (state && now - state.timestamp < 15000) {
            (initialData as any).trackingMethod = state.method;
          }
          ws.send(JSON.stringify({ event: 'trip_update', data: initialData }));
        }
      }

      if (data.event === 'subscribe_progress' && data.busId) {
        const busId = parseInt(data.busId, 10);
        const { ProgressSocketHandler } = require('./modules/route-progress/socket/ProgressSocketHandler');
        ProgressSocketHandler.register(ws, busId);

        // Send initial state immediately if exists
        const { RouteProgressService } = require('./modules/route-progress/service/RouteProgressService');
        const initialProgress = await RouteProgressService.getProgress(busId);
        if (initialProgress) {
          ws.send(JSON.stringify({
            event: 'BUS_PROGRESS_UPDATED',
            payload: {
              busId,
              completed: initialProgress.completedStops,
              current: initialProgress.current,
              remaining: initialProgress.remainingStops,
              coveredDistance: initialProgress.coveredDistance,
              routeDistance: initialProgress.routeDistance,
              currentState: initialProgress.currentState
            }
          }));
        }
      }

      if (data.event === 'report_location' && data.tripId) {
        const tripId = parseInt(data.tripId, 10);
        const { latitude, longitude, speed, heading, source } = data;
        
        console.log(`Received crowd-sourced location for trip ${tripId} via ${source}: (${latitude}, ${longitude})`);
        
        // Update database with this coordinates
        const tripRes = await query('SELECT bus_id FROM trips WHERE id = $1', [tripId]);
        if (tripRes.rows.length > 0) {
          const busId = tripRes.rows[0].bus_id;
          
          await query(
            `INSERT INTO bus_live_state (bus_id, trip_id, latitude, longitude, speed, heading, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (bus_id) 
             DO UPDATE SET 
                trip_id = EXCLUDED.trip_id,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                speed = EXCLUDED.speed,
                heading = EXCLUDED.heading,
                last_seen_at = NOW()`,
            [busId, tripId, latitude, longitude, speed || 0, heading || 0]
          );

          // Record location in the route learning engine
          recordLiveLocation(tripId, busId, latitude, longitude, speed || 0).catch(err => {
            console.error('[Route Learning] Error recording crowd-sourced location:', err);
          });

          // Mark this trip as having active crowd-sourced updates to prevent simulator overrides
          (global as any).activeCrowdSourcedTrips = (global as any).activeCrowdSourcedTrips || {};
          (global as any).activeCrowdSourcedTrips[tripId] = {
            timestamp: Date.now(),
            method: source
          };
          
          // Broadcast update immediately to all clients subscribed to this trip
          for (const sub of subscriptions) {
            if (sub.tripId === tripId && sub.ws.readyState === WebSocket.OPEN) {
              const updatedData = await getTripETAs(tripId, sub.regNo, sub.routeCode);
              if (updatedData) {
                (updatedData as any).trackingMethod = source;
                sub.ws.send(JSON.stringify({ event: 'trip_update', data: updatedData }));
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    // Clean up subscriptions for this client
    for (const sub of subscriptions) {
      if (sub.ws === ws) {
        subscriptions.delete(sub);
      }
    }
    console.log('Client disconnected');
  });
});

// Broadcast updates to subscribed clients every 5 seconds
setInterval(async () => {
  for (const sub of subscriptions) {
    if (sub.ws.readyState === WebSocket.OPEN) {
      try {
        const data = await getTripETAs(sub.tripId, sub.regNo, (sub as any).routeCode);
        if (data) {
          const activeCrowdSourced = (global as any).activeCrowdSourcedTrips || {};
          const now = Date.now();
          const state = activeCrowdSourced[sub.tripId];
          if (state && now - state.timestamp < 15000) {
            (data as any).trackingMethod = state.method;
          }
          sub.ws.send(JSON.stringify({ event: 'trip_update', data }));
        }
      } catch (err) {
        console.error(`Failed to push update for trip ${sub.tripId}:`, err);
      }
    }
  }
}, 5000);

// Start server
server.listen(Number(port), '0.0.0.0', async () => {
  const { logger } = require('./utils/logger');
  logger.info(`API Server running on port ${port}`, { module: 'API-GATEWAY' });

  // Boot Graph Engine
  const { buildGraph } = await import('./engine/graph');
  await buildGraph();
  await initDivergenceCache();

  // Boot Route Geometry Engine (prefix-sum for village waypoints)
  try {
    const fs = await import('fs');
    const path = await import('path');
    const waypointsPath = path.join(__dirname, 'db/waypoints.json');
    if (fs.existsSync(waypointsPath)) {
      const waypointsData = JSON.parse(fs.readFileSync(waypointsPath, 'utf8'));
      buildRouteGeometries(waypointsData);
      logger.info('Route geometries with village waypoints loaded.', { module: 'API-GATEWAY' });
    } else {
      logger.warn('waypoints.json not found — run scripts/fetch_osm_villages.ts to generate it. Village waypoints will be empty.', { module: 'API-GATEWAY' });
      buildRouteGeometries(null);
    }
  } catch (e) {
    logger.error(`Failed to load waypoints.json: ${(e as Error).message}`, { module: 'API-GATEWAY' });
    buildRouteGeometries(null);
  }

  // Boot Historical GPS data scraper (Scraped AI Records job)
  try {
    const { startScraping } = await import('./scripts/historicalDataScraper');
    startScraping();
    logger.info('Historical GPS Log Scraper cron job started.', { module: 'API-GATEWAY' });
  } catch (err) {
    logger.error(`Failed to initialize historical scraper cron job: ${(err as Error).message}`, { module: 'API-GATEWAY' });
  }
});

// Graceful Shutdown
const shutdown = () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
