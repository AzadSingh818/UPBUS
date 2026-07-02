# UPBus Project Documentation

## 📖 Overview
The **UPBus** application is a real‑time bus journey planning platform that helps commuters in Uttar Pradesh find optimal routes, see live bus locations on a map, and understand route variations (e.g., *via Ambehta*, *via Nakur*).  It solves a **real‑life problem**: reducing uncertainty and travel time for daily commuters by providing accurate, live‑updated route information and clear visual cues.

---

## 🏗️ Current Architecture
### Front‑end (Web App – Next.js 16)
- **`src/app/page.tsx`** – main entry point handling search, journey planning and UI rendering.
- **Dynamic route‑division logic** (`getDistinguishingStop`) adds “via <Stop>” badges for routes that diverge/merge.
- **LiveMap component** (Leaflet) visualises bus positions and route polylines.
- **Styling** – vanilla CSS with a premium, dark‑mode‑ready design (gradients, micro‑animations, Google‑Font *Inter*).

### Back‑end (Node/Express – `apps/backend`)
- **Graph engine (`engine/graph.ts`)** – calculates optimal paths and ETA.
- **Ingestion adapter (`src/ingestion/adapter.ts`)** – pulls live GPS data from the UPSRTC API every 10 seconds.
- **Data store** – static route definitions in `src/db/data.json` (used by the graph engine).
- **Live bus data** – the ingestion adapter (`src/ingestion/adapter.ts`) calls the UPSRTC public API (`https://api.upsrtc.com/v1/busPositions`) every 10 seconds to fetch live GPS coordinates, bus numbers, and route IDs.
- **Bus numbers & identifiers** – each bus record includes fields `busNumber`, `routeId`, and `timestamp`, which are stored in memory and exposed via the `/live` endpoint of the backend API.
- **REST API** – exposes journey, ETA and live‑location endpoints consumed by the front‑end.

### Shared Assets
- **`data.json`** – master list of stops, routes, and divergence points.
- **`globals.css`** – global design tokens (colors, fonts, badge styles).

---

## 🎯 Real‑World Problem Solved
- **Missing real‑time information:** commuters often rely on static timetables. UPBus provides live locations and ETA.
- **Route ambiguity:** many bus lines share a common segment but diverge later. The app clearly shows which branch the bus will take (e.g., “via Ambehta”).
- **Trip planning pain:** users can search any source‑destination pair and instantly see the best route with visual map guidance.

---

## 🚀 Next Goals (Roadmap)
1. **Real‑time passenger reporting** – allow users to report delays or overcrowding directly from the map.
2. **Push notifications** – notify commuters when a bus they are watching is arriving at their stop.
3. **Offline support** – cache the last known positions and route data for low‑connectivity scenarios.
4. **Enhanced UI** – add micro‑animations for badge transitions and a dark‑mode toggle.
5. **Analytics dashboard** – admin view with usage stats, bus punctuality, and heat‑maps of demand.

> **Note:** The project is **in‑complete**; core routing and live‑map work, but the above features are pending.

---

## 👩‍💻 Getting Started for New Developers
1. **Clone the repository** (the workspace lives at `C:\Users\Azad Singh\Desktop\upbus`).
2. **Install dependencies**
   ```bash
   cd apps/web-app
   npm install   # installs Next.js, Leaflet, etc.
   cd ../backend
   npm install   # installs Express and graph engine deps
   ```
3. **Run the back‑end**
   ```bash
   cd apps/backend
   npm run dev   # starts the API on http://localhost:3002
   ```
4. **Run the front‑end**
   ```bash
   cd apps/web-app
   npm run dev   # starts Next.js (defaults to port 3001)
   ```
5. **Development flow**
   - UI changes are located under `src/app/*`.
   - Routing logic lives in `src/app/page.tsx` (`getDistinguishingStop`).
   - To add a new route or stop, update `src/db/data.json` and restart the back‑end.
   - Run `npm run lint` and `npm run format` before committing.

---

## 📚 Documentation Links (in‑repo)
- **API Spec** – `apps/backend/README.md`
- **Front‑end Architecture** – `apps/web-app/README.md`
- **Design System** – `apps/web-app/src/app/globals.css`
- **Routing Engine** – `apps/backend/src/engine/graph.ts`

---

## 🛠️ Contribution Guidelines
- Follow the **premium design** guidelines (use the existing CSS tokens, avoid placeholder images; generate UI mock‑ups with the `generate_image` tool if needed).
- Write **unit tests** for any new utility functions (Jest is configured).
- Keep **semantic commit messages** – `feat:`, `fix:`, `docs:` prefixes.
- Ensure **SEO best practices** are maintained (title tags, meta descriptions, proper heading hierarchy).

---

## 📞 Support & Contacts
- **Product Owner:** Azad Singh – `azad.singh@example.com`
- **Channel:** Slack `#upbus-dev`

---

*Generated on 2026-06-23.*
