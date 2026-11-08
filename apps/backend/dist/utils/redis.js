"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRedis = initRedis;
exports.redisGet = redisGet;
exports.redisSet = redisSet;
const redis_1 = require("redis");
let client = null;
let isFallback = false;
const localMap = new Map();
async function initRedis() {
    try {
        client = (0, redis_1.createClient)({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
        client.on('error', (err) => {
            if (!isFallback) {
                console.log('[Redis] Local server offline, fell back to fast in-memory map cache.');
                isFallback = true;
            }
        });
        await client.connect();
        console.log('[Redis] Connected successfully.');
    }
    catch (err) {
        console.log('[Redis] Local server offline, fell back to fast in-memory map cache.');
        isFallback = true;
    }
}
async function redisGet(key) {
    if (isFallback || !client) {
        const val = localMap.get(key);
        return val ? JSON.parse(val) : null;
    }
    try {
        const val = await client.get(key);
        return val ? JSON.parse(val) : null;
    }
    catch {
        const val = localMap.get(key);
        return val ? JSON.parse(val) : null;
    }
}
async function redisSet(key, value, ttlSeconds) {
    const strVal = JSON.stringify(value);
    localMap.set(key, strVal);
    if (!isFallback && client) {
        try {
            if (ttlSeconds) {
                await client.setEx(key, ttlSeconds, strVal);
            }
            else {
                await client.set(key, strVal);
            }
        }
        catch {
            // ignore and keep localMap updated
        }
    }
}
// Automatically fire init on startup
initRedis().catch(() => { });
