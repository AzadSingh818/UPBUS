import { query } from './db';

async function inspect() {
  try {
    const stopsCount = await query('SELECT COUNT(*) as count FROM stops');
    const routesCount = await query('SELECT COUNT(*) as count FROM routes');
    const autoRoutes = await query("SELECT id, route_code, route_name, source, destination, distance_km FROM routes WHERE route_code LIKE 'R_AUTO_%' LIMIT 10");
    const newStops = await query("SELECT id, stop_code, name FROM stops WHERE stop_code LIKE 'S_AUTO_%' LIMIT 10");

    console.log('=========================================');
    console.log('SEEDER DB INSPECTION RESULTS');
    console.log('=========================================');
    console.log(`Total Stops in DB: ${stopsCount.rows[0]?.count || 0}`);
    console.log(`Total Routes in DB: ${routesCount.rows[0]?.count || 0}`);
    console.log(`Discovered Auto-Routes count: ${autoRoutes.rowCount || 0}`);
    console.log(`Discovered Auto-Stops count: ${newStops.rowCount || 0}`);
    
    if (autoRoutes.rows.length > 0) {
      console.log('\n--- Sample Discovered Routes ---');
      autoRoutes.rows.forEach(r => {
        console.log(`- [${r.route_code}] ${r.route_name} (${r.distance_km} km)`);
      });
    }

    if (newStops.rows.length > 0) {
      console.log('\n--- Sample Discovered Stops ---');
      newStops.rows.forEach(s => {
        console.log(`- [${s.stop_code}] ${s.name}`);
      });
    }
    console.log('=========================================');
  } catch (error) {
    console.error('Error querying DB:', error);
  }
}

inspect();
