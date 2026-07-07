// ============================================================
// scripts/check-infra.ts
//
// Quick health check for the cache/storage backends. Verifies
// Upstash Redis + AWS Aurora + S3 storage. Runs read-only probes;
// no writes, no destructive ops.
//
//   npm run check:infra
// ============================================================

import './_loadEnv';

import { getRedis, isRedisConfigured } from '../lib/redis';
import { auroraQuery, isAuroraEnabled, sanitizeErr } from '../lib/db/aurora';
import { isS3Configured, objectExists } from '../lib/storage/s3Storage';

async function checkRedis(): Promise<void> {
  console.log('\n─── Upstash Redis ───');
  if (!isRedisConfigured()) {
    console.log('  ⚠ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set');
    return;
  }
  const r = getRedis()!;
  try {
    const t0 = Date.now();
    await r.set('kk:check:ping', 'pong', { ex: 30 });
    const got = await r.get<string>('kk:check:ping');
    const dt = Date.now() - t0;
    console.log(`  ✓ ping/pong roundtrip: ${dt}ms (got=${JSON.stringify(got)})`);
  } catch (err) {
    console.log(`  ✗ ping failed: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // Snapshot what's actually in the kk:cache:* namespace.
  try {
    let cursor: string | number = 0;
    let total = 0;
    let scanned = 0;
    const sampleKeys: string[] = [];
    do {
      // Upstash SCAN: returns [nextCursor, keys[]]
      const [next, keys] = (await r.scan(cursor, { match: 'kk:*', count: 200 })) as [string, string[]];
      cursor = next;
      scanned++;
      for (const k of keys) {
        total++;
        if (sampleKeys.length < 10) sampleKeys.push(k);
      }
      if (scanned > 50) break; // safety
    } while (String(cursor) !== '0');
    console.log(`  ✓ kk:* keys: ${total} total`);
    if (sampleKeys.length) {
      const buckets: Record<string, number> = {};
      for (const k of sampleKeys) {
        const segment = k.split(':').slice(0, 3).join(':');
        buckets[segment] = (buckets[segment] ?? 0) + 1;
      }
      console.log(`  · sample buckets: ${Object.entries(buckets).map(([k, v]) => `${k}(${v})`).join(', ')}`);
    } else {
      console.log('  · namespace is empty (cold cache)');
    }
  } catch (err) {
    console.log(`  ⚠ scan failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function checkAurora(): Promise<void> {
  console.log('\n─── AWS Aurora ───');
  if (!isAuroraEnabled()) {
    console.log('  ⚠ USE_AURORA != true or DATABASE_URL not set');
    return;
  }
  try {
    const t0 = Date.now();
    const r = await auroraQuery('SELECT 1 AS ok');
    const dt = Date.now() - t0;
    if (!r) { console.log('  ✗ SELECT 1 returned null'); return; }
    console.log(`  ✓ SELECT 1 ${dt}ms (ok=${r.rows[0]?.ok})`);
  } catch (err) {
    console.log(`  ✗ query failed: ${sanitizeErr(err)}`);
    return;
  }

  // Schema probe — do the quota + content tables exist?
  try {
    const r = await auroraQuery<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users','waitlist','content_reports','story_scenes','story_projects')
       ORDER BY table_name`);
    const have = (r?.rows ?? []).map(x => x.table_name);
    console.log(`  · tables present: ${have.join(', ') || '(none of the expected set)'}`);
  } catch (err) {
    console.log(`  ⚠ table probe failed: ${sanitizeErr(err)}`);
  }
}

async function checkS3(): Promise<void> {
  console.log('\n─── AWS S3 ───');
  if (!isS3Configured()) {
    console.log('  ⚠ KK_S3_BUCKET / KK_S3_ACCESS_KEY_ID / KK_S3_SECRET_ACCESS_KEY not set');
    return;
  }
  console.log(`  · bucket: ${process.env.KK_S3_BUCKET}`);
  console.log(`  · region: ${process.env.KK_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1'}`);
  console.log(`  · cdn:    ${process.env.KK_CDN_HOST ?? '(direct S3 URL)'}`);
  try {
    const t0 = Date.now();
    await objectExists('__kk_check_infra_probe__');
    const dt = Date.now() - t0;
    console.log(`  ✓ HeadObject reachable ${dt}ms`);
  } catch (err) {
    console.log(`  ✗ S3 probe failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  await checkRedis();
  await checkAurora();
  await checkS3();
  console.log('');
}

main().catch(err => {
  console.error('[check-infra] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
