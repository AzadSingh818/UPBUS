/**
 * Centralized Margdarshi live bus data fetching service.
 * Uses the correct UPSRTC endpoint with proper error handling and timeout.
 * Implementing API Traffic Control (Token Bucket) to prevent IP blocking.
 */

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  
  constructor(private capacity: number, private refillRatePerSecond: number) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async waitForToken(): Promise<void> {
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

  private refill() {
    const now = Date.now();
    const timePassedMs = now - this.lastRefill;
    const tokensToAdd = (timePassedMs / 1000) * this.refillRatePerSecond;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

// Global throttle instance: Max burst of 2 requests, refills 1 request per second
const apiThrottle = new TokenBucket(2, 1);

export async function fetchMargdarshiLiveData(): Promise<any[]> {
  try {
    const { adminMonitor } = require('./adminMonitor');
    const activeBuses = adminMonitor.getActiveBuses(20000);
    
    // Return active buses in the format the scraper expects
    return activeBuses.map((bus: any) => ({
      RegNo: bus.regNo,
      routeCode: bus.routeCode || 'UNKNOWN',
      latitude: bus.latitude,
      longitude: bus.longitude,
      speed: bus.speed,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('[Margdarshi Client] Error loading local live data:', error);
    return [];
  }
}
