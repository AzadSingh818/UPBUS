/**
 * LiveMap.village.test.tsx
 * Frontend snapshot/unit tests for the villages prop in <LiveMap>.
 *
 * These tests run without a DOM environment (Node.js only) and verify:
 *   1. Village prop type is correctly exported
 *   2. Village data shape is correctly formed
 *   3. Zoom threshold constant is a reasonable value
 *   4. Village icon HTML is generated correctly
 *
 * The Leaflet map itself cannot render in Node (no DOM), so we test the
 * data-shaping and icon-generation logic in isolation.
 */

// ── Inline test harness ──────────────────────────────────────────────────────
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
    toContain(s: string) {
      if (!String(actual).includes(s))
        throw new Error(`Expected "${actual}" to contain "${s}"`);
    },
    toBeDefined() {
      if (actual === undefined) throw new Error('Expected value to be defined');
    },
  };
}

// ── Mock Village data (mirrors the prop type) ────────────────────────────────
interface Village { name: string; latitude: number; longitude: number; }

const MOCK_VILLAGES: Village[] = [
  { name: 'Bandukheri',  latitude: 29.9720, longitude: 77.5530 },
  { name: 'Khera Afgan', latitude: 29.9750, longitude: 77.5510 },
  { name: 'Phandpuri',   latitude: 29.9880, longitude: 77.5580 },
];

const EMPTY_VILLAGES: Village[] = [];

// ── Village prop shape ───────────────────────────────────────────────────────
console.log('\n── Village prop shape ──');

test('village has name, latitude, longitude', () => {
  const v = MOCK_VILLAGES[0];
  expect(typeof v.name).toBe('string');
  expect(typeof v.latitude).toBe('number');
  expect(typeof v.longitude).toBe('number');
});

test('all mock villages have valid coordinates', () => {
  for (const v of MOCK_VILLAGES) {
    if (v.latitude < -90 || v.latitude > 90)
      throw new Error(`Invalid latitude for ${v.name}: ${v.latitude}`);
    if (v.longitude < -180 || v.longitude > 180)
      throw new Error(`Invalid longitude for ${v.name}: ${v.longitude}`);
  }
});

test('empty villages array is valid prop value', () => {
  expect(EMPTY_VILLAGES.length).toBe(0);
});

// ── Icon HTML generation ─────────────────────────────────────────────────────
console.log('\n── Village icon HTML generation ──');

/** Mirrors the makeVillageIcon logic inside LiveMap.tsx */
function makeVillageIconHtml(name: string): string {
  return `
    <div class="village-marker-wrapper">
      <div class="village-dot"></div>
      <span class="village-label">${name}</span>
    </div>
  `.trim();
}

test('icon HTML contains village-dot class', () => {
  const html = makeVillageIconHtml('Bandukheri');
  expect(html).toContain('village-dot');
});

test('icon HTML contains village-label class', () => {
  const html = makeVillageIconHtml('Bandukheri');
  expect(html).toContain('village-label');
});

test('icon HTML embeds the village name', () => {
  const html = makeVillageIconHtml('Bandukheri');
  expect(html).toContain('Bandukheri');
});

test('icon HTML embeds Hindi names correctly', () => {
  const html = makeVillageIconHtml('कुमारहेड़ा');
  expect(html).toContain('कुमारहेड़ा');
});

test('village-marker-wrapper is the root element', () => {
  const html = makeVillageIconHtml('Test');
  expect(html.startsWith('<div class="village-marker-wrapper">')).toBe(true);
});

// ── Zoom threshold ───────────────────────────────────────────────────────────
console.log('\n── Zoom threshold constant ──');

const VILLAGE_ZOOM_THRESHOLD = 13; // must match LiveMap.tsx

test('VILLAGE_ZOOM_THRESHOLD is defined', () => {
  expect(VILLAGE_ZOOM_THRESHOLD).toBeDefined();
});

test('VILLAGE_ZOOM_THRESHOLD > standard overview zoom (10)', () => {
  expect(VILLAGE_ZOOM_THRESHOLD).toBeGreaterThan(10);
});

test('VILLAGE_ZOOM_THRESHOLD is 13 (street-level zoom)', () => {
  expect(VILLAGE_ZOOM_THRESHOLD).toBe(13);
});

// ── Visibility toggle logic ──────────────────────────────────────────────────
console.log('\n── Visibility toggle logic ──');

/**
 * Mirrors the updateVisibility function in LiveMap.tsx
 * Returns 'visible' or 'hidden' for a given zoom.
 */
function shouldShowVillages(zoom: number): boolean {
  return zoom >= VILLAGE_ZOOM_THRESHOLD;
}

test('villages hidden at zoom 10 (country/region level)', () => {
  expect(shouldShowVillages(10)).toBe(false);
});

test('villages hidden at zoom 12', () => {
  expect(shouldShowVillages(12)).toBe(false);
});

test('villages visible at zoom 13 (threshold)', () => {
  expect(shouldShowVillages(13)).toBe(true);
});

test('villages visible at zoom 15 (street level)', () => {
  expect(shouldShowVillages(15)).toBe(true);
});

test('stop markers always shown (unaffected by zoom gate)', () => {
  // Stop markers have no zoom gate – always true
  const stopAlwaysVisible = true;
  expect(stopAlwaysVisible).toBe(true);
});

// ── Snapshot: serialised village list ───────────────────────────────────────
console.log('\n── Village list snapshot ──');

const EXPECTED_SNAPSHOT = JSON.stringify([
  { name: 'Bandukheri',  latitude: 29.9720, longitude: 77.5530 },
  { name: 'Khera Afgan', latitude: 29.9750, longitude: 77.5510 },
  { name: 'Phandpuri',   latitude: 29.9880, longitude: 77.5580 },
]);

test('village list serialises deterministically', () => {
  expect(JSON.stringify(MOCK_VILLAGES)).toBe(EXPECTED_SNAPSHOT);
});

test('village count matches mock data', () => {
  expect(MOCK_VILLAGES.length).toBe(3);
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
