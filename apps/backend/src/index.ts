import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { query } from './db';
import { startIngestion, stopIngestion } from './ingestion/adapter_live';
import { startRouteSeeder, stopRouteSeeder } from './engine/routeSeeder';
import { getTripETAs } from './engine/eta';
import { buildRouteGeometries, dumpGeometrySummary, getRouteGeometry } from './engine/routeGeometry';
import { initDivergenceCache } from './engine/divergenceBinding';
import { router as routeVillagesRouter } from './api/routeVillages';
import { fetchMargdarshiLiveData } from './services/margdarshiClient';
import { router as routeLearningDebugRouter } from './api/routeLearningDebug';
import { router as adminRouter } from './api/admin';
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

app.use(cors());
app.use(express.json());

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
    const liveData = await fetchMargdarshiLiveData();

    for (const path of directPaths) {
      const leg = path.legs[0]; // 0 transfers means exactly 1 leg
      const missedTrips: any[] = [];
      const nextTrips: any[] = [];

      let routeSource = '';
      let routeDest = '';
      try {
        const routeRes = await query(`SELECT source, destination FROM routes WHERE route_code = $1 LIMIT 1`, [leg.routeCode]);
        if (routeRes.rowCount && routeRes.rowCount > 0) {
          routeSource = routeRes.rows[0].source;
          routeDest = routeRes.rows[0].destination;
        }
      } catch (dbErr) {
        console.error('Error fetching route details for search matching:', dbErr);
      }

      if (Array.isArray(liveData)) {
        // Filter buses for this specific route or the long route containing this leg
        const matchedBuses = liveData.filter(b => {
           const routeStr = (b.route_description || b.routename || '').toUpperCase();
           const fromStr = (from as string).toUpperCase();
           const toStr = (to as string).toUpperCase();
           const directMatch = routeStr.includes(fromStr) && routeStr.includes(toStr);
           if (directMatch) return true;

           if (leg.allRoutes && leg.allRoutes.length > 0) {
             return leg.allRoutes.some(r => {
               return doesBusRouteMatch(routeStr, r.routeName, r.source, r.destination);
             });
           }

           if (routeSource && routeDest) {
             return doesBusRouteMatch(routeStr, leg.routeName, routeSource, routeDest);
           }
           return false;
        });

        for (const bus of matchedBuses) {
           let etaMinutes = 0;
           if (bus.next_stop_eta) {
             etaMinutes = Math.max(0, Math.round((new Date(bus.next_stop_eta).getTime() - Date.now()) / 60000));
           } else if (bus.delay) {
             etaMinutes = Math.round(parseFloat(bus.delay));
           }
           if (isNaN(etaMinutes) || etaMinutes < 0) etaMinutes = 0;

           let actualRouteCode = leg.routeCode;
           let actualRouteName = leg.routeName;

           if (leg.allRoutes && leg.allRoutes.length > 0) {
             let bestScore = -1;
             let bestRoute = leg.allRoutes[0];
             const routeStr = (bus.route_description || bus.routename || '').toUpperCase();
             for (const r of leg.allRoutes) {
               let score = 0;
               if (routeStr.includes(r.source.toUpperCase()) && routeStr.includes(r.destination.toUpperCase())) {
                 score += 5;
               }
               const keywords = r.routeName.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3 && w !== 'DEPOT' && w !== 'BUS' && w !== 'STAND' && w !== 'EXPRESS' && w !== 'RETURN');
               for (const word of keywords) {
                 if (routeStr.includes(word)) {
                   score += 10;
                 }
               }
               if (score > bestScore) {
                 bestScore = score;
                 bestRoute = r;
               }
             }
             actualRouteCode = bestRoute.routeCode;
             actualRouteName = bestRoute.routeName;
           }
           
           nextTrips.push({
             tripId: Math.floor(Math.random() * 100000), // Random Trip ID for tracking
             busRegNo: bus.RegNo,
             busType: 'UPSRTC',
             routeCode: actualRouteCode,
             routeName: bus.route_description || actualRouteName,
             busLatitude: parseFloat(bus.lat),
             busLongitude: parseFloat(bus.long),
             currentSpeedKmph: parseFloat(bus.speed) || 0,
             heading: parseFloat(bus.heading) || 0,
             lastSeen: bus.LogrecTime ? new Date(bus.LogrecTime).toISOString() : new Date().toISOString(),
             status: 'running',
             // Instead of hardcoding 2 stops, we provide the full sequence of stops from our Graph Path!
             stops: leg.stops.map(s => ({
               stopId: s.stopId,
               name: s.name,
               etaMinutes: etaMinutes, // Basic mock, ETA engine handles actual
               status: 'upcoming'
             })),
             etaToBoardingMinutes: etaMinutes
           });
        }
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

    const liveData = await fetchMargdarshiLiveData();

    // Map all paths to the journey format
    const journeys: any[] = [];
    for (const path of paths) {
      const legs: any[] = [];
      let cumulativeMinutes = 0;
      
      for (const leg of path.legs) {
        let routeSource = '';
        let routeDest = '';
        try {
          const routeRes = await query(`SELECT source, destination FROM routes WHERE route_code = $1 LIMIT 1`, [leg.routeCode]);
          if (routeRes.rowCount && routeRes.rowCount > 0) {
            routeSource = routeRes.rows[0].source;
            routeDest = routeRes.rows[0].destination;
          }
        } catch (dbErr) {
          console.error('Error fetching route details for matching:', dbErr);
        }

        let busInfo: any = null;
        let actualRouteCode = leg.routeCode;
        let actualRouteName = leg.routeName;

        if (Array.isArray(liveData)) {
          busInfo = liveData.find(b => {
             const routeStr = (b.route_description || b.routename || '').toUpperCase();
             const directMatch = routeStr.includes(leg.fromStopName.toUpperCase()) && routeStr.includes(leg.toStopName.toUpperCase());
             if (directMatch) return true;

             if (leg.allRoutes && leg.allRoutes.length > 0) {
               return leg.allRoutes.some(r => {
                 return doesBusRouteMatch(routeStr, r.routeName, r.source, r.destination);
               });
             }

             if (routeSource && routeDest) {
               return doesBusRouteMatch(routeStr, leg.routeName, routeSource, routeDest);
             }
             return false;
          });

          if (busInfo && leg.allRoutes && leg.allRoutes.length > 0) {
             let bestScore = -1;
             let bestRoute = leg.allRoutes[0];
             const routeStr = (busInfo.route_description || busInfo.routename || '').toUpperCase();
             for (const r of leg.allRoutes) {
               let score = 0;
               if (routeStr.includes(r.source.toUpperCase()) && routeStr.includes(r.destination.toUpperCase())) {
                 score += 5;
               }
               const keywords = r.routeName.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3 && w !== 'DEPOT' && w !== 'BUS' && w !== 'STAND' && w !== 'EXPRESS' && w !== 'RETURN');
               for (const word of keywords) {
                 if (routeStr.includes(word)) {
                   score += 10;
                 }
               }
               if (score > bestScore) {
                 bestScore = score;
                 bestRoute = r;
               }
             }
             actualRouteCode = bestRoute.routeCode;
             actualRouteName = bestRoute.routeName;
          }
        }

        const durationMins = Math.round((leg.distanceKm / 40) * 60);

        legs.push({
          routeId: leg.routeId,
          from: leg.fromStopName,
          to: leg.toStopName,
          routeName: actualRouteName,
          routeCode: actualRouteCode,
          busType: 'UPSRTC',
          registrationNo: busInfo ? busInfo.RegNo : 'Scheduled',
          busInfo: busInfo ? {
            trip_id: Math.floor(Math.random() * 100000),
            registration_no: busInfo.RegNo,
            bus_type: 'UPSRTC',
            depot_name: 'Margdarshi Live',
            bus_latitude: parseFloat(busInfo.lat) || null,
            bus_longitude: parseFloat(busInfo.long) || null,
            current_speed_kmph: parseFloat(busInfo.speed) || 0,
            heading: parseFloat(busInfo.heading) || 0
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

    const tripId = parseInt(bus.vehicle_journey_id) || Math.floor(Math.random() * 100000);
    const tripETA = await getTripETAs(tripId, regNo);
    if (tripETA && tripETA.stops.length > 0) {
      return res.json(tripETA);
    }

    res.json({
      tripId: parseInt(bus.vehicle_journey_id) || Math.floor(Math.random() * 100000), // Mock ID for frontend tracking state
      busRegNo: bus.RegNo || bus.regNum,
      busType: 'UPSRTC',
      routeCode: bus.route || 'N/A',
      routeName: bus.route_description || bus.routename || 'Unknown Route',
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
          recordLiveLocation(tripId, latitude, longitude, speed || 0).catch(err => {
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
server.listen(port, async () => {
  console.log(`API Server running on port ${port}`);

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
      console.log('[Startup] Route geometries with village waypoints loaded.');
    } else {
      console.warn('[Startup] waypoints.json not found — run scripts/fetch_osm_villages.ts to generate it. Village waypoints will be empty.');
      buildRouteGeometries(null);
    }
  } catch (e) {
    console.warn('[Startup] Failed to load waypoints.json:', e);
    buildRouteGeometries(null);
  }

  // Boot GPS Ingestion Engine
  startIngestion();

  // Boot Autonomous Route Seeder
  startRouteSeeder();
});

// Graceful Shutdown
const shutdown = () => {
  console.log('Shutting down server...');
  stopIngestion();
  stopRouteSeeder();
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
