"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_live_1 = require("./ingestion/adapter_live");
const routeSeeder_1 = require("./engine/routeSeeder");
const graph_1 = require("./engine/graph");
const routeGeometry_1 = require("./engine/routeGeometry");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function main() {
    console.log('[Engine] Starting Background Engine for UPBus (Live Tracker & Route Learning)...');
    // Handle global uncaught exceptions to prevent crashing the entire worker silently
    process.on('uncaughtException', (err) => {
        console.error('[Engine] ❌ Uncaught Exception:', err);
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[Engine] ❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });
    // Load Graph and Route Geometries
    await (0, graph_1.buildGraph)();
    const waypointsPath = path_1.default.join(__dirname, 'db/waypoints.json');
    if (fs_1.default.existsSync(waypointsPath)) {
        const waypointsData = JSON.parse(fs_1.default.readFileSync(waypointsPath, 'utf8'));
        (0, routeGeometry_1.buildRouteGeometries)(waypointsData);
        console.log('[Engine] Route geometries with village waypoints loaded.');
    }
    else {
        (0, routeGeometry_1.buildRouteGeometries)(null);
    }
    // Boot GPS Ingestion Engine (fetches buses from external source)
    (0, adapter_live_1.startIngestion)();
    // Boot Autonomous Route Seeder (learns routes over time)
    (0, routeSeeder_1.startRouteSeeder)();
}
// Graceful Shutdown
const shutdown = () => {
    console.log('[Engine] Shutting down background workers...');
    (0, adapter_live_1.stopIngestion)();
    (0, routeSeeder_1.stopRouteSeeder)();
    setTimeout(() => {
        console.log('[Engine] Stopped.');
        process.exit(0);
    }, 1000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
main().catch(console.error);
