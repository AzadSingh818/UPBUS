/**
 * api_reports.test.ts
 * Unit tests for the new database mock queries (Option B features):
 *   1. Passenger Reports insertion and retrieval
 *   2. Push Subscriptions insertion, retrieval, and deletion
 *
 * Run with: npx ts-node -e "require('./tests/api_reports.test')"
 */

import { query } from '../src/db';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res.then(() => {
        console.log(`  ✅  ${name}`);
        passed++;
      }).catch((e) => {
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
    toHaveLength(n: number) {
      if (actual.length !== n)
        throw new Error(`Expected length ${n}, got ${actual.length}`);
    },
    toBeGreaterThanOrEqual(n: number) {
      if (actual < n) throw new Error(`Expected ${actual} >= ${n}`);
    }
  };
}

async function runTests() {
  console.log('\n── DB Mock: Passenger Reports ──');

  test('can insert passenger report and fetch it back in active list', async () => {
    // 1. Insert a report
    const insertRes = await query(
      `INSERT INTO passenger_reports (trip_id, bus_reg_no, report_type, description, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [101, 'UP11AT9999', 'Delay', 'Stuck in traffic jam near bypass', 29.964, 77.546]
    );

    expect(insertRes.rowCount).toBe(1);
    expect(insertRes.rows[0].bus_reg_no).toBe('UP11AT9999');
    expect(insertRes.rows[0].report_type).toBe('Delay');

    // 2. Fetch active reports (should include the one we just inserted)
    const activeRes = await query(
      `SELECT id, trip_id, bus_reg_no, report_type, description, latitude, longitude, created_at
       FROM passenger_reports
       WHERE created_at >= $1`
    );

    expect(activeRes.rows.length).toBeGreaterThanOrEqual(1);
    const found = activeRes.rows.find((r: any) => r.bus_reg_no === 'UP11AT9999');
    expect(found.report_type).toBe('Delay');
    expect(found.description).toBe('Stuck in traffic jam near bypass');
    expect(found.latitude).toBe(29.964);
  });

  console.log('\n── DB Mock: Push Subscriptions ──');

  test('can save, list, and delete push subscriptions', async () => {
    const mockEndpoint = 'https://updates.push.com/send/token123';
    
    // 1. Save subscription
    const saveRes = await query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth) 
       VALUES ($1, $2, $3)`,
      [mockEndpoint, 'dhkey_value', 'auth_value']
    );
    expect(saveRes.rowCount).toBe(1);
    expect(saveRes.rows[0].endpoint).toBe(mockEndpoint);

    // 2. Query push subscriptions list
    const listRes = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
    const hasSub = listRes.rows.some((s: any) => s.endpoint === mockEndpoint);
    expect(hasSub).toBe(true);

    // 3. Delete subscription
    const deleteRes = await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [mockEndpoint]);
    expect(deleteRes.rowCount).toBe(1);

    // 4. Verify deleted
    const listRes2 = await query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
    const hasSub2 = listRes2.rows.some((s: any) => s.endpoint === mockEndpoint);
    expect(hasSub2).toBe(false);
  });

  // Small delay to allow async tests to output logs
  setTimeout(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  }, 100);
}

runTests().catch((e) => {
  console.error('Fatal test failure:', e);
  process.exit(1);
});
