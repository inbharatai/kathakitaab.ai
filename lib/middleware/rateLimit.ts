// ============================================================
// KathaKitaab.ai — Per-IP Rate Limiter (in-memory, single instance)
//
// No Redis dependency. Uses a sliding-window Map<ip, hits[]>.
// Good enough for early traffic; swap to Upstash/Redis when
// the app scales horizontally across instances.
//
// Three scopes:
//   - 'default'   : RATE_LIMIT_PER_MIN          (default 30/min)
//   - 'expensive' : RATE_LIMIT_EXPENSIVE_PER_MIN (default 10/min)
//   - 'tts'       : RATE_LIMIT_TTS_PER_MIN       (default 60/min)
//
// TTS gets its own generous bucket because narration fires on every
// scene change AND every branch click — it's the user-visible audio
// path, so being throttled here breaks the experience. Routes that
// hit OpenAI/Gemini for image/scene generation use 'expensive'.
// Cheaper routes (classify, quiz answer) use default.
// ============================================================

import { NextResponse } from 'next/server';

interface Bucket {
  hits: number[];
}

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

export function checkRateLimit(req: Request, opts: RateLimitOptions = {}): NextResponse | null {
  const scope = opts.scope ?? 'default';
  const limit = opts.limit ?? (
    scope === 'expensive' ? EXPENSIVE_LIMIT
    : scope === 'tts' ? TTS_LIMIT
    : DEFAULT_LIMIT
  );
  const windowMs = opts.windowMs ?? WINDOW_MS;

  const ip = getClientIp(req);
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
