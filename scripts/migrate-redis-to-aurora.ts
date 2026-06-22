// ============================================================
// scripts/migrate-redis-to-aurora.ts
//
// NON-DESTRUCTIVE legacy copy helper. Scans every kk:book:* in
// Upstash Redis, validates the payload, and upserts it into Aurora
// so the durable layer has a copy of pre-Aurora stories.
//
// SAFETY (hard rules):
//   - Disabled unless MIGRATE_LEGACY=true.
//   - NEVER deletes, renames, or rewrites any Redis key. The
//     original kk:book:* entries stay exactly where they are with
//     their original TTLs.
//   - Validates each book before copying; malformed entries are
//     skipped and reported, not copied.
//   - Counts Redis keys before and after to PROVE the count is
//     unchanged.
//
// Run:  MIGRATE_LEGACY=true npm run migrate:legacy
// ============================================================

import './_loadEnv';
import { getRedis } from '@/lib/redis';
import { isAuroraEnabled } from '@/lib/db/aurora';
import { upsertStory } from '@/lib/storage/storyStore';
import type { GeneratedBook } from '@/lib/openai/bookGeneratorAgent';

function isValidBook(b: unknown): b is GeneratedBook {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return typeof o.slug === 'string' && !!o.slug
    && typeof o.title === 'string' && !!o.title
    && Array.isArray(o.scenes);
}

async function countBookKeys(r: NonNullable<ReturnType<typeof getRedis>>): Promise<number> {
  let cursor = '0';
  let n = 0;
  do {
    const [next, keys] = await r.scan(cursor, { match: 'kk:book:*', count: 100 });
    cursor = next;
    // exclude lock / character sub-keys
    n += (keys as string[]).filter(k => !k.endsWith(':lock') && !k.endsWith(':characters')).length;
  } while (cursor !== '0');
  return n;
}

(async () => {
  if (process.env.MIGRATE_LEGACY !== 'true') {
    console.error('[migrate-legacy] Disabled. Set MIGRATE_LEGACY=true to run.');
    console.error('[migrate-legacy] This helper is non-destructive but opt-in by design.');
    process.exit(1);
  }
  if (!isAuroraEnabled()) {
    console.error('[migrate-legacy] USE_AURORA=false or DATABASE_URL missing. Nothing to do.');
    process.exit(1);
  }

  const r = getRedis();
  if (!r) { console.error('[migrate-legacy] Upstash not configured.'); process.exit(1); }

  const before = await countBookKeys(r);
  console.log(`[migrate-legacy] Redis kk:book:* count BEFORE: ${before}`);

  let cursor = '0';
  let scanned = 0, copied = 0, skipped = 0;
  do {
    const [next, keys] = await r.scan(cursor, { match: 'kk:book:*', count: 50 });
    cursor = next;
    const bookKeys = (keys as string[]).filter(k => !k.endsWith(':lock') && !k.endsWith(':characters'));
    for (const key of bookKeys) {
      scanned++;
      try {
        const book = await r.get<GeneratedBook>(key);
        if (!isValidBook(book)) { skipped++; console.warn(`[migrate-legacy] skip ${key}: invalid payload`); continue; }
        const ok = await upsertStory(book);
        if (ok) { copied++; console.log(`[migrate-legacy] ✓ copied ${key} → Aurora (Redis key untouched)`); }
        else { skipped++; console.warn(`[migrate-legacy] skip ${key}: Aurora upsert returned false`); }
      } catch (err) {
        skipped++;
        console.warn(`[migrate-legacy] skip ${key}:`, err instanceof Error ? err.message : String(err));
      }
    }
  } while (cursor !== '0');

  const after = await countBookKeys(r);
  console.log(`[migrate-legacy] scanned=${scanned} copied=${copied} skipped=${skipped}`);
  console.log(`[migrate-legacy] Redis kk:book:* count AFTER:  ${after}`);
  if (after !== before) {
    console.error(`[migrate-legacy] !! Redis count changed (${before} → ${after}). This helper never deletes; investigate.`);
    process.exit(2);
  } else {
    console.log('[migrate-legacy] ✓ Redis count unchanged — originals intact.');
  }
})().catch((err: unknown) => {
  console.error('[migrate-legacy] crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});