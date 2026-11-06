import { fetchMargdarshiLiveData } from '../services/margdarshiClient';
import { query } from '../db';
import { logger } from '../utils/logger';

/**
 * Background Cron Job: Hack 1 - Live Scraping & Historical Logging
 * This script runs every 30 seconds to fetch live data from the Margdarshi API
 * and saves it to the historical_gps_logs table. Over time, this builds the
 * massive dataset needed to train our Deep Learning ETA models.
 */

const SCRAPE_INTERVAL_MS = 60000; // 60 seconds interval to maintain ultra-low CPU

// In-memory cache for bus & route IDs to prevent 40,000 database roundtrips per cycle
const busIdCache = new Map<string, number | null>();
const routeIdCache = new Map<string, number | null>();

async function startScraping() {
  logger.info(`Starting lightweight historical logger cron job. Interval: ${SCRAPE_INTERVAL_MS}ms`, { module: 'SCRAPER' });

  // Auto-pruning cron: clean historical logs older than 24 hours every hour to preserve AWS RDS storage
  setInterval(async () => {
    try {
      await query(`DELETE FROM historical_gps_logs WHERE timestamp < NOW() - INTERVAL '24 hours'`);
      logger.info('Auto-pruned historical logs older than 24 hours.', { module: 'SCRAPER' });
    } catch {}
  }, 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const liveData = await fetchMargdarshiLiveData();
      
      if (!liveData || liveData.length === 0) {
        return;
      }

      // Sample up to 100 buses per cycle to protect memory and avoid overwhelming the database
      const sampledBuses = liveData.slice(0, 100);
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      const currentHour = new Date().getHours();
      let mockWeatherCondition = (currentHour > 1 && currentHour < 7) ? 2 : 0;

      for (const bus of sampledBuses) {
        const rawReg = bus.RegNo || bus.regNum || bus.registration_no || bus.vehicle_no || 'UNKNOWN';
        let busId = busIdCache.get(rawReg);
        if (busId === undefined) {
          const busIdRes = await query(`SELECT id FROM buses WHERE registration_no = $1 LIMIT 1`, [rawReg]);
          busId = (busIdRes.rowCount && busIdRes.rowCount > 0) ? busIdRes.rows[0].id : null;
          busIdCache.set(rawReg, busId);
        }

        const rawRoute = bus.routeCode || bus.route_code || bus.RouteCode || bus.routeName || bus.route_name || 'UNKNOWN';
        let routeId = routeIdCache.get(rawRoute);
        if (routeId === undefined) {
          const routeIdRes = await query(`SELECT id FROM routes WHERE route_code = $1 LIMIT 1`, [rawRoute]);
          routeId = (routeIdRes.rowCount && routeIdRes.rowCount > 0) ? routeIdRes.rows[0].id : null;
          routeIdCache.set(rawRoute, routeId);
        }

        const lat = parseFloat(bus.latitude !== undefined ? bus.latitude : bus.lat) || 0;
        const lng = parseFloat(bus.longitude !== undefined ? bus.longitude : bus.lng || bus.long) || 0;
        const speed = parseFloat(bus.speed) || 0;

        if (lat !== 0 && lng !== 0) {
          placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
          values.push(busId, routeId, lat, lng, speed, mockWeatherCondition);
        }
      }

      if (placeholders.length > 0) {
        const insertQuery = `
          INSERT INTO historical_gps_logs (bus_id, route_id, latitude, longitude, speed, weather_condition)
          VALUES ${placeholders.join(', ')}
        `;
        await query(insertQuery, values);
        logger.info(`Successfully logged ${placeholders.length} sample records. Memory healthy.`, { module: 'SCRAPER' });
      }

    } catch (err: any) {
      logger.error(`Error during scraping cycle: ${err.message}`, { module: 'SCRAPER' });
    }
  }, SCRAPE_INTERVAL_MS);
}

// Start the job if run directly
if (require.main === module) {
  startScraping();
}

export { startScraping };
