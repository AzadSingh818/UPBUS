require('ts-node').register();
const { query } = require('./src/db');
const { recordLiveLocation, visitedStopsMap, completeTripAndLearnRoute } = require('./src/engine/routeLearning');
const { buildGraph, findPathsDFS } = require('./src/engine/graph');

async function runTest() {
  console.log('=== STARTING ROUTE LEARNING INTEGRATION TEST ===');

  // 1. Initialise the graph to make sure base routes are loaded
  console.log('\n[Step 1] Initialising graph engine...');
  await buildGraph();

  // 2. Query stops to construct our test coordinates
  console.log('\n[Step 2] Fetching stops from DB...');
  const stopsRes = await query('SELECT id, stop_code, name, latitude, longitude FROM stops');
  const stops = stopsRes.rows;

  const startStop = stops.find(s => s.stop_code === 'S_LKO_CHARBAGH');
  const midStop = stops.find(s => s.stop_code === 'S_LKO_ALAMBAGH');
  const newStop = stops.find(s => s.stop_code === 'S_KAILASHPUR'); // Let's use Kailashpur as our new intermediate stop
  const endStop = stops.find(s => s.stop_code === 'S_KAN_CENTRAL');

  if (!startStop || !midStop || !newStop || !endStop) {
    console.error('Error: Could not find required test stops in DB. Available stop codes:', stops.map(s => s.stop_code));
    process.exit(1);
  }

  console.log(`Using stops:
  - Start: ${startStop.name} (ID: ${startStop.id})
  - Via 1: ${midStop.name} (ID: ${midStop.id})
  - Via 2 (New Stop): ${newStop.name} (ID: ${newStop.id})
  - End: ${endStop.name} (ID: ${endStop.id})`);

  // 3. Create a test bus and trip
  console.log('\n[Step 3] Creating mock bus and trip...');
  const busReg = 'UP 32 TEST 9999';
  let busId;
  const busCheck = await query('SELECT id FROM buses WHERE registration_no = $1', [busReg]);
  if (busCheck.rowCount > 0) {
    busId = busCheck.rows[0].id;
  } else {
    const busInsert = await query(
      "INSERT INTO buses (registration_no, bus_type, depot_name) VALUES ($1, 'Ordinary', 'Test Depot') RETURNING id",
      [busReg]
    );
    busId = busInsert.rows[0].id;
  }

  // Find route ID for Lucknow - Kanpur Express
  const routeRes = await query("SELECT id FROM routes WHERE route_code = $1 LIMIT 1", ['R_LKO_KAN']);
  if (routeRes.rowCount === 0) {
    console.error('Error: R_LKO_KAN route not found.');
    process.exit(1);
  }
  const routeId = routeRes.rows[0].id;

  // Create a new running trip
  const tripInsert = await query(
    "INSERT INTO trips (bus_id, route_id, scheduled_start, status) VALUES ($1, $2, NOW(), 'running') RETURNING id",
    [busId, routeId]
  );
  const tripId = tripInsert.rows[0].id;
  console.log(`Created Trip ID: ${tripId} associated with route ID: ${routeId}`);

  // 4. Simulate GPS location pings in sequence
  console.log('\n[Step 4] Simulating GPS location pings along the new route...');
  
  const pings = [
    { name: 'Start at Lucknow', lat: startStop.latitude, lng: startStop.longitude },
    { name: 'Passing Alambagh', lat: midStop.latitude, lng: midStop.longitude },
    { name: 'Diverting to Kailashpur', lat: newStop.latitude, lng: newStop.longitude },
    { name: 'Arriving at Kanpur Central', lat: endStop.latitude, lng: endStop.longitude }
  ];

  for (const ping of pings) {
    console.log(`- Sending ping: "${ping.name}" at (${ping.lat}, ${ping.lng})`);
    // Speed is 0 to make sure the geofence registers the stop immediately
    await recordLiveLocation(tripId, parseFloat(ping.lat), parseFloat(ping.lng), 0);
    const visited = visitedStopsMap.get(tripId) || [];
    console.log(`  Current visited stops list: [${visited.join(', ')}]`);
  }

  // 5. Verify the new route variant has been generated in the database
  console.log('\n[Step 5] Checking database for newly learned route...');
  const learnedRoutesRes = await query(
    "SELECT id, route_code, route_name, distance_km FROM routes WHERE source = $1 AND destination = $2",
    [startStop.name, endStop.name]
  );

  console.log(`Found ${learnedRoutesRes.rowCount} routes connecting ${startStop.name} and ${endStop.name}:`);
  for (const r of learnedRoutesRes.rows) {
    console.log(`  - Code: ${r.route_code} | Name: ${r.route_name} | Distance: ${r.distance_km} km`);
  }

  const newVariant = learnedRoutesRes.rows.find(r => r.route_code.includes('VAR'));
  if (!newVariant) {
    console.error('Error: No learned route variant was found in DB.');
    process.exit(1);
  }
  console.log('Success! Found learned route variant:', newVariant.route_name);

  // 6. Verify route stops sequence of the learned route
  console.log('\n[Step 6] Verifying stop sequence of the learned route...');
  const learnedStopsRes = await query(
    `SELECT rs.sequence_no, rs.distance_from_start_km, s.name 
     FROM route_stops rs
     JOIN stops s ON rs.stop_id = s.id
     WHERE rs.route_id = $1
     ORDER BY rs.sequence_no ASC`,
    [newVariant.id]
  );
  
  console.log('Sequence for learned route:');
  learnedStopsRes.rows.forEach(s => {
    console.log(`  Stop ${s.sequence_no}: ${s.name} (dist: ${s.distance_from_start_km} km)`);
  });

  // 7. Verify the graph pathfinder automatically returns this new route
  console.log('\n[Step 7] Checking Journey Planner search results...');
  const searchResults = findPathsDFS('Lucknow', 'Kanpur', 0);
  console.log(`Journey Planner found ${searchResults.length} direct paths from Lucknow to Kanpur:`);
  
  searchResults.forEach((p, index) => {
    console.log(`Path ${index + 1}:`);
    console.log(`  Total distance: ${p.totalDistanceKm} km`);
    p.legs.forEach(leg => {
      console.log(`  Leg: ${leg.routeName} (${leg.routeCode})`);
      console.log(`  Stops sequence: ${leg.stops.map(s => s.name).join(' -> ')}`);
    });
  });

  // Check if our new variant is inside search results
  const variantFoundInSearch = searchResults.some(p => p.legs.some(l => l.routeCode === newVariant.route_code));
  if (variantFoundInSearch) {
    console.log('\n SUCCESS: The pathfinder automatically discovered and returned the new learned route!');
  } else {
    console.error('\n FAILURE: The new route variant was not found in the pathfinder results.');
    process.exit(1);
  }

  console.log('\n=== INTEGRATION TEST COMPLETED SUCCESSFULLY ===');
}

runTest().catch(console.error);
