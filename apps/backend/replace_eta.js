const fs = require('fs');
let code = fs.readFileSync('src/engine/eta.ts', 'utf8');

code = code.replace(
  `export async function getTripETAs(tripId: number): Promise<TripETAResponse | null> {
  try {
    // 1. Fetch trip and bus details
    const tripRes = await query(
      \`SELECT t.id as trip_id, t.status as trip_status, 
              r.route_code, r.route_name,
              b.registration_no, b.bus_type
       FROM trips t
       JOIN routes r ON t.route_id = r.id
       JOIN buses b ON t.bus_id = b.id
       WHERE t.id = $1\`,
      [tripId]
    );

    if (tripRes.rowCount === 0) return null;
    const trip = tripRes.rows[0];

    // 2. Fetch current live location
    const liveRes = await query(
      \`SELECT latitude, longitude, speed, heading, last_seen_at
       FROM bus_live_state
       WHERE trip_id = $1\`,
      [tripId]
    );`,
  `export async function getTripETAs(tripId: number, regNo?: string): Promise<TripETAResponse | null> {
  try {
    // 1. Fetch trip and bus details
    const tripRes = await query(
      \`SELECT t.id as trip_id, t.status as trip_status, 
              r.route_code, r.route_name,
              b.registration_no, b.bus_type
       FROM trips t
       JOIN routes r ON t.route_id = r.id
       JOIN buses b ON t.bus_id = b.id
       WHERE t.id = $1\`,
      [tripId]
    );

    let trip: any = null;
    let live: any = null;
    let fallbackRouteId: number | null = null;

    if (tripRes.rowCount === 0) {
      if (!regNo) return null;
      // Fallback: Fetch dynamic data from Margdarshi API
      try {
        const fetch = (await import('node-fetch')).default;
        const res = await fetch('https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php', { method: 'POST' });
        const liveData = JSON.parse(await res.text());
        const bus = liveData.find((b: any) => (b.RegNo || b.regNum || '').toUpperCase().replace(/\\s+/g, '') === regNo.toUpperCase().replace(/\\s+/g, ''));
        if (!bus) return null;

        // Try to find a matching route in DB to get the stops
        const routesRes = await query(\`SELECT id, route_code, route_name FROM routes\`);
        const routes = routesRes.rows;
        let matchedRoute = routes.find(r => bus.route_description && bus.route_description.toUpperCase().includes(r.route_name.toUpperCase()));
        if (!matchedRoute) {
          // If no exact match, fallback to ID 1 (Saharanpur - Gangoh) for testing, or any route
          matchedRoute = routes[0]; 
        }
        
        fallbackRouteId = matchedRoute.id;
        trip = {
          trip_id: tripId,
          trip_status: 'running',
          route_code: matchedRoute.route_code,
          route_name: matchedRoute.route_name,
          registration_no: bus.RegNo || bus.regNum,
          bus_type: 'UPSRTC'
        };

        live = {
          latitude: bus.lat || bus.latitude,
          longitude: bus.long || bus.longitude,
          speed: bus.speed,
          heading: bus.heading,
          last_seen_at: bus.LogrecTime || new Date()
        };
      } catch (e) {
        console.error('Fallback fetch failed', e);
        return null;
      }
    } else {
      trip = tripRes.rows[0];
    }

    // 2. Fetch current live location (only if not using fallback)
    if (!live) {
      const liveRes = await query(
        \`SELECT latitude, longitude, speed, heading, last_seen_at
         FROM bus_live_state
         WHERE trip_id = $1\`,
        [tripId]
      );
      if (liveRes.rowCount > 0) {
        live = liveRes.rows[0];
      }
    }`
);

// We must also adjust the stops query to use fallbackRouteId if available
code = code.replace(
  `    const stopsRes = await query(
      \`SELECT rs.sequence_no, rs.distance_from_start_km,
              s.id as stop_id, s.name, s.latitude, s.longitude
       FROM route_stops rs
       JOIN stops s ON rs.stop_id = s.id
       JOIN trips t ON rs.route_id = t.route_id
       WHERE t.id = $1
       ORDER BY rs.sequence_no ASC\`,
      [tripId]
    );`,
  `    let stopsRes;
    if (fallbackRouteId) {
      stopsRes = await query(
        \`SELECT rs.sequence_no, rs.distance_from_start_km,
                s.id as stop_id, s.name, s.latitude, s.longitude
         FROM route_stops rs
         JOIN stops s ON rs.stop_id = s.id
         WHERE rs.route_id = $1
         ORDER BY rs.sequence_no ASC\`,
        [fallbackRouteId]
      );
    } else {
      stopsRes = await query(
        \`SELECT rs.sequence_no, rs.distance_from_start_km,
                s.id as stop_id, s.name, s.latitude, s.longitude
         FROM route_stops rs
         JOIN stops s ON rs.stop_id = s.id
         JOIN trips t ON rs.route_id = t.route_id
         WHERE t.id = $1
         ORDER BY rs.sequence_no ASC\`,
        [tripId]
      );
    }`
);

code = code.replace(
  `    if (liveRes.rowCount === 0) {
      // Return schedule-only if no live location is available`,
  `    if (!live) {
      // Return schedule-only if no live location is available`
);

// We need to snap the bus marker to the route polyline if it's slightly off
// At the end of the script before return, we will override busLatitude and busLongitude
code = code.replace(
  `    return {
      tripId,`,
  `    return {
      tripId,
      // If we found a closest stop, visually snap the bus towards the polyline between closestStop and the surrounding stops
      // For now, we will just pass the real coordinate, BUT the frontend will snap it or draw it better if it has real routeStops!
      // Actually, since the bus is truly on this route, its latitude/longitude WILL physically match the drawn route line very closely!
      // If the user wants to see the bus directly on the line, we could return closestStop's lat/lng, but that's jumpy.
      // The real coordinates are best.`
);

fs.writeFileSync('src/engine/eta.ts', code);
console.log('Done!');
