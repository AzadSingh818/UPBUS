import { query } from '../db';
import { getGraph, getStopsMap, getRouteStopsMap, addLiveRouteEdges } from '../engine/graph';
import { adminMonitor } from './adminMonitor';

/**
 * Zero-Touch New Bus Onboarding Engine
 * ======================================
 * Automatically detects, registers, and routes any bus that appears on the
 * Margdarshi API for the very first time — no manual setup required.
 *
 * Flow:
 *   1. adapter_live.ts calls checkAndTrack(regNo, busId) for every ingested bus.
 *   2. If this is the FIRST time we've seen this regNo → mark as "pending discovery".
 *   3. GPS pings from pending buses are buffered in a trajectory cache.
 *   4. After MIN_PINGS pings, RouteMatchEngine scores all known routes by proximity.
 *   5. Best match (score ≥ MIN_VOTE_SCORE) is assigned to the bus's trip.
 *   6. Graph edges for that route are activated (addLiveRouteEdges).
 *   7. Admin monitor receives a NEW_BUS alert with route info.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum pings to collect before attempting route match */
const MIN_PINGS = 5;

/** Minimum proximity votes needed to accept a route match */
const MIN_VOTE_SCORE = 3;

/** Max GPS distance in km to count a stop as "hit" by a GPS ping */
const STOP_HIT_RADIUS_KM = 0.5;

/** After this many ms without being resolved, drop a pending bus to free memory */
const PENDING_BUS_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

interface GPSPoint {
  lat: number;
  lng: number;
  ts: number;
}

interface PendingBus {
  busId: number;
  regNo: string;
  tripId: number;
  trajectory: GPSPoint[];
  firstSeenAt: number;
  resolved: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class NewBusDiscoveryService {
  /**
   * regNos that have been seen at least once. Populated from DB on first call.
   * A bus is "known" once it appears here — subsequent pings just update location.
   */
  private knownRegNos = new Set<string>();

  /** Buses that have been seen but whose route hasn't been confirmed yet. */
  private pendingBuses = new Map<number, PendingBus>(); // busId → PendingBus

  private initialized = false;

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Load all existing registration numbers from DB once on first call.
   * After this, any regNo NOT in the set is a brand-new bus.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      const res = await query('SELECT registration_no FROM buses');
      for (const row of res.rows) {
        if (row.registration_no) this.knownRegNos.add(row.registration_no);
      }
      console.log(`[NewBusDiscovery] Initialized with ${this.knownRegNos.size} known buses.`);
    } catch (e) {
      console.error('[NewBusDiscovery] Could not load known buses:', e);
    }
    this.initialized = true;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Called by adapter_live.ts for every GPS packet that has been ingested.
   *
   * @param regNo    Bus registration number (e.g., "UP12LM1234")
   * @param busId    Internal numeric bus ID (already in DB)
   * @param tripId   Active trip ID for this bus
   * @param lat      Current latitude
   * @param lng      Current longitude
   */
  async checkAndTrack(
    regNo: string,
    busId: number,
    tripId: number,
    lat: number,
    lng: number
  ): Promise<void> {
    await this.ensureInitialized();

    const isNewBus = !this.knownRegNos.has(regNo);

    if (isNewBus) {
      // Mark as known so subsequent pings don't re-trigger the "first time" flow
      this.knownRegNos.add(regNo);

      console.log(`[NewBusDiscovery] 🆕 NEW BUS FIRST SEEN: ${regNo} (busId=${busId})`);
      adminMonitor.addLog({
        type: 'NEW_BUS',
        busId,
        regNo,
        message: `New bus detected on Margdarshi API: ${regNo} — collecting trajectory for route auto-detection.`,
      });

      // Start tracking this bus's trajectory for route discovery
      this.pendingBuses.set(busId, {
        busId,
        regNo,
        tripId,
        trajectory: [],
        firstSeenAt: Date.now(),
        resolved: false,
      });
    }

    // If this bus is pending route discovery, record its GPS ping
    const pending = this.pendingBuses.get(busId);
    if (pending && !pending.resolved) {
      pending.trajectory.push({ lat, lng, ts: Date.now() });

      // Attempt route match once we have enough pings
      if (pending.trajectory.length >= MIN_PINGS) {
        await this.attemptRouteMatch(pending);
      }
    }

    // Periodically clean up old unresolved pending buses to free memory
    this.cleanupStalePending();
  }

  // ── Route Matching ──────────────────────────────────────────────────────────

  /**
   * Core route matching algorithm using proximity voting.
   *
   * For each GPS point in the trajectory, we check ALL route_stops of ALL routes.
   * Each route_stop that lies within STOP_HIT_RADIUS_KM of a GPS point earns 1 vote
   * for its parent route. The route with the highest vote total wins.
   *
   * This works because a bus travelling a route will naturally pass near all its stops.
   */
  private async attemptRouteMatch(pending: PendingBus): Promise<void> {
    try {
      const stopsMap = getStopsMap();
      const routeStopsMap = getRouteStopsMap();

      if (stopsMap.size === 0 || routeStopsMap.size === 0) {
        // Graph not built yet — retry on next ping
        return;
      }

      // Vote counter: routeId → vote count
      const votes = new Map<number, number>();

      for (const gpsPoint of pending.trajectory) {
        // Check this GPS point against every route_stop of every route
        for (const [routeId, rStops] of routeStopsMap.entries()) {
          for (const rs of rStops) {
            const stop = stopsMap.get(rs.stop_id);
            if (!stop) continue;

            const dist = haversineKm(gpsPoint.lat, gpsPoint.lng, stop.latitude, stop.longitude);
            if (dist <= STOP_HIT_RADIUS_KM) {
              votes.set(routeId, (votes.get(routeId) || 0) + 1);
              break; // Only count 1 hit per route per GPS point to avoid bias
            }
          }
        }
      }

      if (votes.size === 0) {
        // No hits yet — wait for more pings
        return;
      }

      // Find the route with the most votes
      let bestRouteId = -1;
      let bestScore = 0;
      for (const [routeId, score] of votes.entries()) {
        if (score > bestScore) {
          bestScore = score;
          bestRouteId = routeId;
        }
      }

      if (bestScore < MIN_VOTE_SCORE) {
        // Not confident enough yet — collect more pings
        console.log(
          `[NewBusDiscovery] Bus ${pending.regNo}: best route candidate r=${bestRouteId} ` +
          `with only ${bestScore} votes (need ${MIN_VOTE_SCORE}). Collecting more pings...`
        );
        return;
      }

      // ── Route confirmed ─────────────────────────────────────────────────────
      await this.confirmRoute(pending, bestRouteId, bestScore);
    } catch (err) {
      console.error(`[NewBusDiscovery] Route match error for bus ${pending.regNo}:`, err);
    }
  }

  /**
   * Confirm and apply the matched route to the bus's trip.
   * Updates DB, activates graph edges, and fires admin alerts.
   */
  private async confirmRoute(
    pending: PendingBus,
    routeId: number,
    score: number
  ): Promise<void> {
    // Fetch route info for logging
    let routeName = `Route-${routeId}`;
    let routeCode = `R_${routeId}`;
    try {
      const routeRes = await query('SELECT route_code, route_name FROM routes WHERE id = $1', [routeId]);
      if (routeRes.rows.length > 0) {
        routeCode = routeRes.rows[0].route_code || routeCode;
        routeName = routeRes.rows[0].route_name || routeName;
      }
    } catch (_) {}

    console.log(
      `[NewBusDiscovery] ✅ Route CONFIRMED for bus ${pending.regNo}: ` +
      `"${routeName}" (routeId=${routeId}, score=${score} votes)`
    );

    // 1. Update the trip's route_id in the database
    try {
      await query(
        "UPDATE trips SET route_id = $1 WHERE id = $2 AND status = 'running'",
        [routeId, pending.tripId]
      );
    } catch (dbErr) {
      console.error(`[NewBusDiscovery] Failed to update trip ${pending.tripId} route:`, dbErr);
    }

    // 2. Ensure this route's edges are in the live graph
    // (No-op if already present; adds edges if this is a newly discovered route)
    await addLiveRouteEdges(routeId);

    // 3. Update admin monitor with the confirmed route details
    adminMonitor.updateBus(pending.busId, pending.regNo, {
      routeCode,
      routeName,
      currentStop: 'Route auto-matched',
      status: 'MOVING',
    });

    adminMonitor.addLog({
      type: 'NEW_BUS',
      busId: pending.busId,
      regNo: pending.regNo,
      message: `✅ New bus ${pending.regNo} auto-matched to route "${routeName}" after ${score} GPS confirmations.`,
    });

    // 4. Mark as resolved and clean up trajectory buffer
    pending.resolved = true;
    pending.trajectory = []; // Free memory
  }

  // ── Memory Management ───────────────────────────────────────────────────────

  /**
   * Remove pending buses that have been unresolved for too long.
   * This prevents memory leaks if a bus only sends a few pings then goes silent.
   */
  private cleanupStalePending(): void {
    const now = Date.now();
    for (const [busId, pending] of this.pendingBuses.entries()) {
      if (pending.resolved || now - pending.firstSeenAt > PENDING_BUS_TTL_MS) {
        this.pendingBuses.delete(busId);
      }
    }
  }

  /** How many buses are currently in the pending-discovery queue */
  getPendingCount(): number {
    return this.pendingBuses.size;
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const newBusDiscovery = new NewBusDiscoveryService();
