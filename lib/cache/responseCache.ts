// ============================================================
// KathaKitaab.ai — Universal Response Cache
// Uses globalThis to survive Next.js dev mode hot reloads.
// ============================================================

interface CachedEntry {
  data: unknown;
  timestamp: number;
  model_used: string;
  hit_count: number;
  /** Per-entry TTL override (ms). Falls back to default 24h if absent. */
  ttl_ms?: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours default

// Use globalThis to persist cache across hot module reloads in dev
const CACHE_KEY = '__kathakitaab_cache__';

function getCache(): Map<string, CachedEntry> {
  const g = globalThis as unknown as Record<string, Map<string, CachedEntry>>;
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = new Map<string, CachedEntry>();
  }
  return g[CACHE_KEY];
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
export function getCachedResponse(key: string): unknown | null {
  const cache = getCache();
  const entry = cache.get(key);
  if (!entry) return null;
  const ttl = entry.ttl_ms ?? TTL_MS;
  if (Date.now() - entry.timestamp > ttl) { cache.delete(key); return null; }
  entry.hit_count++;
  // Refresh LRU position so frequently-used entries don't get evicted.
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
}

// LRU bound. Image/audio entries can be ~1MB each (base64 PNG, WAV);
// without a cap the cache can grow into the gigabytes during a long
// dev session and crash the Node process. Keeping the most-recently-
// used N entries is good enough — older ones can be regenerated.
// 200 × ~1MB-per-image-entry ≈ 200MB worst case. Lower than this and
// frequently-used branches keep getting evicted; higher and dev mode
// heap creeps toward the 4GB+ pressure threshold.
const MAX_ENTRIES = numEnv('RESPONSE_CACHE_MAX_ENTRIES', 200);

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---- Write ----
export function setCachedResponse(
  key: string,
  data: unknown,
  modelUsed = 'gemini-2.5-flash',
  ttlMs?: number,
): void {
  const cache = getCache();
  // Refresh LRU position by deleting then re-adding.
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { data, timestamp: Date.now(), model_used: modelUsed, hit_count: 0, ttl_ms: ttlMs });
  // Evict oldest insertions until we're back under the cap.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ---- Stats ----
export function getCacheStats() {
  const cache = getCache();
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}

export function clearCache(): void { getCache().clear(); }
