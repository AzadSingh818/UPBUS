import { query } from '../db';
import { recordLiveLocation } from '../engine/routeLearning';
import { RouteProgressEngine } from '../modules/route-progress/service/RouteProgressEngine';

export interface CanonicalVehicleLocation {
  registrationNo: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  timestamp: Date;
  status: 'moving' | 'halted' | 'offline';
}

const { STOPS, simulatedBuses } = require('./simulation_data.json');
let ingestionTimer: NodeJS.Timeout | null = null;

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

export async function ingestLocation(location: CanonicalVehicleLocation) {
  try {
    let busRes = await query('SELECT id FROM buses WHERE registration_no = $1', [location.registrationNo]);
    if (busRes.rows.length === 0) return;
    let busId = busRes.rows[0].id;

    let tripRes = await query(
      "SELECT id FROM trips WHERE bus_id = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 1",
      [busId]
    );
    if (tripRes.rows.length === 0) return;
    let tripId = tripRes.rows[0].id;

    await query(
      `INSERT INTO bus_live_state (bus_id, trip_id, latitude, longitude, speed, heading, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bus_id) 
       DO UPDATE SET 
          trip_id = EXCLUDED.trip_id,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          speed = EXCLUDED.speed,
          heading = EXCLUDED.heading,
          last_seen_at = EXCLUDED.last_seen_at`,
      [busId, tripId, location.latitude, location.longitude, location.speed, location.heading, location.timestamp]
    );

    // Record the location ping in the route learning engine
    recordLiveLocation(tripId, location.latitude, location.longitude, location.speed).catch(err => {
      console.error('[Route Learning] Error recording location ping:', err);
    });

    // Process Route Progress Pipeline
    RouteProgressEngine.process({
      busId,
      latitude: location.latitude,
      longitude: location.longitude,
      speed: location.speed,
      heading: location.heading,
      accuracy: 5,
      timestamp: location.timestamp
    }).catch(err => {
      console.error('[Route Progress Engine] Error processing location update:', err);
    });
  } catch (error) {
    console.error('Error ingesting location:', error);
  }
}

export async function fetchLiveLocations() {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', { method: 'POST' });
    const rawText = await response.text();
    const data = JSON.parse(rawText);

    if (Array.isArray(data)) {
      for (const bus of data) {
        const regNo = bus.RegNo || bus.regNum || bus.bus_id;
        const latVal = bus.latitude !== undefined ? bus.latitude : bus.lat;
        const lngVal = bus.longitude !== undefined ? bus.longitude : bus.long;

        if (!regNo || latVal === undefined || lngVal === undefined) continue;
        const speed = parseFloat(bus.speed) || 0;
        await ingestLocation({
          registrationNo: regNo,
          latitude: parseFloat(latVal),
          longitude: parseFloat(lngVal),
          speed,
          heading: parseFloat(bus.heading) || 0,
          timestamp: bus.LogrecTime || bus.timestamp ? new Date(bus.LogrecTime || bus.timestamp) : new Date(),
          status: speed > 0 ? 'moving' : 'halted'
        });
      }
    }
  } catch (err) {}
}

export function startIngestion() {
  if (ingestionTimer) return;
  fetchLiveLocations();
  ingestionTimer = setInterval(fetchLiveLocations, 2000);
}

export function stopIngestion() {
  if (ingestionTimer) {
    clearInterval(ingestionTimer);
    ingestionTimer = null;
  }
}
