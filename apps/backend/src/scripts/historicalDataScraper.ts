import { fetchMargdarshiLiveData } from '../services/margdarshiClient';
import { query } from '../db';
import { logger } from '../utils/logger';

/**
 * Background Cron Job: Hack 1 - Live Scraping & Historical Logging
 * This script runs every 30 seconds to fetch live data from the Margdarshi API
 * and saves it to the historical_gps_logs table. Over time, this builds the
 * massive dataset needed to train our Deep Learning ETA models.
 */

const SCRAPE_INTERVAL_MS = 30000; // 30 seconds

async function startScraping() {
  logger.info(`Starting cron job. Interval: ${SCRAPE_INTERVAL_MS}ms`, { module: 'SCRAPER' });

  setInterval(async () => {
    try {
      logger.info(`Fetching live data...`, { module: 'SCRAPER' });
      const liveData = await fetchMargdarshiLiveData();
      
      if (!liveData || liveData.length === 0) {
        logger.info(`Scraper waiting for active buses from engine...`, { module: 'SCRAPER' });
        return;
      }

      logger.debug(`Received ${liveData.length} active buses. Logging to DB...`, { module: 'SCRAPER' });

      // We'll batch insert the records to avoid overwhelming the database
      // In production with 10k buses, you might chunk this array.
      
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      // Mock weather logic (in a real system, you'd fetch from a weather API based on Lat/Lng)
      const currentHour = new Date().getHours();
      let mockWeatherCondition = 0; // Clear
      if (currentHour > 1 && currentHour < 7) mockWeatherCondition = 2; // Fog early morning

      for (const bus of liveData) {
        // Extract basic data (Margdarshi API fields might vary, using logical defaults here)
        const rawReg = bus.RegNo || bus.regNum || bus.registration_no || bus.vehicle_no || 'UNKNOWN';
        const busIdRes = await query(`SELECT id FROM buses WHERE registration_no = $1 LIMIT 1`, [rawReg]);
        const busId = busIdRes.rowCount && busIdRes.rowCount > 0 ? busIdRes.rows[0].id : null;

        const rawRoute = bus.routeCode || bus.route_code || bus.RouteCode || bus.routeName || bus.route_name || bus.RouteName || bus.routename || 'UNKNOWN';
        const routeIdRes = await query(`SELECT id FROM routes WHERE route_code = $1 OR route_name ILIKE $2 LIMIT 1`, [rawRoute, `%${rawRoute}%`]);
        const routeId = routeIdRes.rowCount && routeIdRes.rowCount > 0 ? routeIdRes.rows[0].id : null;

        const lat = parseFloat(bus.latitude !== undefined ? bus.latitude : bus.lat) || 0;
        const lng = parseFloat(bus.longitude !== undefined ? bus.longitude : bus.lng || bus.long) || 0;
        const speed = parseFloat(bus.speed) || 0;

        placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
        values.push(busId, routeId, lat, lng, speed, mockWeatherCondition);
      }

      if (placeholders.length > 0) {
        const insertQuery = `
          INSERT INTO historical_gps_logs (bus_id, route_id, latitude, longitude, speed, weather_condition)
          VALUES ${placeholders.join(', ')}
        `;
        await query(insertQuery, values);
        logger.info(`Successfully logged ${placeholders.length} records.`, { module: 'SCRAPER' });
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
