"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gpsIngestionQueue = exports.GPSIngestionQueue = void 0;
const redis_1 = require("redis");
const db_1 = require("../db");
/**
 * GPS Ingestion Queue using Redis Streams.
 * This guarantees strict chronological processing of GPS pings per vehicle,
 * preventing Race Conditions where an older ping overrides a newer one.
 */
class GPSIngestionQueue {
    client;
    isConnected = false;
    constructor() {
        this.client = (0, redis_1.createClient)({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });
        this.client.on('error', (err) => console.error('Redis Client Error', err));
    }
    async connect() {
        if (!this.isConnected) {
            await this.client.connect();
            this.isConnected = true;
            console.log('Connected to Redis Streams for GPS Ingestion');
        }
    }
    /**
     * Pushes a new GPS ping to the Redis Stream.
     * Uses vehicle_id as part of the stream key to partition the data,
     * guaranteeing that a single consumer group processes a vehicle sequentially.
     */
    async publishGPSPing(vehicleId, tripId, lat, lng, speed, heading, timestamp) {
        if (!this.isConnected)
            await this.connect();
        const streamKey = `gps_stream:vehicle:${vehicleId}`;
        // XADD adds the message to the stream.
        // MAXLEN ~ 1000 keeps the stream from growing indefinitely.
        await this.client.xAdd(streamKey, '*', // Auto-generate ID
        {
            tripId: tripId.toString(),
            lat: lat.toString(),
            lng: lng.toString(),
            speed: speed.toString(),
            heading: heading.toString(),
            timestamp: timestamp.toISOString()
        }, {
            TRIM: {
                strategy: 'MAXLEN',
                strategyModifier: '~',
                threshold: 1000
            }
        });
    }
    /**
     * Background consumer function that reads from the streams.
     * In a real enterprise app, this would run in a separate worker process.
     */
    async consumeGPSPings(vehicleId) {
        if (!this.isConnected)
            await this.connect();
        const streamKey = `gps_stream:vehicle:${vehicleId}`;
        let lastId = '0-0'; // Start reading from the beginning of unread
        while (true) {
            try {
                // Block for 5000ms waiting for a new message
                const response = await this.client.xRead({ key: streamKey, id: lastId }, { BLOCK: 5000, COUNT: 1 });
                if (response) {
                    const messages = response[0].messages;
                    for (const msg of messages) {
                        lastId = msg.id; // Update lastId for the next read
                        const data = msg.message;
                        const tripId = parseInt(data.tripId);
                        const lat = parseFloat(data.lat);
                        const lng = parseFloat(data.lng);
                        const speed = parseFloat(data.speed);
                        const heading = parseFloat(data.heading);
                        const timestamp = new Date(data.timestamp);
                        // Here we would check if this timestamp is strictly newer than the
                        // last processed timestamp for this vehicle (stored in memory or DB)
                        // If older, discard immediately to prevent jitter.
                        // Process the valid ping: Save to DB, Map Match, FSM Update
                        await this.processValidPing(vehicleId, tripId, lat, lng, speed, heading, timestamp);
                    }
                }
            }
            catch (err) {
                console.error(`Error consuming stream for vehicle ${vehicleId}:`, err);
                // Sleep briefly on error before retrying
                await new Promise(res => setTimeout(res, 1000));
            }
        }
    }
    async processValidPing(vehicleId, tripId, lat, lng, speed, heading, timestamp) {
        // 1. Update the bus_live_state table
        await (0, db_1.query)(`INSERT INTO bus_live_state (bus_id, trip_id, latitude, longitude, speed, heading, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bus_id) 
       DO UPDATE SET 
         trip_id = EXCLUDED.trip_id,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         speed = EXCLUDED.speed,
         heading = EXCLUDED.heading,
         last_seen_at = EXCLUDED.last_seen_at
       WHERE EXCLUDED.last_seen_at >= bus_live_state.last_seen_at`, [vehicleId, tripId, lat, lng, speed, heading, timestamp]);
        // 2. Further processing (Map Matching, ETA updates, etc.) happens here
        // e.g. updateBusFSM(...)
    }
}
exports.GPSIngestionQueue = GPSIngestionQueue;
exports.gpsIngestionQueue = new GPSIngestionQueue();
