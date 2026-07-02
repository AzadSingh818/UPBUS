"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fetch_1 = __importDefault(require("node-fetch"));
async function testPhoton(stopName) {
    try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(stopName + ', Uttar Pradesh, India')}&limit=1`;
        console.log(`Querying Photon for: "${stopName}"`);
        console.log(`URL: ${url}`);
        const res = await (0, node_fetch_1.default)(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        console.log('Status:', res.status);
        const data = await res.json();
        if (data && data.features && data.features.length > 0) {
            const geometry = data.features[0].geometry;
            const properties = data.features[0].properties;
            console.log('Resolved:', properties.name, properties.state, 'Coords:', geometry.coordinates);
        }
        else {
            console.log('No features returned.');
        }
    }
    catch (error) {
        console.error('Error:', error.message);
    }
}
async function run() {
    await testPhoton('BAREILLY');
    await testPhoton('KAUSHAMBI');
}
run();
