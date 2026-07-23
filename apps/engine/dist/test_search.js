"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graph_1 = require("./engine/graph");
async function run() {
    await (0, graph_1.buildGraph)();
    const from = 'Muzaffar';
    const to = 'Bijnor';
    console.log(`Searching paths from "${from}" to "${to}"...`);
    const paths = (0, graph_1.findPathsDFS)(from, to, 2);
    console.log(`Found ${paths.length} paths:`);
    paths.forEach((p, idx) => {
        console.log(`\nPath #${idx + 1}: Distance = ${p.totalDistanceKm.toFixed(1)} km, Transfers = ${p.totalTransfers}`);
        p.legs.forEach((l, lIdx) => {
            console.log(`  Leg ${lIdx + 1}: ${l.fromStopName} -> ${l.toStopName} via "${l.routeName}" (${l.distanceKm.toFixed(1)} km)`);
        });
    });
}
run();
