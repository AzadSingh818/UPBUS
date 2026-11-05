import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/upbus';
const isRemoteDb = connectionString.includes('amazonaws.com') || connectionString.includes('sslmode=require');

const pool = new Pool({
  connectionString,
  ssl: isRemoteDb ? { rejectUnauthorized: false } : undefined
});

async function seedData() {
  console.log('🌱 Starting seed into AWS RDS PostgreSQL...');
  const jsonPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ data.json not found at', jsonPath);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`📊 Found ${data.stops?.length || 0} stops, ${data.routes?.length || 0} routes, ${data.buses?.length || 0} buses in JSON.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Seed Stops
    if (data.stops && Array.isArray(data.stops)) {
      console.log('Inserting stops...');
      for (const s of data.stops) {
        await client.query(`
          INSERT INTO stops (id, stop_code, name, stop_name, latitude, longitude)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE 
          SET stop_code = EXCLUDED.stop_code, name = EXCLUDED.name, stop_name = EXCLUDED.stop_name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
        `, [s.id, s.stop_code || `STOP_${s.id}`, s.name || s.stop_name, s.name || s.stop_name, s.latitude, s.longitude]);
      }
      console.log(`✅ ${data.stops.length} stops inserted/updated.`);
    }

    // 2. Seed Routes
    if (data.routes && Array.isArray(data.routes)) {
      console.log('Inserting routes...');
      for (const r of data.routes) {
        await client.query(`
          INSERT INTO routes (id, route_code, route_name, encoded_polyline, total_distance)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE 
          SET route_code = EXCLUDED.route_code, route_name = EXCLUDED.route_name, encoded_polyline = EXCLUDED.encoded_polyline, total_distance = EXCLUDED.total_distance
        `, [r.id, r.route_code || `ROUTE_${r.id}`, r.route_name || r.name, r.encoded_polyline || null, r.total_distance || null]);
      }
      console.log(`✅ ${data.routes.length} routes inserted/updated.`);
    }

    // 3. Seed Route Stops
    if (data.route_stops && Array.isArray(data.route_stops)) {
      console.log('Inserting route_stops...');
      for (const rs of data.route_stops) {
        if (!rs.route_id || !rs.stop_id) continue;
        const seq = rs.sequence_no || rs.sequence || 1;
        await client.query(`
          INSERT INTO route_stops (route_id, stop_id, sequence_no, sequence, distance_from_start_km, distance_from_start)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (route_id, stop_id, sequence_no) DO NOTHING
        `, [rs.route_id, rs.stop_id, seq, seq, rs.distance_from_start_km || 0, rs.distance_from_start || 0]);
      }
      console.log(`✅ route_stops linked successfully.`);
    }

    // 4. Seed Buses
    if (data.buses && Array.isArray(data.buses)) {
      console.log('Inserting buses...');
      for (const b of data.buses) {
        await client.query(`
          INSERT INTO buses (id, registration_no, registration_number, route_id, status)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE 
          SET registration_no = EXCLUDED.registration_no, registration_number = EXCLUDED.registration_number, route_id = EXCLUDED.route_id, status = EXCLUDED.status
        `, [b.id, b.registration_no || b.registration_number, b.registration_no || b.registration_number, b.route_id || null, b.status || 'ACTIVE']);
      }
      console.log(`✅ ${data.buses.length} buses inserted/updated.`);
    }

    await client.query('COMMIT');
    console.log('🎉 FULL DATASET SEEDED SUCCESSFULLY INTO AWS RDS!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seedData();
