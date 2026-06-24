-- Database Schema for UP Roadways Live Tracking Platform

-- 1. Routes Table
CREATE TABLE IF NOT EXISTS routes (
    id SERIAL PRIMARY KEY,
    route_code VARCHAR(50) UNIQUE NOT NULL,
    route_name VARCHAR(255) NOT NULL,
    source VARCHAR(100) NOT NULL,
    destination VARCHAR(100) NOT NULL,
    distance_km NUMERIC(6, 2)
);

-- 2. Stops Table
CREATE TABLE IF NOT EXISTS stops (
    id SERIAL PRIMARY KEY,
    stop_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL
);

-- 3. Route Stops Mapping Table (to define the sequence of stops on a route)
CREATE TABLE IF NOT EXISTS route_stops (
    route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
    stop_id INTEGER REFERENCES stops(id) ON DELETE CASCADE,
    sequence_no INTEGER NOT NULL,
    distance_from_start_km NUMERIC(6, 2),
    PRIMARY KEY (route_id, stop_id)
);

-- 4. Buses Table
CREATE TABLE IF NOT EXISTS buses (
    id SERIAL PRIMARY KEY,
    registration_no VARCHAR(20) UNIQUE NOT NULL,
    bus_type VARCHAR(50) DEFAULT 'Ordinary', -- e.g., Volvo, Janrath, Ordinary, Pink Express
    depot_name VARCHAR(100)
);

-- 5. Trips Table
CREATE TABLE IF NOT EXISTS trips (
    id SERIAL PRIMARY KEY,
    bus_id INTEGER REFERENCES buses(id) ON DELETE CASCADE,
    route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
    scheduled_start TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, running, completed, cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Bus Live State Table (Stores the latest real-time GPS coordinate of each active bus)
CREATE TABLE IF NOT EXISTS bus_live_state (
    bus_id INTEGER PRIMARY KEY REFERENCES buses(id) ON DELETE CASCADE,
    trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed NUMERIC(5, 2) DEFAULT 0,
    heading NUMERIC(5, 2) DEFAULT 0,
    last_seen_at TIMESTAMP NOT NULL
);

-- Index for spatial and query performance
CREATE INDEX IF NOT EXISTS idx_routes_search ON routes(source, destination);
CREATE INDEX IF NOT EXISTS idx_bus_live_state ON bus_live_state(last_seen_at);

-- ==========================================
-- SEED DATA FOR PILOT ROUTES
-- ==========================================

-- Seed Routes
INSERT INTO routes (route_code, route_name, source, destination, distance_km)
VALUES 
('R_LKO_KAN', 'Lucknow - Kanpur Express', 'Lucknow', 'Kanpur', 80.00),
('R_DEL_MRT', 'Delhi - Meerut Express', 'Delhi', 'Meerut', 70.00)
ON CONFLICT (route_code) DO NOTHING;

-- Seed Stops
INSERT INTO stops (stop_code, name, latitude, longitude)
VALUES 
('S_LKO_CHARBAGH', 'Lucknow Charbagh Bus Stand', 26.8322, 80.9224),
('S_LKO_ALAMBAGH', 'Alambagh Bus Terminal', 26.8125, 80.8995),
('S_UNNAO', 'Unnao Bus Stand', 26.5458, 80.4907),
('S_KAN_CENTRAL', 'Kanpur Jhakarkati Bus Terminal', 26.4552, 80.3323),
('S_DEL_ANAND_VIHAR', 'Anand Vihar ISBT (Delhi)', 28.6471, 77.3159),
('S_GZB_KAUSHAMBI', 'Kaushambi Depot (Ghaziabad)', 28.6441, 77.3235),
('S_GZB_OLD', 'Old Ghaziabad Bus Stand', 28.6657, 77.4265),
('S_MODINAGAR', 'Modinagar Bus Stand', 28.8354, 77.5855),
('S_MRT_BHAISALI', 'Meerut Bhaisali Bus Stand', 29.0020, 77.7020)
ON CONFLICT (stop_code) DO NOTHING;

-- Seed Route Stops (Sequences)
-- Lucknow - Kanpur
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code = 'R_LKO_KAN'), (SELECT id FROM stops WHERE stop_code = 'S_LKO_CHARBAGH'), 1, 0.00),
((SELECT id FROM routes WHERE route_code = 'R_LKO_KAN'), (SELECT id FROM stops WHERE stop_code = 'S_LKO_ALAMBAGH'), 2, 4.50),
((SELECT id FROM routes WHERE route_code = 'R_LKO_KAN'), (SELECT id FROM stops WHERE stop_code = 'S_UNNAO'), 3, 56.00),
((SELECT id FROM routes WHERE route_code = 'R_LKO_KAN'), (SELECT id FROM stops WHERE stop_code = 'S_KAN_CENTRAL'), 4, 80.00)
ON CONFLICT DO NOTHING;

-- Delhi - Meerut
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code = 'R_DEL_MRT'), (SELECT id FROM stops WHERE stop_code = 'S_DEL_ANAND_VIHAR'), 1, 0.00),
((SELECT id FROM routes WHERE route_code = 'R_DEL_MRT'), (SELECT id FROM stops WHERE stop_code = 'S_GZB_KAUSHAMBI'), 2, 1.20),
((SELECT id FROM routes WHERE route_code = 'R_DEL_MRT'), (SELECT id FROM stops WHERE stop_code = 'S_GZB_OLD'), 3, 12.00),
((SELECT id FROM routes WHERE route_code = 'R_DEL_MRT'), (SELECT id FROM stops WHERE stop_code = 'S_MODINAGAR'), 4, 45.00),
((SELECT id FROM routes WHERE route_code = 'R_DEL_MRT'), (SELECT id FROM stops WHERE stop_code = 'S_MRT_BHAISALI'), 5, 70.00)
ON CONFLICT DO NOTHING;

-- Seed Buses
INSERT INTO buses (registration_no, bus_type, depot_name)
VALUES
('UP 32 AN 9876', 'Janrath AC', 'Charbagh Depot'),
('UP 32 BG 4321', 'Ordinary', 'Alambagh Depot'),
('UP 14 DT 5566', 'Volvo AC', 'Kaushambi Depot'),
('UP 15 AT 1122', 'Pink Express', 'Meerut Depot')
ON CONFLICT (registration_no) DO NOTHING;

-- ==========================================
-- SAHARANPUR DISTRICT SEED DATA
-- ==========================================

-- Saharanpur Routes
INSERT INTO routes (route_code, route_name, source, destination, distance_km)
VALUES
('R_SRE_BEH_SHK', 'Saharanpur - Behat - Shakumbhari Devi', 'Saharanpur', 'Shakumbhari Devi', 60.00),
('R_SRE_RAM_NAN_DEO', 'Saharanpur - Rampur - Nanauta - Deoband', 'Saharanpur', 'Deoband', 70.00),
('R_SRE_SAR_NAK_GAN', 'Saharanpur - Sarsawa - Nakur - Gangoh', 'Saharanpur', 'Gangoh', 55.00),
('R_SHK_BEH_SRE', 'Shakumbhari Devi - Behat - Saharanpur', 'Shakumbhari Devi', 'Saharanpur', 60.00),
('R_DEO_NAN_RAM_SRE', 'Deoband - Nanauta - Rampur - Saharanpur', 'Deoband', 'Saharanpur', 70.00),
('R_GAN_NAK_SAR_SRE', 'Gangoh - Nakur - Sarsawa - Saharanpur', 'Gangoh', 'Saharanpur', 55.00)
ON CONFLICT (route_code) DO NOTHING;

-- Saharanpur Stops
INSERT INTO stops (stop_code, name, latitude, longitude)
VALUES
('S_SRE_DEPOT', 'Saharanpur Depot', 29.9640, 77.5460),
('S_KAILASHPUR', 'Kailashpur Village', 29.9922, 77.5912),
('S_GAGALHERI', 'Gagalheri Junction', 30.0163, 77.6806),
('S_CHUTMALPUR', 'Chutmalpur Bus Station', 30.0383, 77.7478),
('S_BEHAT', 'Behat Depot', 30.1652, 77.6081),
('S_SHAKUMBHARI', 'Shakumbhari Devi Mandir', 30.3160, 77.6433),
('S_TAPRI', 'Tapri Junction', 29.9042, 77.5752),
('S_RAMPUR_MANIHARAN', 'Rampur Maniharan', 29.8055, 77.4475),
('S_NANAUTA', 'Nanauta Bus Stand', 29.7128, 77.4206),
('S_NAGGAL', 'Naggal Village', 29.8322, 77.6083),
('S_DEOBAND', 'Deoband Depot', 29.6967, 77.6811),
('S_SARSAWA', 'Sarsawa Town', 30.0161, 77.4042),
('S_NAKUR', 'Nakur Bus Stand', 29.9198, 77.3031),
('S_GANGOH', 'Gangoh Bus Stand', 29.7738, 77.2562)
ON CONFLICT (stop_code) DO NOTHING;

-- Saharanpur Route Stops (Route 7: SRE -> BEH -> SHK)
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code='R_SRE_BEH_SHK'),(SELECT id FROM stops WHERE stop_code='S_SRE_DEPOT'),1,0.00),
((SELECT id FROM routes WHERE route_code='R_SRE_BEH_SHK'),(SELECT id FROM stops WHERE stop_code='S_KAILASHPUR'),2,8.00),
((SELECT id FROM routes WHERE route_code='R_SRE_BEH_SHK'),(SELECT id FROM stops WHERE stop_code='S_GAGALHERI'),3,17.00),
((SELECT id FROM routes WHERE route_code='R_SRE_BEH_SHK'),(SELECT id FROM stops WHERE stop_code='S_CHUTMALPUR'),4,24.00),
((SELECT id FROM routes WHERE route_code='R_SRE_BEH_SHK'),(SELECT id FROM stops WHERE stop_code='S_BEHAT'),5,43.00),
((SELECT id FROM routes WHERE route_code='R_SRE_BEH_SHK'),(SELECT id FROM stops WHERE stop_code='S_SHAKUMBHARI'),6,60.00)
ON CONFLICT DO NOTHING;

-- Route 8: SRE -> RAM -> NAN -> DEO
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code='R_SRE_RAM_NAN_DEO'),(SELECT id FROM stops WHERE stop_code='S_SRE_DEPOT'),1,0.00),
((SELECT id FROM routes WHERE route_code='R_SRE_RAM_NAN_DEO'),(SELECT id FROM stops WHERE stop_code='S_TAPRI'),2,8.00),
((SELECT id FROM routes WHERE route_code='R_SRE_RAM_NAN_DEO'),(SELECT id FROM stops WHERE stop_code='S_RAMPUR_MANIHARAN'),3,22.00),
((SELECT id FROM routes WHERE route_code='R_SRE_RAM_NAN_DEO'),(SELECT id FROM stops WHERE stop_code='S_NANAUTA'),4,35.00),
((SELECT id FROM routes WHERE route_code='R_SRE_RAM_NAN_DEO'),(SELECT id FROM stops WHERE stop_code='S_NAGGAL'),5,52.00),
((SELECT id FROM routes WHERE route_code='R_SRE_RAM_NAN_DEO'),(SELECT id FROM stops WHERE stop_code='S_DEOBAND'),6,70.00)
ON CONFLICT DO NOTHING;

-- Route 9: SRE -> SAR -> NAK -> GAN
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code='R_SRE_SAR_NAK_GAN'),(SELECT id FROM stops WHERE stop_code='S_SRE_DEPOT'),1,0.00),
((SELECT id FROM routes WHERE route_code='R_SRE_SAR_NAK_GAN'),(SELECT id FROM stops WHERE stop_code='S_SARSAWA'),2,15.00),
((SELECT id FROM routes WHERE route_code='R_SRE_SAR_NAK_GAN'),(SELECT id FROM stops WHERE stop_code='S_NAKUR'),3,32.00),
((SELECT id FROM routes WHERE route_code='R_SRE_SAR_NAK_GAN'),(SELECT id FROM stops WHERE stop_code='S_GANGOH'),4,55.00)
ON CONFLICT DO NOTHING;

-- Route 10: SHK -> BEH -> SRE (return)
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code='R_SHK_BEH_SRE'),(SELECT id FROM stops WHERE stop_code='S_SHAKUMBHARI'),1,0.00),
((SELECT id FROM routes WHERE route_code='R_SHK_BEH_SRE'),(SELECT id FROM stops WHERE stop_code='S_BEHAT'),2,17.00),
((SELECT id FROM routes WHERE route_code='R_SHK_BEH_SRE'),(SELECT id FROM stops WHERE stop_code='S_CHUTMALPUR'),3,36.00),
((SELECT id FROM routes WHERE route_code='R_SHK_BEH_SRE'),(SELECT id FROM stops WHERE stop_code='S_GAGALHERI'),4,43.00),
((SELECT id FROM routes WHERE route_code='R_SHK_BEH_SRE'),(SELECT id FROM stops WHERE stop_code='S_KAILASHPUR'),5,52.00),
((SELECT id FROM routes WHERE route_code='R_SHK_BEH_SRE'),(SELECT id FROM stops WHERE stop_code='S_SRE_DEPOT'),6,60.00)
ON CONFLICT DO NOTHING;

-- Route 11: DEO -> NAN -> RAM -> SRE (return)
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code='R_DEO_NAN_RAM_SRE'),(SELECT id FROM stops WHERE stop_code='S_DEOBAND'),1,0.00),
((SELECT id FROM routes WHERE route_code='R_DEO_NAN_RAM_SRE'),(SELECT id FROM stops WHERE stop_code='S_NAGGAL'),2,18.00),
((SELECT id FROM routes WHERE route_code='R_DEO_NAN_RAM_SRE'),(SELECT id FROM stops WHERE stop_code='S_NANAUTA'),3,35.00),
((SELECT id FROM routes WHERE route_code='R_DEO_NAN_RAM_SRE'),(SELECT id FROM stops WHERE stop_code='S_RAMPUR_MANIHARAN'),4,48.00),
((SELECT id FROM routes WHERE route_code='R_DEO_NAN_RAM_SRE'),(SELECT id FROM stops WHERE stop_code='S_TAPRI'),5,62.00),
((SELECT id FROM routes WHERE route_code='R_DEO_NAN_RAM_SRE'),(SELECT id FROM stops WHERE stop_code='S_SRE_DEPOT'),6,70.00)
ON CONFLICT DO NOTHING;

-- Route 12: GAN -> NAK -> SAR -> SRE (return)
INSERT INTO route_stops (route_id, stop_id, sequence_no, distance_from_start_km)
VALUES
((SELECT id FROM routes WHERE route_code='R_GAN_NAK_SAR_SRE'),(SELECT id FROM stops WHERE stop_code='S_GANGOH'),1,0.00),
((SELECT id FROM routes WHERE route_code='R_GAN_NAK_SAR_SRE'),(SELECT id FROM stops WHERE stop_code='S_NAKUR'),2,23.00),
((SELECT id FROM routes WHERE route_code='R_GAN_NAK_SAR_SRE'),(SELECT id FROM stops WHERE stop_code='S_SARSAWA'),3,40.00),
((SELECT id FROM routes WHERE route_code='R_GAN_NAK_SAR_SRE'),(SELECT id FROM stops WHERE stop_code='S_SRE_DEPOT'),4,55.00)
ON CONFLICT DO NOTHING;

-- Saharanpur Buses
INSERT INTO buses (registration_no, bus_type, depot_name)
VALUES
('UP 11 AT 1234', 'Ordinary', 'Saharanpur Depot'),
('UP 11 BT 5678', 'Janrath AC', 'Saharanpur Depot'),
('UP 11 CT 9012', 'Ordinary', 'Saharanpur Depot'),
('UP 11 DT 3456', 'Pink Express', 'Saharanpur Depot'),
('UP 11 ET 7890', 'Ordinary', 'Saharanpur Depot'),
('UP 11 FT 4321', 'Volvo AC', 'Saharanpur Depot')
ON CONFLICT (registration_no) DO NOTHING;
