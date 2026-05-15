// ============================================================
// KathaKitaab — Universal Response Cache
//
// Backed by Upstash Redis when configured, otherwise an in-memory
// LRU Map. Async API either way so callers don't have to know which
// store is in use.
//
// Why this matters on Vercel:
//   - Each serverless function instance has its own Node heap.
//     A pure in-memory cache only helps within a single warm
//     instance — most requests miss because they hit different
//     instances. Redis fixes that.
//   - Image-base64 entries (~1MB each) used to crash dev with
//     "Ineffective mark-compacts near heap limit" once a few
//     hundred had piled up. Redis offloads that pressure entirely.
// ============================================================

import { getRedis } from '@/lib/redis';

interface CachedEntry {
  data: unknown;
  timestamp: number;
  model_used: string;
  hit_count: number;
  /** Per-entry TTL override (ms). Falls back to default 24h if absent. */
  ttl_ms?: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours default

const CACHE_KEY = '__kathakitaab_cache__';

function getLocalCache(): Map<string, CachedEntry> {
  const g = globalThis as unknown as Record<string, Map<string, CachedEntry>>;
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = new Map<string, CachedEntry>();
  }
  return g[CACHE_KEY];
}

function redisKey(k: string): string {
  return `kk:cache:${k}`;
}

// ---- Key Builder ----
export function buildCacheKey(parts: Record<string, string | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${normalize(v!)}`)
    .join('|');
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

// ---- Read ----
export async function getCachedResponse(key: string): Promise<unknown | null> {
  const redis = getRedis();
  if (redis) {
    const entry = await redis.get<CachedEntry>(redisKey(key));
    return entry?.data ?? null;
  }
  return getLocalCached(key);
}

function getLocalCached(key: string): unknown | null {
  const cache = getLocalCache();
  const entry = cache.get(key);
  if (!entry) return null;
  const ttl = entry.ttl_ms ?? TTL_MS;
  if (Date.now() - entry.timestamp > ttl) { cache.delete(key); return null; }
  entry.hit_count++;
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

const MAX_ENTRIES = numEnv('RESPONSE_CACHE_MAX_ENTRIES', 200);

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---- Write ----
export async function setCachedResponse(
  key: string,
  data: unknown,
  modelUsed = 'gemini-2.5-flash',
  ttlMs?: number,
): Promise<void> {
  const entry: CachedEntry = { data, timestamp: Date.now(), model_used: modelUsed, hit_count: 0, ttl_ms: ttlMs };
  const redis = getRedis();
  if (redis) {
    const ex = Math.ceil((ttlMs ?? TTL_MS) / 1000);
    await redis.set(redisKey(key), entry, { ex });
    return;
  }
  setLocalCached(key, entry);
}

function setLocalCached(key: string, entry: CachedEntry): void {
  const cache = getLocalCache();
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ---- Stats ----
export function getCacheStats() {
  const cache = getLocalCache();
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
    backend: getRedis() ? 'redis' : 'memory',
  };
}

export async function clearCache(): Promise<void> {
  getLocalCache().clear();
  // Redis isn't flushed here — the DB might be shared. Per-key
  // deletion would need a SCAN, not worth it for a dev-only call.
}
