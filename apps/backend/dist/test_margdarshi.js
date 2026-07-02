"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fetch_1 = __importDefault(require("node-fetch"));
async function test() {
    try {
        console.log('Sending request to Margdarshi API...');
        const res = await (0, node_fetch_1.default)('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', {
            method: 'POST',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        console.log('Response status:', res.status);
        const text = await res.text();
        console.log('Response text length:', text.length);
        console.log('First 500 chars of response:', text.slice(0, 500));
        try {
            const data = JSON.parse(text);
            console.log('Parsed successfully! Elements count:', Array.isArray(data) ? data.length : typeof data);
            if (Array.isArray(data) && data.length > 0) {
                console.log('First element:', data[0]);
                const routes = data.map((b) => b.route_description).filter(Boolean);
                console.log(`Routes descriptions found: ${routes.length}. Sample:`, routes.slice(0, 5));
            }
        }
        catch (e) {
            console.error('Failed to parse response JSON:', e);
        }
    }
    catch (error) {
        console.error('Error fetching Margdarshi:', error.message);
    }
}
test();
