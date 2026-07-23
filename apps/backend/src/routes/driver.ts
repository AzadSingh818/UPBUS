import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// POST /api/v1/driver/location
// Receives live GPS pings from the Driver App
router.post('/location', async (req: Request, res: Response): Promise<void> => {
  try {
    const { busRegNo, routeCode, latitude, longitude, speed, heading } = req.body;

    if (!busRegNo || latitude === undefined || longitude === undefined) {
      res.status(400).json({ error: 'Missing required fields: busRegNo, latitude, longitude' });
      return;
    }

    const cleanRegNo = busRegNo.trim().toUpperCase().replace(/\s+/g, '');

    // 1. Find or create bus
    let busRes = await query('SELECT id FROM buses WHERE registration_no = $1', [cleanRegNo]);
    let busId: number;

    if (busRes.rows.length === 0) {
      const insertBus = await query(
        'INSERT INTO buses (registration_no, bus_type, depot_name) VALUES ($1, $2, $3) RETURNING id',
        [cleanRegNo, 'Private', 'Private Vendor']
      );
      busId = insertBus.rows[0].id;
    } else {
      busId = busRes.rows[0].id;
    }

    // 2. Find or create trip
    let tripRes = await query(
      "SELECT id FROM trips WHERE bus_id = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 1",
      [busId]
    );
    let tripId: number;

    if (tripRes.rows.length === 0) {
      // Find route id if routeCode was provided
      let routeId = null;
      if (routeCode) {
        const routeRes = await query('SELECT id FROM routes WHERE route_code = $1', [routeCode]);
        if (routeRes.rows.length > 0) {
          routeId = routeRes.rows[0].id;
        }
      }

      const insertTrip = await query(
        "INSERT INTO trips (bus_id, route_id, scheduled_start, status) VALUES ($1, $2, NOW(), 'running') RETURNING id",
        [busId, routeId]
      );
      tripId = insertTrip.rows[0].id;
    } else {
      tripId = tripRes.rows[0].id;
    }

    // 3. Upsert into bus_live_state
    await query(
      `INSERT INTO bus_live_state (bus_id, trip_id, latitude, longitude, speed, heading, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (bus_id) DO UPDATE SET
         trip_id = EXCLUDED.trip_id,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         speed = EXCLUDED.speed,
         heading = EXCLUDED.heading,
         last_seen_at = EXCLUDED.last_seen_at`,
      [busId, tripId, latitude, longitude, speed || 0, heading || 0]
    );

    res.json({ success: true, tripId, busId });
  } catch (error) {
    console.error('[Driver API] Error processing location:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
