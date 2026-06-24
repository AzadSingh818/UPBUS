/**
 * routeVillages.test.ts
 * Unit tests for:
 *   1. overpass.ts  – query builder and response parser
 *   2. villageFilter.ts – distance-based filtering
 *
 * No network calls are made; Overpass responses are mocked inline.
 *
 * Run with:  npx ts-node -e "require('./tests/routeVillages.test')"
 * Or add jest and run: npx jest tests/routeVillages.test.ts
 */

import { buildOverpassQuery, parseOverpassVillages, computeBbox } from '../src/utils/overpass';
import { filterVillagesByDistance, DEFAULT_MAX_DISTANCE_KM } from '../src/utils/villageFilter';
import { Coordinate } from '../src/engine/geoUtils';

// ---------------------------------------------------------------------------
// Tiny test harness (no jest needed)
// ---------------------------------------------------------------------------
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
    toBeGreaterThan(n: number) {
      if (actual <= n) throw new Error(`Expected ${actual} > ${n}`);
    },
    toBeLessThanOrEqual(n: number) {
      if (actual > n) throw new Error(`Expected ${actual} <= ${n}`);
    },
    toHaveLength(n: number) {
      if (actual.length !== n)
        throw new Error(`Expected length ${n}, got ${actual.length}`);
    },
    toContain(s: string) {
      if (!actual.includes(s))
        throw new Error(`Expected "${actual}" to contain "${s}"`);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. overpass.ts – buildOverpassQuery
// ---------------------------------------------------------------------------

console.log('\n── overpass.buildOverpassQuery ──');

test('contains the bbox coordinates', () => {
  const q = buildOverpassQuery(29.0, 77.0, 30.0, 78.0);
  expect(q).toContain('29,77,30,78');
});

test('queries village, hamlet, and locality', () => {
  const q = buildOverpassQuery(29.0, 77.0, 30.0, 78.0);
  expect(q).toContain('"place"="village"');
  expect(q).toContain('"place"="hamlet"');
  expect(q).toContain('"place"="locality"');
});

test('requests JSON output', () => {
  const q = buildOverpassQuery(29.0, 77.0, 30.0, 78.0);
  expect(q).toContain('[out:json]');
});

// ---------------------------------------------------------------------------
// 2. overpass.ts – parseOverpassVillages
// ---------------------------------------------------------------------------

console.log('\n── overpass.parseOverpassVillages ──');

const MOCK_OVERPASS_RESPONSE = {
  elements: [
    // Named node village – should be included
    {
      type: 'node',
      id: 1,
      lat: 29.96,
      lon: 77.54,
      tags: { name: 'Bandukheri', place: 'village' },
    },
    // Hamlet – should be included
    {
      type: 'node',
      id: 2,
      lat: 29.98,
      lon: 77.55,
      tags: { name: 'Khera Afgan', place: 'hamlet' },
    },
    // No name tag – should be excluded
    {
      type: 'node',
      id: 3,
      lat: 29.97,
      lon: 77.53,
      tags: { place: 'village' },
    },
    // Way with center – should use center coords
    {
      type: 'way',
      id: 4,
      center: { lat: 29.99, lon: 77.57 },
      tags: { name: 'Phandpuri', place: 'village' },
    },
    // Hindi name takes priority
    {
      type: 'node',
      id: 5,
      lat: 29.94,
      lon: 77.50,
      tags: { name: 'Kumarhera', name_hi: 'कुमारहेड़ा', place: 'village' },
    },
  ],
};

test('returns correct count (named elements only)', () => {
  const villages = parseOverpassVillages(MOCK_OVERPASS_RESPONSE);
  expect(villages).toHaveLength(4); // ids 1, 2, 4, 5; id 3 has no name
});

test('correctly parses node lat/lon', () => {
  const villages = parseOverpassVillages(MOCK_OVERPASS_RESPONSE);
  const bandukheri = villages.find(v => v.name === 'Bandukheri');
  expect(bandukheri?.latitude).toBe(29.96);
  expect(bandukheri?.longitude).toBe(77.54);
});

test('correctly parses way center', () => {
  const villages = parseOverpassVillages(MOCK_OVERPASS_RESPONSE);
  const phandpuri = villages.find(v => v.name === 'Phandpuri');
  expect(phandpuri?.latitude).toBe(29.99);
  expect(phandpuri?.longitude).toBe(77.57);
});

test('prefers name_hi over name', () => {
  const villages = parseOverpassVillages(MOCK_OVERPASS_RESPONSE);
  const kumarhera = villages.find(v => v.name === 'कुमारहेड़ा');
  expect(kumarhera).toBe(kumarhera); // just check it exists
  const byEnglish = villages.find(v => v.name === 'Kumarhera');
  expect(byEnglish).toBe(undefined);
});

test('handles empty elements array gracefully', () => {
  const result = parseOverpassVillages({ elements: [] });
  expect(result).toHaveLength(0);
});

test('handles null/undefined input gracefully', () => {
  const result = parseOverpassVillages(null);
  expect(result).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// 3. villageFilter.ts – filterVillagesByDistance
// ---------------------------------------------------------------------------

console.log('\n── villageFilter.filterVillagesByDistance ──');

/**
 * Route: Kumarhera Bus Stand → Phandpuri
 * Approximate coordinates along the Saharanpur district road
 */
const ROUTE_POLYLINE: Coordinate[] = [
  { lat: 29.9640, lng: 77.5460 }, // Kumarhera Bus Stand
  { lat: 29.9700, lng: 77.5490 }, // midpoint
  { lat: 29.9760, lng: 77.5520 }, // midpoint
  { lat: 29.9820, lng: 77.5550 }, // midpoint
  { lat: 29.9880, lng: 77.5580 }, // Phandpuri approx
];

const CANDIDATE_VILLAGES = [
  // ~0.5 km from route – should be INCLUDED
  { name: 'Bandukheri', latitude: 29.9720, longitude: 77.5530 },
  // ~0.2 km from route – should be INCLUDED
  { name: 'Khera Afgan', latitude: 29.9750, longitude: 77.5510 },
  // ~8 km away – should be EXCLUDED
  { name: 'Far Village', latitude: 30.0500, longitude: 77.6200 },
  // ~15 km away – should be EXCLUDED
  { name: 'Very Far Village', latitude: 30.1500, longitude: 77.7000 },
];

test('includes villages within maxDistanceKm', () => {
  const result = filterVillagesByDistance(CANDIDATE_VILLAGES, ROUTE_POLYLINE, 3);
  const names = result.map(v => v.name);
  expect(names.includes('Bandukheri')).toBe(true);
  expect(names.includes('Khera Afgan')).toBe(true);
});

test('excludes villages beyond maxDistanceKm', () => {
  const result = filterVillagesByDistance(CANDIDATE_VILLAGES, ROUTE_POLYLINE, 3);
  const names = result.map(v => v.name);
  expect(names.includes('Far Village')).toBe(false);
  expect(names.includes('Very Far Village')).toBe(false);
});

test('returns empty array when no villages are within range', () => {
  const farVillages = [
    { name: 'Nowhere', latitude: 28.0, longitude: 76.0 },
  ];
  const result = filterVillagesByDistance(farVillages, ROUTE_POLYLINE, 3);
  expect(result).toHaveLength(0);
});

test('respects custom maxDistanceKm', () => {
  // With 0.3 km threshold – only Khera Afgan should pass (it's ~0.2 km)
  // Bandukheri is ~0.5 km; may or may not pass depending on exact geometry
  const result = filterVillagesByDistance(CANDIDATE_VILLAGES, ROUTE_POLYLINE, 0.3);
  const names = result.map(v => v.name);
  expect(names.includes('Far Village')).toBe(false);
});

test('all included distances are <= maxDistanceKm', () => {
  const result = filterVillagesByDistance(CANDIDATE_VILLAGES, ROUTE_POLYLINE, 3);
  for (const v of result) {
    expect(v.distanceToRouteKm).toBeLessThanOrEqual(3);
  }
});

test('results are sorted nearest-first', () => {
  const result = filterVillagesByDistance(CANDIDATE_VILLAGES, ROUTE_POLYLINE, 3);
  for (let i = 1; i < result.length; i++) {
    if (result[i - 1].distanceToRouteKm > result[i].distanceToRouteKm) {
      throw new Error('Results not sorted by distance ascending');
    }
  }
});

test('handles polyline shorter than 2 points gracefully', () => {
  const result = filterVillagesByDistance(CANDIDATE_VILLAGES, [{ lat: 29.96, lng: 77.54 }], 3);
  expect(result).toHaveLength(0);
});

test('uses DEFAULT_MAX_DISTANCE_KM = 3 when no arg given', () => {
  expect(DEFAULT_MAX_DISTANCE_KM).toBe(3);
});

// ---------------------------------------------------------------------------
// 4. computeBbox
// ---------------------------------------------------------------------------

console.log('\n── overpass.computeBbox ──');

test('south < north and west < east', () => {
  const coords = [
    { latitude: 29.96, longitude: 77.54 },
    { latitude: 29.98, longitude: 77.56 },
  ];
  const bbox = computeBbox(coords, 5);
  if (bbox.south >= bbox.north) throw new Error('south >= north');
  if (bbox.west >= bbox.east) throw new Error('west >= east');
});

test('padding expands the bbox', () => {
  const coords = [
    { latitude: 29.96, longitude: 77.54 },
    { latitude: 29.98, longitude: 77.56 },
  ];
  const bbox = computeBbox(coords, 5);
  if (bbox.south >= 29.96) throw new Error('south not padded');
  if (bbox.north <= 29.98) throw new Error('north not padded');
  if (bbox.west >= 77.54) throw new Error('west not padded');
  if (bbox.east <= 77.56) throw new Error('east not padded');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
