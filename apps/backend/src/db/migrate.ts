import { query } from './index';

async function runMigrations() {
  console.log('[Migration] Starting database migration for Route Progress Engine...');
  try {
    // 1. Update routes table
    await query('ALTER TABLE routes ADD COLUMN IF NOT EXISTS encoded_polyline TEXT');
    await query('ALTER TABLE routes ADD COLUMN IF NOT EXISTS total_distance INTEGER');
    console.log('[Migration] routes table updated.');

    // 2. Update stops table
    await query('ALTER TABLE stops ADD COLUMN IF NOT EXISTS stop_name VARCHAR(255)');
    await query('UPDATE stops SET stop_name = name WHERE stop_name IS NULL');
    console.log('[Migration] stops table updated.');

    // 3. Update route_stops table
    await query('ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS sequence INTEGER');
    await query('ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS distance_from_start INTEGER');
    await query('UPDATE route_stops SET sequence = sequence_no WHERE sequence IS NULL');
    await query('UPDATE route_stops SET distance_from_start = CAST(distance_from_start_km * 1000 AS INTEGER) WHERE distance_from_start IS NULL');
    console.log('[Migration] route_stops table updated.');

    // 4. Update buses table
    await query('ALTER TABLE buses ADD COLUMN IF NOT EXISTS route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL');
    await query('ALTER TABLE buses ADD COLUMN IF NOT EXISTS registration_number VARCHAR(50)');
    await query('UPDATE buses SET registration_number = registration_no WHERE registration_number IS NULL');
    console.log('[Migration] buses table updated.');

    // 5. Create live_bus_location table
    await query(`
      CREATE TABLE IF NOT EXISTS live_bus_location (
          bus_id INTEGER PRIMARY KEY REFERENCES buses(id) ON DELETE CASCADE,
          latitude DOUBLE PRECISION NOT NULL,
          longitude DOUBLE PRECISION NOT NULL,
          heading NUMERIC(5, 2) DEFAULT 0,
          speed NUMERIC(5, 2) DEFAULT 0,
          accuracy NUMERIC(5, 2) DEFAULT 0,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Migration] live_bus_location table verified.');

    // 6. Create bus_progress_cache table
    await query(`
      CREATE TABLE IF NOT EXISTS bus_progress_cache (
          bus_id INTEGER PRIMARY KEY REFERENCES buses(id) ON DELETE CASCADE,
          covered_distance INTEGER NOT NULL,
          current_segment_from VARCHAR(255),
          current_segment_to VARCHAR(255),
          current_stop VARCHAR(255),
          state VARCHAR(50) NOT NULL,
          completed_stop_index INTEGER DEFAULT -1,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Migration] bus_progress_cache table verified.');

    // 7. Create stop_visit_log table
    await query(`
      CREATE TABLE IF NOT EXISTS stop_visit_log (
          id SERIAL PRIMARY KEY,
          stop_id INTEGER REFERENCES stops(id) ON DELETE CASCADE,
          bus_id INTEGER REFERENCES buses(id) ON DELETE CASCADE,
          arrived_at TIMESTAMP WITH TIME ZONE NOT NULL,
          departed_at TIMESTAMP WITH TIME ZONE,
          visited BOOLEAN DEFAULT FALSE,
          CONSTRAINT unique_stop_bus_visit UNIQUE (stop_id, bus_id, arrived_at)
      )
    `);
    console.log('[Migration] stop_visit_log table verified.');

    // 8. Create route_versions table
    await query(`
      CREATE TABLE IF NOT EXISTS route_versions (
          id SERIAL PRIMARY KEY,
          route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          polyline TEXT NOT NULL,
          stops_snapshot JSONB,
          is_active BOOLEAN DEFAULT TRUE,
          CONSTRAINT unique_route_version UNIQUE (route_id, version_number)
      )
    `);
    console.log('[Migration] route_versions table verified.');

    console.log('[Migration] All migrations completed successfully.');
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
  }
}

runMigrations();
