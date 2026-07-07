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
//   npx tsx scripts/clean-stale.ts --s3           # + S3 storage sweep (7d)
//   npx tsx scripts/clean-stale.ts --s3 --older-than-days 1
//   npx tsx scripts/clean-stale.ts --reset-scenes # + Aurora scene truncate
//   npx tsx scripts/clean-stale.ts --dry-run      # report only
// ============================================================

import './_loadEnv';

import { getRedis } from '../lib/redis';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { auroraQuery, isAuroraEnabled } from '../lib/db/aurora';

function s3Bucket(): string | undefined {
  return process.env.KK_S3_BUCKET;
}

function s3Region(): string {
  return process.env.KK_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
}

function s3Client(): S3Client | null {
  const accessKeyId = process.env.KK_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.KK_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!s3Bucket() || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({ region: s3Region(), credentials: { accessKeyId, secretAccessKey } });
}

interface Flags {
  s3: boolean;
  resetScenes: boolean;
  olderThanDays: number;
  dryRun: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { s3: false, resetScenes: false, olderThanDays: 7, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--s3' || a === '--supabase') flags.s3 = true;
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

async function cleanS3Storage(olderThanDays: number, dry: boolean): Promise<void> {
  const client = s3Client();
  const bucket = s3Bucket();
  if (!client || !bucket) {
    console.log('[storage] S3 not configured — skipping');
    return;
  }
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  // Walk every object under every book "folder". Keep anchors/ and
  // portraits/ (they're expensive to regenerate and stable across
  // re-renders). Delete everything else older than the cutoff.
  const toRemove: Array<{ key: string }> = [];
  let cursor: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cursor }));
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      // Protect anchor / portrait assets regardless of age.
      if (obj.Key.includes('/anchors/') || obj.Key.includes('/portraits/')) continue;
      const ts = obj.LastModified?.getTime();
      if (ts && ts < cutoff) toRemove.push({ key: obj.Key });
    }
    cursor = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (cursor);

  console.log(`[storage] candidates to remove (older than ${olderThanDays}d, excluding anchors/portraits): ${toRemove.length}`);
  if (toRemove.length === 0 || dry) {
    if (dry && toRemove.length > 0) {
      console.log('[storage] (dry-run, kept). first 5:', toRemove.slice(0, 5).map(x => x.key));
    }
    return;
  }
  let removed = 0;
  for (let i = 0; i < toRemove.length; i += 1000) {
    const chunk = toRemove.slice(i, i + 1000);
    const { Errors } = await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: chunk.map(x => ({ Key: x.key })) },
    }));
    if (Errors && Errors.length) {
      console.error('[storage] some deletes failed:', Errors.slice(0, 3));
    }
    removed += chunk.length;
  }
  console.log(`[storage] removed ${removed}`);
}

async function resetSceneTables(dry: boolean): Promise<void> {
  if (!isAuroraEnabled()) {
    console.log('[db] Aurora not configured — skipping');
    return;
  }
  // story_scenes holds ephemeral generated scene content in Aurora.
  if (dry) {
    const r = await auroraQuery<{ c: string }>('SELECT COUNT(*)::text AS c FROM story_scenes');
    console.log(`[db] story_scenes: ${r?.rows[0]?.c ?? 0} rows (dry-run, kept)`);
    return;
  }
  await auroraQuery('TRUNCATE TABLE story_scenes');
  console.log('[db] story_scenes: cleared');
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log(`[clean-stale] flags: ${JSON.stringify(flags)}`);

  await cleanRedis(flags.dryRun);

  if (flags.s3) {
    await cleanS3Storage(flags.olderThanDays, flags.dryRun);
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
