// ============================================================
// scripts/flush-stale-redis.ts
//
// Drops the pre-Wave-1.1 TTS cache entries from Upstash Redis.
//
// Why: Wave 1.1 added `tone` and `mood` segments to the TTS cache
// key. Old keys without those segments will never be hit again
// (the new code always writes a `|tone:auto|mood:none` suffix even
// for neutral calls), but they're still on Upstash taking memory
// and TTL slots. Flushing them reclaims that space and avoids
// stale-cache confusion when a future cache-key change happens.
//
// Safety:
//   - Default is --dry-run. Listing only, no deletes.
//   - --apply actually issues DEL. Each deletion is logged.
//   - Only touches kk:cache:type:tts|… keys. Branch / manifest /
//     character caches are not affected.
//
// Cost:
//   - Re-narration on the next render of an unchanged scene costs
//     one Sarvam call (~$0.01 per scene). Cached again immediately
//     with the new key shape. ~$0.30 worst case for full Ramayana.
//
// Usage:
//   npm run flush:stale -- --dry-run     # default
//   npm run flush:stale -- --apply       # actually delete
//   npm run flush:stale -- --apply --pattern 'kk:cache:type:character|*'
// ============================================================

import './_loadEnv';

import { getRedis, isRedisConfigured } from '../lib/redis';

interface Args {
  apply: boolean;
  pattern: string;
  /** When true, treat ALL TTS keys as stale — including ones that
   *  already have tone/mood segments. Useful if the cache key shape
   *  changes again. Default false (only flush pre-1.1 keys). */
  flushAll: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const flushAll = argv.includes('--flush-all');
  const patternArg = argv.find(a => a.startsWith('--pattern='))?.slice('--pattern='.length);
  // The pattern targets the Wave-1.1 cache shape: keys built by
  // buildCacheKey({ type: 'tts', text, hash, character, lang, tone, mood }).
  const pattern = patternArg ?? 'kk:cache:type:tts*';
  return { apply, pattern, flushAll };
}

/** A key is "stale" when it doesn't carry the |tone:* segment that
 *  Wave 1.1 introduced. Any new TTS key written by the post-1.1
 *  router includes `|tone:` (even for the neutral path, which writes
 *  `|tone:auto`), so absence of that segment uniquely identifies
 *  pre-1.1 keys.
 */
function isStaleKey(key: string): boolean {
  return !key.includes('|tone:');
}

async function main() {
  const args = parseArgs();
  if (!isRedisConfigured()) {
    console.error('[flush-stale-redis] UPSTASH_REDIS_REST_URL / TOKEN not set');
    process.exit(2);
  }
  const r = getRedis()!;

  console.log(`[flush-stale-redis] pattern=${args.pattern} apply=${args.apply} flushAll=${args.flushAll}`);

  const stale: string[] = [];
  const fresh: string[] = [];
  let cursor: string | number = 0;
  let scans = 0;
  do {
    const [next, keys] = (await r.scan(cursor, { match: args.pattern, count: 500 })) as [string, string[]];
    cursor = next;
    scans++;
    for (const k of keys) {
      if (args.flushAll || isStaleKey(k)) stale.push(k);
      else fresh.push(k);
    }
    if (scans > 80) break; // safety
  } while (String(cursor) !== '0');

  console.log(`[flush-stale-redis] scanned: ${stale.length + fresh.length} keys`);
  console.log(`[flush-stale-redis]   stale (${args.flushAll ? 'all matching pattern' : 'pre-1.1 shape'}): ${stale.length}`);
  console.log(`[flush-stale-redis]   fresh (Wave 1.1+): ${fresh.length}`);

  if (stale.length === 0) {
    console.log('[flush-stale-redis] nothing to flush ✓');
    return;
  }

  if (!args.apply) {
    console.log('\n[flush-stale-redis] DRY RUN — re-run with --apply to delete.');
    console.log('[flush-stale-redis] sample stale keys:');
    for (const k of stale.slice(0, 8)) console.log(`  ${k}`);
    if (stale.length > 8) console.log(`  … and ${stale.length - 8} more`);
    return;
  }

  // Delete in small batches so a single network blip can't lose
  // progress for the whole set.
  const BATCH = 50;
  let deleted = 0;
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH);
    // Upstash supports variadic DEL via the REST client.
    await r.del(...batch);
    deleted += batch.length;
    if ((deleted / BATCH) % 4 === 0) {
      console.log(`  · deleted ${deleted}/${stale.length}…`);
    }
  }
  console.log(`[flush-stale-redis] done: ${deleted} keys deleted`);
}

main().catch(err => {
  console.error('[flush-stale-redis] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
