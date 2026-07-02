"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const ambehtaStops = db_1.mockDb.stops.filter((s) => s.name.toLowerCase().includes('ambehta'));
const phandpuriStops = db_1.mockDb.stops.filter((s) => s.name.toLowerCase().includes('phandpuri'));
console.log('Ambehta stops in DB:', ambehtaStops);
console.log('Phandpuri stops in DB:', phandpuriStops);
