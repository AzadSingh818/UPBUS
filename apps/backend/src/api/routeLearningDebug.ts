import { Router } from 'express';
import { recordLiveLocation, completeTripAndLearnRoute, visitedStopsMap } from '../engine/routeLearning';
import { query } from '../db';

export const router = Router();

// 1. Ping location for a trip manually
router.post('/ping', async (req, res) => {
  const { tripId, latitude, longitude, speed } = req.body;
  if (!tripId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'tripId, latitude, and longitude are required' });
  }

  try {
    const tripRes = await query('SELECT bus_id FROM trips WHERE id = $1', [parseInt(tripId, 10)]);
    const busId = tripRes.rowCount ? tripRes.rows[0].bus_id : 0;
    await recordLiveLocation(parseInt(tripId, 10), busId, parseFloat(latitude), parseFloat(longitude), parseFloat(speed || 0));
    const currentVisited = visitedStopsMap.get(parseInt(tripId, 10)) || [];
    res.json({ success: true, currentVisited });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Complete trip and force learning manually
router.post('/complete', async (req, res) => {
  const { tripId } = req.body;
  if (!tripId) {
    return res.status(400).json({ error: 'tripId is required' });
  }

  try {
    await completeTripAndLearnRoute(parseInt(tripId, 10));
    res.json({ success: true, message: `Completed and processed trip ${tripId}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get visited stops for a specific trip
router.get('/visited', async (req, res) => {
  const tripIdStr = req.query.tripId as string;
  if (!tripIdStr) {
    return res.status(400).json({ error: 'tripId is required as query parameter' });
  }

  const tripId = parseInt(tripIdStr, 10);
  const visitedStopIds = visitedStopsMap.get(tripId) || [];

  try {
    const stopsRes = await query('SELECT id, name, latitude, longitude FROM stops');
    const stopsById = new Map<number, any>(stopsRes.rows.map(s => [s.id, s]));
    const traversed = visitedStopIds.map(id => stopsById.get(id)).filter(Boolean);
    res.json({ tripId, visitedStopIds, traversed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get all currently tracked trips
router.get('/visited/all', (req, res) => {
  const all: Record<number, number[]> = {};
  for (const [tripId, visited] of visitedStopsMap.entries()) {
    all[tripId] = visited;
  }
  res.json({ trackedTrips: all });
});
