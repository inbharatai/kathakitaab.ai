// ============================================================
// KathaKitaab — Upstash Redis Client (singleton)
//
// One client for the whole app. When UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN are set, modules that need shared
// cross-instance state (rate limit, branch image jobs, response
// cache) use Redis. Otherwise they fall back to process-local
// Maps so local dev still works without credentials.
// ============================================================

import { Redis } from '@upstash/redis';

// Cache the resolution so we don't read env / construct a client per call.
// `undefined` = not yet checked. `null` = checked, not configured.
let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token });
  return cached;
}

export function isRedisConfigured(): boolean {
  return getRedis() !== null;
}
