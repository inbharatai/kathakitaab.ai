// ============================================================
// KathaKitaab — Per-IP Rate Limiter
//
// Uses Upstash Ratelimit (Redis sliding window) when configured —
// required on Vercel since each function instance has its own
// Node heap and an in-memory Map can't enforce a single global
// limit across instances. Falls back to an in-memory Map when no
// Upstash credentials are present (local dev / single-process
// hosts), so nothing breaks if you run without Redis.
//
// Three scopes:
//   - 'default'   : RATE_LIMIT_PER_MIN          (default 30/min)
//   - 'expensive' : RATE_LIMIT_EXPENSIVE_PER_MIN (default 10/min)
//   - 'tts'       : RATE_LIMIT_TTS_PER_MIN       (default 60/min)
//
// TTS gets its own generous bucket because narration fires on every
// scene change AND every branch click — being throttled there breaks
// the experience. Routes that hit OpenAI/Gemini for image/scene
// generation use 'expensive'. Cheaper routes use default.
// ============================================================

import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from '@/lib/redis';

interface Bucket {
  hits: number[];
}

// In-memory fallback only.
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = numEnv('RATE_LIMIT_PER_MIN', 30);
const EXPENSIVE_LIMIT = numEnv('RATE_LIMIT_EXPENSIVE_PER_MIN', 10);
const TTS_LIMIT = numEnv('RATE_LIMIT_TTS_PER_MIN', 60);

function numEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type RateLimitScope = 'default' | 'expensive' | 'tts';

export interface RateLimitOptions {
  scope?: RateLimitScope;
  limit?: number;
  windowMs?: number;
}

// Cache one Ratelimit instance per scope. Building a new one per call
// would still work (it's cheap) but the singleton avoids re-reading
// env every request.
const RL_CACHE: Partial<Record<RateLimitScope, Ratelimit>> = {};

function getUpstashRatelimit(scope: RateLimitScope): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  if (RL_CACHE[scope]) return RL_CACHE[scope]!;
  const limit = scope === 'expensive' ? EXPENSIVE_LIMIT : scope === 'tts' ? TTS_LIMIT : DEFAULT_LIMIT;
  RL_CACHE[scope] = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, '60 s'),
    prefix: `kk:rl:${scope}`,
    analytics: false,
  });
  return RL_CACHE[scope]!;
}

export async function checkRateLimit(req: Request, opts: RateLimitOptions = {}): Promise<NextResponse | null> {
  const scope = opts.scope ?? 'default';
  const limit = opts.limit ?? (
    scope === 'expensive' ? EXPENSIVE_LIMIT
    : scope === 'tts' ? TTS_LIMIT
    : DEFAULT_LIMIT
  );

  const ip = getClientIp(req);

  // Upstash path: shared sliding window across all function instances.
  const upstash = getUpstashRatelimit(scope);
  if (upstash) {
    const result = await upstash.limit(ip);
    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return NextResponse.json(
        {
          error: 'rate_limited',
          message: 'Too many requests. Please slow down.',
          retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(result.limit),
            'X-RateLimit-Remaining': String(result.remaining),
          },
        },
      );
    }
    return null;
  }

  // In-memory fallback.
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const key = `${scope}:${ip}`;
  const now = Date.now();

  if (Math.random() < 0.01) gcBuckets(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  bucket.hits = bucket.hits.filter(t => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: 'Too many requests. Please slow down.',
        retryAfter,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  bucket.hits.push(now);
  return null;
}

function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  return 'unknown';
}

function gcBuckets(now: number) {
  const cutoff = now - WINDOW_MS * 2;
  for (const [k, b] of buckets) {
    const fresh = b.hits.filter(t => t > cutoff);
    if (fresh.length === 0) {
      buckets.delete(k);
    } else {
      b.hits = fresh;
    }
  }
}

// Concurrency-limited batch runner. Used by pregenerate-branches
// to cap parallel OpenAI calls.
export async function runInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item, j) => fn(item, i + j)));
    results.push(...batchResults);
  }
  return results;
}

export const MAX_PARALLEL_BRANCHES = numEnv('MAX_PARALLEL_BRANCHES', 2);

// ============================================================
// Owner-cookie daily limits for child-related modes
//
// These run AFTER the per-IP `checkRateLimit` so an attacker who
// rotates IPs is still capped by their cookie. The cookie is
// trivially clearable by a determined adversary, but combined
// with the per-IP limit it raises the cost of accidental abuse
// (a sibling spamming the form, or one parent generating 50
// stories in an afternoon).
//
// Limits:
//   personalized_text : 3 books per ownerId per 24h
//   classroom         : 8 books per ownerId per 24h
//
// Tunable via env: KATHA_PERSONALIZED_DAILY, KATHA_CLASSROOM_DAILY.
// ============================================================

const DAILY_PERSONALIZED = numEnv('KATHA_PERSONALIZED_DAILY', 3);
const DAILY_CLASSROOM = numEnv('KATHA_CLASSROOM_DAILY', 8);
const DAY_MS = 24 * 60 * 60 * 1000;

const ownerBuckets = new Map<string, number[]>();

const RL_OWNER_CACHE: Partial<Record<'personalized' | 'classroom', Ratelimit>> = {};

function getOwnerLimiter(kind: 'personalized' | 'classroom'): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  if (RL_OWNER_CACHE[kind]) return RL_OWNER_CACHE[kind]!;
  const limit = kind === 'personalized' ? DAILY_PERSONALIZED : DAILY_CLASSROOM;
  RL_OWNER_CACHE[kind] = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, '24 h'),
    prefix: `kk:rl:owner:${kind}`,
    analytics: false,
  });
  return RL_OWNER_CACHE[kind]!;
}

/** Per-owner daily rate limit. Pass the cookie owner ID and the
 *  mode being requested. Returns a 429 NextResponse if the limit
 *  is hit, null otherwise. World mode is NOT limited here (it
 *  uses the per-IP `checkRateLimit` exclusively).
 */
export async function checkOwnerDailyLimit(
  ownerId: string,
  kind: 'personalized' | 'classroom',
): Promise<NextResponse | null> {
  if (!ownerId) return null;

  const upstash = getOwnerLimiter(kind);
  if (upstash) {
    const result = await upstash.limit(ownerId);
    if (!result.success) {
      const retryAfter = Math.max(60, Math.ceil((result.reset - Date.now()) / 1000));
      return NextResponse.json({
        error: 'rate_limited',
        message: kind === 'personalized'
          ? 'You\'ve created the daily maximum of personalized stories. Please try again tomorrow.'
          : 'You\'ve created the daily maximum of classroom stories. Please try again tomorrow.',
        retryAfter,
      }, {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
        },
      });
    }
    return null;
  }

  // In-memory fallback (local dev). Same shape as the per-IP path.
  const limit = kind === 'personalized' ? DAILY_PERSONALIZED : DAILY_CLASSROOM;
  const key = `${kind}:${ownerId}`;
  const now = Date.now();
  const hits = (ownerBuckets.get(key) ?? []).filter(t => now - t < DAY_MS);
  if (hits.length >= limit) {
    const retryAfter = Math.max(60, Math.ceil((DAY_MS - (now - hits[0])) / 1000));
    return NextResponse.json({
      error: 'rate_limited',
      message: kind === 'personalized'
        ? 'You\'ve created the daily maximum of personalized stories. Please try again tomorrow.'
        : 'You\'ve created the daily maximum of classroom stories. Please try again tomorrow.',
      retryAfter,
    }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }
  hits.push(now);
  ownerBuckets.set(key, hits);
  return null;
}
