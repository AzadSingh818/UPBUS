import { mockDb } from '../src/db/index';
import { initDivergenceCache, matchBranchForBus, divergenceCache } from '../src/engine/divergenceBinding';
import { getState, setState, clearState } from '../src/engine/divergenceState';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
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
    toBeNull() {
      if (actual !== null)
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toBeNotNull() {
      if (actual === null)
        throw new Error(`Expected not null, got null`);
    }
  };
}

function runTests() {
  console.log('\n=========================================');
  console.log('STARTING DIVERGENCE ENGINE TESTS');
  console.log('=========================================\n');

  // Seed mock database divergence nodes
  const testNode = {
    id: 991,
    name: 'Saharanpur Divergence Point',
    latitude: 29.9680,
    longitude: 77.5450,
    branches: [
      {
        routeIds: [12],
        polyline: [
          { lat: 29.9680, lng: 77.5450 },
          { lat: 29.9600, lng: 77.5300 },
          { lat: 29.9500, lng: 77.5100 }
        ]
      },
      {
        routeIds: [13],
        polyline: [
          { lat: 29.9680, lng: 77.5450 },
          { lat: 29.9750, lng: 77.5600 },
          { lat: 29.9850, lng: 77.5750 }
        ]
      }
    ]
  };

  mockDb.divergence_nodes = [testNode];

  test('initDivergenceCache loads nodes from mockDb', () => {
    initDivergenceCache();
    expect(divergenceCache.length).toBe(1);
    expect(divergenceCache[0].id).toBe(991);
    expect(divergenceCache[0].name).toBe('Saharanpur Divergence Point');
  });

  test('matchBranchForBus returns Branch 1 if coordinates are close to Branch 1', () => {
    // 29.9600, 77.5300 is exactly on Branch 1 segment
    const branch = matchBranchForBus(29.9600, 77.5300, 991);
    expect(branch).toBeNotNull();
    expect(branch!.routeIds[0]).toBe(12);
  });

  test('matchBranchForBus returns Branch 2 if coordinates are close to Branch 2', () => {
    // 29.9750, 77.5600 is exactly on Branch 2 segment
    const branch = matchBranchForBus(29.9750, 77.5600, 991);
    expect(branch).toBeNotNull();
    expect(branch!.routeIds[0]).toBe(13);
  });

  test('matchBranchForBus returns null if coordinates are far from both branches', () => {
    // 29.9000, 77.4000 is way off
    const branch = matchBranchForBus(29.9000, 77.4000, 991);
    expect(branch).toBeNull();
  });

  test('matchBranchForBus returns null for invalid node ID', () => {
    const branch = matchBranchForBus(29.9600, 77.5300, 99999);
    expect(branch).toBeNull();
  });

  test('divergenceState stores, retrieves, and clears state', () => {
    const busId = 'UP11T1234';
    const sampleState = {
      busId,
      routeId: 10,
      nodeId: '991',
      matchedBranch: 'Branch 1',
      phase: 'CONFIRMED' as const,
      lastMatchTimestamp: Date.now()
    };

    setState(sampleState);
    const retrieved = getState(busId);
    expect(retrieved).toBeNotNull();
    expect(retrieved!.routeId).toBe(10);
    expect(retrieved!.phase).toBe('CONFIRMED');

    clearState(busId);
    const cleared = getState(busId);
    expect(cleared).toBe(undefined);
  });

  setTimeout(() => {
    console.log('\n=========================================');
    console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('=========================================\n');
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }, 500);
}

runTests();
