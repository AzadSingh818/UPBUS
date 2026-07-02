import { setUseMock, mockDb } from '../src/db/index';
import { GPSValidator } from '../src/modules/route-progress/algorithms/GPSValidator';
import { NoiseFilter } from '../src/modules/route-progress/algorithms/NoiseFilter';
import { MapMatcher } from '../src/modules/route-progress/algorithms/MapMatcher';
import { SegmentDetector } from '../src/modules/route-progress/algorithms/SegmentDetector';
import { StopStateMachine } from '../src/modules/route-progress/algorithms/StopStateMachine';
import { CompletedStopEngine } from '../src/modules/route-progress/algorithms/CompletedStopEngine';
import { RemainingStopEngine } from '../src/modules/route-progress/algorithms/RemainingStopEngine';
import { ReverseDetector } from '../src/modules/route-progress/algorithms/ReverseDetector';
import { RouteDeviationDetector } from '../src/modules/route-progress/algorithms/RouteDeviationDetector';
import { DirectionLockEngine } from '../src/modules/route-progress/algorithms/DirectionLockEngine';
import { RouteProgressEngine } from '../src/modules/route-progress/service/RouteProgressEngine';
import { RouteProgressService } from '../src/modules/route-progress/service/RouteProgressService';
import { RouteProgressRepository } from '../src/modules/route-progress/repository/RouteProgressRepository';
import { ProgressSocketHandler } from '../src/modules/route-progress/socket/ProgressSocketHandler';

// --- Test Harness ---
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      res.then(() => {
        console.log(`  ✅  ${name}`);
        passed++;
      }).catch((e: any) => {
        console.error(`  ❌  ${name}`);
        console.error(`       ${e.message}`);
        failed++;
      });
    } else {
      console.log(`  ✅  ${name}`);
      passed++;
    }
  } catch (e: any) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toBeTrue() {
      if (actual !== true)
        throw new Error(`Expected true, got ${JSON.stringify(actual)}`);
    },
    toBeFalse() {
      if (actual !== false)
        throw new Error(`Expected false, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan(n: number) {
      if (actual <= n) throw new Error(`Expected ${actual} > ${n}`);
    },
    toBeLessThan(n: number) {
      if (actual >= n) throw new Error(`Expected ${actual} < ${n}`);
    },
    toContain(item: any) {
      if (!Array.isArray(actual) && typeof actual !== 'string') {
        throw new Error(`Expected array or string to contain, got ${typeof actual}`);
      }
      if (!actual.includes(item)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`);
      }
    }
  };
}

async function runTests() {
  console.log('\n=========================================');
  console.log('STARTING ROUTE PROGRESS ENGINE TESTS');
  console.log('=========================================\n');

  // Force database pool to use the mock DB
  setUseMock(true);

  // Initialize fresh mock DB collections
  mockDb.routes = [];
  mockDb.stops = [];
  mockDb.route_stops = [];
  mockDb.buses = [];
  mockDb.trips = [];
  mockDb.bus_progress_cache = [];
  mockDb.stop_visit_log = [];
  mockDb.live_bus_location = [];

  // Seed data
  // Route 999: Stop A -> Stop B -> Stop C
  // Stop A: (29.0, 77.0), Distance: 0m
  // Stop B: (29.1, 77.1), Distance: 10000m (10km)
  // Stop C: (29.2, 77.2), Distance: 25000m (25km)
  const testRoute = { id: 999, route_code: 'TEST-999', route_name: 'Test Route 999', source: 'Stop A', destination: 'Stop C', distance_km: 25.0 };
  mockDb.routes.push(testRoute);

  const stopA = { id: 1001, name: 'Stop A', stop_name: 'Stop A', latitude: 29.0, longitude: 77.0 };
  const stopB = { id: 1002, name: 'Stop B', stop_name: 'Stop B', latitude: 29.1, longitude: 77.1 };
  const stopC = { id: 1003, name: 'Stop C', stop_name: 'Stop C', latitude: 29.2, longitude: 77.2 };
  mockDb.stops.push(stopA, stopB, stopC);

  mockDb.route_stops.push(
    { route_id: 999, stop_id: 1001, sequence_no: 1, sequence: 1, distance_from_start: 0, distance_from_start_km: 0 },
    { route_id: 999, stop_id: 1002, sequence_no: 2, sequence: 2, distance_from_start: 10000, distance_from_start_km: 10.0 },
    { route_id: 999, stop_id: 1003, sequence_no: 3, sequence: 3, distance_from_start: 25000, distance_from_start_km: 25.0 }
  );

  const testBus = { id: 101, registration_no: 'UP15AT9999', registration_number: 'UP15AT9999' };
  mockDb.buses.push(testBus);

  const testTrip = { id: 9901, bus_id: 101, route_id: 999, status: 'running', scheduled_start: new Date() };
  mockDb.trips.push(testTrip);

  // Clear cache in Repositories/Validators before tests
  GPSValidator.clearCache();
  NoiseFilter.clearCache();
  RouteProgressRepository.clearCache();
  ProgressSocketHandler.clear();

  // 1. GPSValidator Tests
  console.log('── Algorithm 1: GPS Ingest Validation ──');
  test('GPSValidator rejects invalid latitude', () => {
    const res = GPSValidator.validate({ busId: 101, latitude: 120.0, longitude: 77.0, speed: 0, heading: 0, accuracy: 5, timestamp: new Date() });
    expect(res).toBeFalse();
  });

  test('GPSValidator rejects invalid longitude', () => {
    const res = GPSValidator.validate({ busId: 101, latitude: 29.0, longitude: -200.0, speed: 0, heading: 0, accuracy: 5, timestamp: new Date() });
    expect(res).toBeFalse();
  });

  test('GPSValidator rejects poor accuracy (> 50m)', () => {
    const res = GPSValidator.validate({ busId: 101, latitude: 29.0, longitude: 77.0, speed: 0, heading: 0, accuracy: 55, timestamp: new Date() });
    expect(res).toBeFalse();
  });

  test('GPSValidator accepts valid GPS packet', () => {
    const res = GPSValidator.validate({ busId: 101, latitude: 29.0, longitude: 77.0, speed: 0, heading: 0, accuracy: 5, timestamp: new Date() });
    expect(res).toBeTrue();
  });

  test('GPSValidator rejects duplicate packet', () => {
    const now = new Date();
    GPSValidator.validate({ busId: 101, latitude: 29.0, longitude: 77.0, speed: 0, heading: 0, accuracy: 5, timestamp: now });
    const res = GPSValidator.validate({ busId: 101, latitude: 29.0, longitude: 77.0, speed: 0, heading: 0, accuracy: 5, timestamp: now });
    expect(res).toBeFalse();
  });

  // 2. NoiseFilter Tests
  console.log('\n── Algorithm 2: Noise Filtering ──');
  test('NoiseFilter rejects physically impossible jumps', () => {
    const t1 = new Date();
    const t2 = new Date(t1.getTime() + 2000); // 2 seconds later
    // Ingest first packet
    NoiseFilter.filter({ busId: 101, latitude: 29.0, longitude: 77.0, speed: 40, heading: 0, accuracy: 5, timestamp: t1 });
    // Ingest second packet far away (e.g. 5km jump)
    const res = NoiseFilter.filter({ busId: 101, latitude: 29.05, longitude: 77.05, speed: 40, heading: 0, accuracy: 5, timestamp: t2 });
    expect(res).toBeFalse();
  });

  // 3. MapMatcher Tests
  console.log('\n── Algorithm 3: Map Matching ──');
  test('MapMatcher projects GPS coordinates onto route stops segments', () => {
    const stops = [
      { latitude: 29.0, longitude: 77.0, distance_from_start: 0 },
      { latitude: 29.1, longitude: 77.1, distance_from_start: 10000 }
    ];
    // Midpoint: (29.05, 77.05) with slight offset
    const match = MapMatcher.match(29.051, 77.049, stops);
    expect(match.coveredDistance).toBeGreaterThan(4900);
    expect(match.coveredDistance).toBeLessThan(5100);
    expect(Number(match.matchedLatitude.toFixed(2))).toBe(29.05);
    expect(Number(match.matchedLongitude.toFixed(2))).toBe(77.05);
  });

  // 4. SegmentDetector Tests
  console.log('\n── Algorithm 4: Current Segment Detection ──');
  test('SegmentDetector returns correct from and to stops', () => {
    const stops = [
      { id: 1001, stop_name: 'Stop A', distance_from_start: 0, sequence: 1 },
      { id: 1002, stop_name: 'Stop B', distance_from_start: 10000, sequence: 2 },
      { id: 1003, stop_name: 'Stop C', distance_from_start: 25000, sequence: 3 }
    ];
    const segment = SegmentDetector.detect(12000, stops);
    expect(segment.fromStopName).toBe('Stop B');
    expect(segment.toStopName).toBe('Stop C');
  });

  // 5. StopStateMachine Tests
  console.log('\n── Algorithm 5: Stop State Machine ──');
  test('StopStateMachine handles approaching transition (<= 500m)', () => {
    const stop = { stopId: 1002, stopName: 'Stop B', distanceFromStart: 10000, sequence: 2 };
    const res = StopStateMachine.evaluate(9600, stop, 'NOT_REACHED', false);
    expect(res.state).toBe('APPROACHING');
  });

  test('StopStateMachine handles arrival transition (<= 100m)', () => {
    const stop = { stopId: 1002, stopName: 'Stop B', distanceFromStart: 10000, sequence: 2 };
    const res = StopStateMachine.evaluate(9950, stop, 'APPROACHING', false);
    expect(res.state).toBe('AT_STOP');
    expect(res.shouldLogArrival).toBeTrue();
  });

  test('StopStateMachine handles departing transition (crossed stop point)', () => {
    const stop = { stopId: 1002, stopName: 'Stop B', distanceFromStart: 10000, sequence: 2 };
    const res = StopStateMachine.evaluate(10050, stop, 'AT_STOP', false);
    expect(res.state).toBe('DEPARTING');
  });

  test('StopStateMachine handles completed transition (crossed departure radius 120m)', () => {
    const stop = { stopId: 1002, stopName: 'Stop B', distanceFromStart: 10000, sequence: 2 };
    const res = StopStateMachine.evaluate(10150, stop, 'DEPARTING', false);
    expect(res.state).toBe('COMPLETED');
    expect(res.shouldLogDeparture).toBeTrue();
  });

  // 6. DirectionLockEngine Tests
  console.log('\n── Algorithm 11: Direction Lock Engine ──');
  test('DirectionLockEngine detects U-turns or wrong direction', () => {
    const fromStop = { latitude: 29.0, longitude: 77.0 };
    const toStop = { latitude: 29.1, longitude: 77.1 }; // Bearing ~45 degrees
    // Case A: Bus heading 45 degrees (matches direction)
    const matches = DirectionLockEngine.isWrongDirection(45, fromStop, toStop, 40);
    expect(matches).toBeFalse();
    // Case B: Bus heading 225 degrees (opposite direction)
    const wrong = DirectionLockEngine.isWrongDirection(225, fromStop, toStop, 40);
    expect(wrong).toBeTrue();
  });

  // 7. RouteDeviationDetector Tests
  console.log('\n── Algorithm 10: Route Deviation Detector ──');
  test('RouteDeviationDetector flags deviation correctly', () => {
    const onRoute = RouteDeviationDetector.isDeviated(29.001, 77.001, 29.0, 77.0, 150);
    expect(onRoute).toBeFalse();
    const offRoute = RouteDeviationDetector.isDeviated(29.005, 77.005, 29.0, 77.0, 150);
    expect(offRoute).toBeTrue();
  });

  // 8. End-to-End Pipeline Processing Tests
  console.log('\n── End-to-End Location Processing ──');
  test('RouteProgressEngine processing pipeline end-to-end integration', async () => {
    // Stage 1: Bus is at Stop A (0m)
    console.log('    -> Processing bus at Stop A');
    let t = new Date();
    await RouteProgressEngine.process({
      busId: 101,
      latitude: 29.0,
      longitude: 77.0,
      speed: 0,
      heading: 45,
      accuracy: 5,
      timestamp: t
    });

    let progress = await RouteProgressService.getProgress(101);
    expect(progress === null).toBeFalse();
    expect(progress?.currentState).toBe('AT_STOP');
    expect(progress?.currentSegment.from).toBe('Stop A');
    expect(progress?.completedStops.length).toBe(0);

    // Stage 2: Bus travels towards Stop B (covered distance = 5km)
    console.log('    -> Processing bus halfway between A and B');
    GPSValidator.clearCache();
    NoiseFilter.clearCache();
    t = new Date(t.getTime() + 10000);
    await RouteProgressEngine.process({
      busId: 101,
      latitude: 29.05,
      longitude: 77.05,
      speed: 50,
      heading: 45,
      accuracy: 5,
      timestamp: t
    });

    progress = await RouteProgressService.getProgress(101);
    expect(progress?.currentState).toBe('BETWEEN_STOPS');
    expect(progress?.currentSegment.from).toBe('Stop A');
    expect(progress?.currentSegment.to).toBe('Stop B');
    expect(progress?.completedStops).toContain('Stop A'); // Stop A completed because distance > 120m

    // Stage 3: Bus arrives at Stop B (10km)
    console.log('    -> Processing bus arrived at Stop B');
    GPSValidator.clearCache();
    NoiseFilter.clearCache();
    t = new Date(t.getTime() + 10000);
    await RouteProgressEngine.process({
      busId: 101,
      latitude: 29.1,
      longitude: 77.1,
      speed: 0,
      heading: 45,
      accuracy: 5,
      timestamp: t
    });

    progress = await RouteProgressService.getProgress(101);
    expect(progress?.currentState).toBe('AT_STOP');
    expect(progress?.current.stopName).toBe('Stop B');

    // Stage 4: Bus departs Stop B and travels past departure radius
    console.log('    -> Processing bus departing Stop B');
    GPSValidator.clearCache();
    NoiseFilter.clearCache();
    t = new Date(t.getTime() + 10000);
    await RouteProgressEngine.process({
      busId: 101,
      latitude: 29.102,
      longitude: 77.102, // Past Stop B
      speed: 40,
      heading: 45,
      accuracy: 5,
      timestamp: t
    });

    progress = await RouteProgressService.getProgress(101);
    expect(progress?.completedStops).toContain('Stop B'); // Stop B completed
    expect(progress?.remainingStops).toContain('Stop C');

    // Stage 5: Reverse Travel / Backtracking rollback
    console.log('    -> Processing bus reversing back past Stop B');
    GPSValidator.clearCache();
    NoiseFilter.clearCache();
    t = new Date(t.getTime() + 10000);
    // Send reverse GPS packet (heading opposite 225, distance decreased to 9.8km)
    await RouteProgressEngine.process({
      busId: 101,
      latitude: 29.098,
      longitude: 77.098,
      speed: 30,
      heading: 225,
      accuracy: 5,
      timestamp: t
    });

    progress = await RouteProgressService.getProgress(101);
    // State machine rollback must have kicked in: Stop B should no longer be completed!
    expect(progress?.completedStops.includes('Stop B')).toBeFalse();
    expect(progress?.remainingStops).toContain('Stop B');
    expect(progress?.currentState).toBe('REVERSING');
  });

  // Print results
  setTimeout(() => {
    console.log('\n=========================================');
    console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('=========================================\n');
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }, 1000);
}

runTests();
