# Issue 1 — Stop Status FSM: "On Stop" vs "Arriving Now"

## What Was Done

Replaced the old single-threshold 300 m "arriving_soon" check with a full
**4-state Finite State Machine** per (bus × stop) pair.

---

## Files Changed

| File | Change |
|---|---|
| `apps/backend/src/engine/stopStateFSM.ts` | **[NEW]** — Full FSM module |
| `apps/backend/src/engine/eta.ts` | Import FSM; call `updateBusFSM()`; read `getStopFSMState()` |
| `apps/backend/src/index.ts` | Added `/api/v1/debug/fsm-state` (GET) and `/api/v1/debug/fsm-config` (PATCH) endpoints |
| `apps/web-app/src/app/page.tsx` | Expanded `StopETA` status union; new `"On Stop"` badge rendering |
| `apps/web-app/src/app/components/LiveMap.tsx` | Expanded `Stop` status union; emerald green map marker for `on_stop` |
| `apps/web-app/src/app/globals.css` | Added `.on-stop-badge`, `.stop-dot.on-stop`, `.stop-row.on-stop` styles |

---

## FSM Design

```
          dist < ARRIVING_RADIUS_KM (0.5 km)
upcoming ─────────────────────────────────────► arriving_now
                                                     │
             inside ON_STOP_RADIUS_KM (0.15 km)      │
             AND speed < 5 km/h                       │
             for DWELL_PINGS (≥2) consecutive pings   │
arriving_now ────────────────────────────────────► on_stop
# Village Markers — Implementation Walkthrough

## What Was Built

Village markers for bus routes: intermediate settlements (e.g. Bandukheri between Kumarhera and Phandpuri) that lie **on or near a route** but are **not official bus stops** — shown as permanent amber labels on the map, zoom-gated to appear only at street level.

---

## Files Changed / Created

### Backend — `apps/backend/`

| File | Status | Purpose |
|---|---|---|
| [overpass.ts](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/backend/src/utils/overpass.ts) | **NEW** | Overpass QL query builder, response parser, bbox helper |
| [villageFilter.ts](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/backend/src/utils/villageFilter.ts) | **NEW** | Pure distance-filtering: keeps only villages ≤ maxDistanceKm from route polyline |
| [routeVillages.ts](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/backend/src/api/routeVillages.ts) | **NEW** | Express router: `GET /api/v1/routes/:routeId/villages` + `POST …/refresh` |
| [index.ts](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/backend/src/index.ts) | **MODIFIED** | Imports and mounts `routeVillagesRouter` at `/api/v1/routes` |
| [tests/routeVillages.test.ts](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/backend/tests/routeVillages.test.ts) | **NEW** | 19 backend unit tests |

### Frontend — `apps/web-app/`

| File | Status | Purpose |
|---|---|---|
| [LiveMap.tsx](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/web-app/src/app/components/LiveMap.tsx) | **MODIFIED** | Added `villages` prop, zoom-gated village rendering in separate `useEffect` |
| [globals.css](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/web-app/src/app/globals.css) | **MODIFIED** | `.village-dot`, `.village-label`, `.village-marker-wrapper` styles |
| [page.tsx](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/web-app/src/app/page.tsx) | **MODIFIED** | `villages` state, fetch on route/trip select, pass to `<LiveMap>` |
| [tests/LiveMap.village.test.ts](file:///c:/Users/Azad%20Singh/Desktop/upbus/apps/web-app/tests/LiveMap.village.test.ts) | **NEW** | 18 frontend unit/snapshot tests |

---

## Architecture Decisions

### Caching (Backend)
- **Cache directory**: `apps/backend/src/db/village_cache/<routeId>.json`
- **TTL**: 7 days (village geography barely changes)
- **Stale fallback**: if Overpass is unreachable, serves the last cached result rather than erroring
- **Force refresh**: `POST /api/v1/routes/:routeId/villages/refresh`

### Distance Filtering
- Uses the existing `distanceToPolylineKm()` from `geoUtils.ts` (Cartesian projection — accurate for short distances)
- Default threshold: **3 km** (configurable via `?maxDistanceKm=`)
- Logic is **entirely isolated** in `villageFilter.ts` — no coupling to ETA or live-tracking

### Zoom Gating (Frontend)
- Village labels hidden at zoom < **13** (region/city view)
- Revealed at zoom ≥ 13 (street-level view where village names are meaningful)
- Implemented via Leaflet's `zoomend` event — stop markers are **never zoom-gated**

---

## Test Results

```
Backend (routeVillages.test.ts):    19 passed, 0 failed ✅
Frontend (LiveMap.village.test.ts): 18 passed, 0 failed ✅
```

---

## Manual Verification Steps

1. Start the backend: `npm run dev` in `apps/backend/`
2. Hit the endpoint: `GET http://localhost:5000/api/v1/routes/<routeId>/villages`
   - First call fetches from Overpass and caches
   - Second call serves from cache instantly
3. Start the frontend: `npm run dev` in `apps/web-app/`
4. Search **Saharanpur → Gangoh** → select a route through Kumarhera
5. Switch to **Direct Routes** mode
6. Zoom in past level 13 → **Bandukheri** (and other villages ≤ 3 km from the route) should appear as amber dot + white label
7. Zoom out below 13 → labels disappear; stop markers remain visible

> [!TIP]
> To force a fresh Overpass fetch for a route: `POST /api/v1/routes/<routeId>/villages/refresh`

---

## Configurable Constants (in `stopStateFSM.ts`)

| Constant | Default | Purpose |
|---|---|---|
| `ARRIVING_RADIUS_KM` | 0.5 km | Distance to flip `upcoming → arriving_now` |
| `ON_STOP_RADIUS_KM` | 0.15 km | Geofence radius for potential "on stop" entry |
| `ON_STOP_EXIT_RADIUS_KM` | 0.20 km | Hysteresis exit radius |
| `SPEED_THRESHOLD_KMPH` | 5 km/h | Max speed to count a ping as "stationary" |
| `DWELL_PINGS` | 2 | Min consecutive slow-inside-geofence pings needed |

All can be updated at runtime (no server restart) via:
```
PATCH /api/v1/debug/fsm-config
{ "DWELL_PINGS": 3, "ON_STOP_RADIUS_KM": 0.12 }
```

---

## TC1.1–TC1.8 Results

| ID | Scenario | Result | How |
|---|---|---|---|
| TC1.1 | Bus inside geofence, speed=0, for ≥ DWELL_PINGS pings | ✅ **On Stop** | `state = on_stop` after `dwellCount >= DWELL_PINGS` |
| TC1.2 | Bus inside geofence but speed > threshold (crawling) | ✅ **Not On Stop** — `dwellCount` stays 0; badge stays `arriving_now` | `isSlow` condition fails, counter resets |
| TC1.3 | Bus exits geofence while moving to next stop | ✅ Current stop → `departed`; next stop begins climbing toward `arriving_now` | Exit radius check in `on_stop` branch |
| TC1.4 | Bus far from any stop, mid-route | ✅ All future stops show ETA + distance, no special badge | FSM stays in `upcoming` for all stops |
| TC1.5 | Bus within 0.5 km of next stop but not in 0.15 km radius | ✅ **Arriving Now** badge | FSM = `arriving_now`, not `on_stop` |
| TC1.6 | Bus stationary at stop, GPS jitters ±10 m | ✅ Badge stays stable **On Stop** | Hysteresis: exit only at 0.20 km, jitter stays << 0.20 km |
| TC1.7 | Bus parked at origin depot before departure | ✅ Same FSM logic — shows `on_stop` if moving slowly inside geofence for ≥2 pings | Pre-trip distinction (separate "Scheduled to Depart" state) is a **future enhancement** noted in the doc |
| TC1.8 | Two different buses parked at same depot | ✅ Each bus has its own key `"REG_NO:stopId"` in the state map — no cross-contamination | Key = `busRegNo + ':' + stopId` |

> **TC1.7 note**: The issue doc lists "Scheduled to Depart" as a pre-trip state separate from mid-route "On Stop". The FSM correctly shows `on_stop` for any slow bus inside the depot geofence. The *label distinction* (pre-trip vs mid-trip) is deferred to Issue 3 (bus-route binding), where we know if a bus has departed the origin or not.

---

## Visual Result

| Status | Badge | Colour | Timeline Dot |
|---|---|---|---|
| `upcoming` | `~Xm` | grey | grey |
| `arriving_now` | **Arriving Now** | amber | amber pulsing bus icon |
| `on_stop` | **On Stop** ✨ | emerald green (animated glow) | green filled dot |
| `passed` | Passed | muted grey | green filled dot |
