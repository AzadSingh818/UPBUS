"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
async function checkDatabaseStats() {
    try {
        const stopsCount = db_1.mockDb.stops.length;
        const routesCount = db_1.mockDb.routes.length;
        const routeStopsCount = db_1.mockDb.route_stops.length;
        const busesCount = db_1.mockDb.buses.length;
        const tripsCount = db_1.mockDb.trips.length;
        // Check how many learned route variations are there
        // Learned route variations have id > 300 or are VAR or contain custom name segments
        const learnedRoutes = db_1.mockDb.routes.filter((r) => (r.route_code || '').includes('VAR') ||
            (r.route_code || '').includes('LEARNED') ||
            r.id > 300);
        console.log('=== DATABASE STATS ===');
        console.log(`Stops:          ${stopsCount}`);
        console.log(`Routes:         ${routesCount}`);
        console.log(`Route Stops:    ${routeStopsCount}`);
        console.log(`Buses:          ${busesCount}`);
        console.log(`Trips:          ${tripsCount}`);
        console.log(`Learned Route Variations: ${learnedRoutes.length}`);
        if (learnedRoutes.length > 0) {
            console.log('\n--- SAMPLE LEARNED ROUTES ---');
            learnedRoutes.slice(0, 10).forEach((r) => {
                console.log(`- [${r.id}] ${r.route_name} (${r.route_code}) - ${r.distance_km} km`);
            });
        }
    }
    catch (err) {
        console.error('Error running stats check:', err.message || err);
    }
}
checkDatabaseStats();
