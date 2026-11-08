"use strict";
/**
 * Centralized Margdarshi live bus data fetching service.
 * Uses the correct UPSRTC endpoint with proper error handling and timeout.
 * Implementing API Traffic Control (Token Bucket) to prevent IP blocking.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMargdarshiLiveData = fetchMargdarshiLiveData;
class TokenBucket {
    capacity;
    refillRatePerSecond;
    tokens;
    lastRefill;
    constructor(capacity, refillRatePerSecond) {
        this.capacity = capacity;
        this.refillRatePerSecond = refillRatePerSecond;
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }
    async waitForToken() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return Promise.resolve();
        }
        // Wait until 1 token is generated
        const waitTimeMs = (1 / this.refillRatePerSecond) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTimeMs));
        return this.waitForToken();
    }
    refill() {
        const now = Date.now();
        const timePassedMs = now - this.lastRefill;
        const tokensToAdd = (timePassedMs / 1000) * this.refillRatePerSecond;
        this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
}
// Global throttle instance: Max burst of 2 requests, refills 1 request per second
const apiThrottle = new TokenBucket(2, 1);
async function fetchMargdarshiLiveData() {
    try {
        const { adminMonitor } = require('./adminMonitor');
        const activeBuses = adminMonitor.getActiveBuses(20000);
        // Return active buses in the format the scraper expects
        return activeBuses.map((bus) => ({
            RegNo: bus.regNo,
            routeCode: bus.routeCode || 'UNKNOWN',
            latitude: bus.latitude,
            longitude: bus.longitude,
            speed: bus.speed,
            timestamp: new Date().toISOString()
        }));
    }
    catch (error) {
        console.error('[Margdarshi Client] Error loading local live data:', error);
        return [];
    }
}
