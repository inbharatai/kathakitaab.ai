// ============================================================
// scripts/clean-stale.ts
//
// Sweep stale data that can interfere with fresh generation:
//
//   1. Upstash Redis  — wipe every key under our `kk:` prefix.
//      The cache key shape changed (added bookSlug/actionType/theme),
//      so old entries can't match anyway, but they still occupy
//      memory. Branches, scenes, and entity-interact responses all
//      live under this prefix and regenerate cleanly on next request.
//
//   2. Supabase Storage — list every object in the `scene-images`
//      bucket and remove anything older than `--older-than-days N`
//      that *isn't* under the `*/anchors/` path. Anchors are the
//      pre-baked portraits we want to keep; everything else is a
//      regenerable per-scene PNG. Default: 7 days.
//
//   3. Supabase tables  — `--reset-scenes` truncates the `scenes`
//      and `scene_branches` tables (DB-side stories). Off by default
//      since destroying user-saved scenes is irreversible; opt in
//      explicitly when you want a clean slate.
//
// Universal: works for any deployment. No book-specific logic.
//
// Usage:
//   npx tsx scripts/clean-stale.ts                # Redis only
//   npx tsx scripts/clean-stale.ts --supabase     # + storage sweep (7d)
//   npx tsx scripts/clean-stale.ts --supabase --older-than-days 1
//   npx tsx scripts/clean-stale.ts --reset-scenes # + DB truncate
//   npx tsx scripts/clean-stale.ts --dry-run      # report only
// ============================================================

import './_loadEnv';

import { getRedis } from '../lib/redis';
import { getSupabaseService } from '../lib/supabase';

const BUCKET = 'scene-images';

interface Flags {
  supabase: boolean;
  resetScenes: boolean;
  olderThanDays: number;
  dryRun: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { supabase: false, resetScenes: false, olderThanDays: 7, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--supabase') flags.supabase = true;
    else if (a === '--reset-scenes') flags.resetScenes = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--older-than-days') flags.olderThanDays = Math.max(0, Number(argv[++i]) || 7);
  }
  return flags;
}

async function cleanRedis(dry: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    console.log('[redis] not configured — skipping');
    return;
  }
  // Upstash REST does not stream SCAN; fetch keys in batches via the
  // `keys` command. Fine for our scale (< few thousand entries).
  // Each prefix gets swept independently so we know what we touched.
  const prefixes = ['kk:cache:*', 'kk:branch-image:*', 'kk:rate:*', 'kk:branch-pregen:*', 'kk:branch-manifest:*'];
  for (const pattern of prefixes) {
    const keys = await redis.keys(pattern);
    if (keys.length === 0) {
      console.log(`[redis] ${pattern}: 0 keys`);
      continue;
    }
    if (dry) {
      console.log(`[redis] ${pattern}: ${keys.length} keys (dry-run, kept)`);
      continue;
    }
    // Upstash `del` accepts up to 1024 keys per call; chunk for safety.
    let removed = 0;
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      removed += await redis.del(...chunk);
    }
    console.log(`[redis] ${pattern}: removed ${removed}`);
  }
}

async function cleanSupabaseStorage(olderThanDays: number, dry: boolean): Promise<void> {
  const supa = getSupabaseService();
  if (!supa) {
    console.log('[storage] supabase service client not configured — skipping');
    return;
  }
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  // Walk every top-level "folder" (book slug). Each book has files
  // directly under it AND under `anchors/`. We keep anchors forever.
  const { data: top, error: topErr } = await supa.storage.from(BUCKET).list('', { limit: 1000 });
  if (topErr) {
    console.error('[storage] list top failed:', topErr.message);
    return;
  }

  const toRemove: string[] = [];
  for (const entry of top ?? []) {
    // Folders show up as entries too; treat anything without a content
    // hash filename as a directory and recurse one level.
    if (!entry.name) continue;
    if (looksLikeFile(entry.name)) {
      // Loose file at bucket root (legacy uploads).
      if (entry.created_at && new Date(entry.created_at).getTime() < cutoff) {
        toRemove.push(entry.name);
      }
      continue;
    }
    // It's a "folder" (book slug). List its contents.
    const { data: inner, error: innerErr } = await supa.storage.from(BUCKET).list(entry.name, { limit: 1000 });
    if (innerErr) {
      console.error(`[storage] list ${entry.name} failed:`, innerErr.message);
      continue;
    }
    for (const f of inner ?? []) {
      if (!f.name) continue;
      // Anchors and portraits subdirs are protected.
      if (f.name === 'anchors' || f.name === 'portraits') continue;
      const path = `${entry.name}/${f.name}`;
      if (!looksLikeFile(f.name)) {
        // Deeper subdir we don't own — skip.
        continue;
      }
      if (f.created_at && new Date(f.created_at).getTime() < cutoff) {
        toRemove.push(path);
      }
    }
  }

  console.log(`[storage] candidates to remove (older than ${olderThanDays}d, excluding anchors): ${toRemove.length}`);
  if (toRemove.length === 0 || dry) {
    if (dry && toRemove.length > 0) {
      console.log('[storage] (dry-run, kept). first 5:', toRemove.slice(0, 5));
    }
    return;
  }
  // Supabase remove takes up to 1000 paths per call.
  let removed = 0;
  for (let i = 0; i < toRemove.length; i += 500) {
    const chunk = toRemove.slice(i, i + 500);
    const { error } = await supa.storage.from(BUCKET).remove(chunk);
    if (error) {
      console.error(`[storage] remove batch failed:`, error.message);
      continue;
    }
    removed += chunk.length;
  }
  console.log(`[storage] removed ${removed}`);
}

async function resetSceneTables(dry: boolean): Promise<void> {
  const supa = getSupabaseService();
  if (!supa) {
    console.log('[db] supabase service client not configured — skipping');
    return;
  }
  // Tables that hold ephemeral generated content. List built once and
  // reused so the dry-run path reports exactly what the live path will
  // truncate.
  const tables = ['scene_branches', 'scenes'];
  for (const t of tables) {
    if (dry) {
      const { count, error } = await supa.from(t).select('*', { count: 'exact', head: true });
      if (error) {
        console.warn(`[db] ${t}: count failed (${error.message}) — table may not exist`);
        continue;
      }
      console.log(`[db] ${t}: ${count ?? 0} rows (dry-run, kept)`);
      continue;
    }
    const { error } = await supa.from(t).delete().not('id', 'is', null);
    if (error) {
      console.warn(`[db] ${t}: delete failed (${error.message})`);
      continue;
    }
    console.log(`[db] ${t}: cleared`);
  }
}

function looksLikeFile(name: string): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(name);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log(`[clean-stale] flags: ${JSON.stringify(flags)}`);

  await cleanRedis(flags.dryRun);

  if (flags.supabase) {
    await cleanSupabaseStorage(flags.olderThanDays, flags.dryRun);
  }
  if (flags.resetScenes) {
    await resetSceneTables(flags.dryRun);
  }

  console.log('[clean-stale] done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
