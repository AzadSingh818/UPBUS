// Simple in-memory fallback client or real Redis bridge
import { createClient } from 'redis';

let client: any = null;
let isFallback = false;
const localMap = new Map<string, string>();

export async function initRedis() {
  try {
    client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    client.on('error', (err: any) => {
      if (!isFallback) {
        console.log('[Redis] Local server offline, fell back to fast in-memory map cache.');
        isFallback = true;
      }
    });
    await client.connect();
    console.log('[Redis] Connected successfully.');
  } catch (err) {
    console.log('[Redis] Local server offline, fell back to fast in-memory map cache.');
    isFallback = true;
  }
}

export async function redisGet(key: string): Promise<any | null> {
  if (isFallback || !client) {
    const val = localMap.get(key);
    return val ? JSON.parse(val) : null;
  }
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    const val = localMap.get(key);
    return val ? JSON.parse(val) : null;
  }
}

export async function redisSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const strVal = JSON.stringify(value);
  localMap.set(key, strVal);
  if (!isFallback && client) {
    try {
      if (ttlSeconds) {
        await client.setEx(key, ttlSeconds, strVal);
      } else {
        await client.set(key, strVal);
      }
    } catch {
      // ignore and keep localMap updated
    }
  }
}

// Automatically fire init on startup
initRedis().catch(() => {});
