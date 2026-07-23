"use strict";
/**
 * Fix bad stop coordinates in data.json
 *
 * Confirmed bad seeded stops with wrong coordinates:
 * - ID 630: SAHARANPUR at (29.445389, 77.30419) — real is ~(29.9857, 77.5041)
 * - ID 1043: SORON at (26.516426, 74.53664) — outside UP entirely
 *
 * Confirmed correct (Wikipedia-verified):
 * - ID 112: Ambehta Peer (29.873, 77.3411) ✅ (Wikipedia: 29.87306°N, 77.34111°E)
 * - ID 110: Phandpuri (29.93, 77.4187) ✅ (corrected earlier)
 * - ID 111: Khera Afgan (29.8943, 77.3718) ✅
 * - ID 19: Saharanpur Depot (29.964, 77.546) ✅ (close to city center)
 * - ID 34: Muzaffarnagar Depot (29.4727, 77.7085) ✅ (Wikipedia matches)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dataPath = path.join(__dirname, 'db/data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const fixes = [
    // SAHARANPUR seeded stop (ID 630): was wrongly placed 63km away
    { id: 630, lat: 29.9857, lng: 77.5041, name: 'SAHARANPUR' },
    // SORON seeded stop (ID 1043): outside UP entirely  
    { id: 1043, lat: 27.8928, lng: 78.7469, name: 'SORON' }
];
let fixedCount = 0;
for (const fix of fixes) {
    const stop = data.stops.find((s) => s.id === fix.id);
    if (stop) {
        console.log(`Fixing Stop [${fix.id}] "${stop.name}":`);
        console.log(`  Before: (${stop.latitude}, ${stop.longitude})`);
        stop.latitude = fix.lat;
        stop.longitude = fix.lng;
        console.log(`  After:  (${stop.latitude}, ${stop.longitude})`);
        fixedCount++;
    }
    else {
        console.log(`Stop [${fix.id}] "${fix.name}" not found in DB`);
    }
}
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`\n✅ Fixed ${fixedCount} stops and saved to data.json`);
