"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
console.log('=========================================');
console.log('SEEDER DIRECT MOCK DB INSPECTION RESULTS');
console.log('=========================================');
console.log(`Total Stops in Mock DB: ${db_1.mockDb.stops?.length || 0}`);
console.log(`Total Routes in Mock DB: ${db_1.mockDb.routes?.length || 0}`);
const autoRoutes = db_1.mockDb.routes?.filter((r) => r.route_code?.startsWith('R_AUTO_')) || [];
const autoStops = db_1.mockDb.stops?.filter((s) => s.stop_code?.startsWith('S_AUTO_')) || [];
console.log(`Discovered Auto-Routes count: ${autoRoutes.length}`);
console.log(`Discovered Auto-Stops count: ${autoStops.length}`);
if (autoRoutes.length > 0) {
    console.log('\n--- Sample Discovered Routes ---');
    autoRoutes.slice(0, 10).forEach((r) => {
        console.log(`- [${r.route_code}] ${r.route_name} (${r.distance_km} km)`);
    });
}
if (autoStops.length > 0) {
    console.log('\n--- Sample Discovered Stops ---');
    autoStops.slice(0, 10).forEach((s) => {
        console.log(`- [${s.stop_code}] ${s.name} (${s.latitude}, ${s.longitude})`);
    });
}
console.log('=========================================');
