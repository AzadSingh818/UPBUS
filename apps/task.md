# Task Tracking - Merge Direct Segments & Dynamic Route Tracking

- [x] Modify `filterUniquePaths` in `graph.ts` to merge paths with matching stop sequences and populate `allRoutes`.
- [x] Modify `/api/v1/search/routes` in `index.ts` to check `allRoutes` for bus matching and route code assignment.
- [x] Modify `getTripETAs` in `eta.ts` to dynamically override the route stops sequence if the live description matches a different route.
- [x] Run `node test_graph.js` to verify routing logic.
- [x] Launch development server and perform end-to-end verification of search, direct merging, and live tracking map updates.
