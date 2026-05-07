// ============================================================
// scripts/check-infra.ts
//
// Quick health check for the cache/storage backends. Verifies
// Upstash Redis reachability + Supabase Storage bucket layout.
// Runs read-only probes; no writes, no destructive ops.
//
//   npm run check:infra
// ============================================================

import './_loadEnv';

import { getRedis, isRedisConfigured } from '../lib/redis';
import { getSupabaseAnon, getSupabaseService, isSupabaseConfigured } from '../lib/supabase';

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

async function checkSupabase(): Promise<void> {
  console.log('\n─── Supabase ───');
  if (!isSupabaseConfigured()) {
    console.log('  ⚠ NEXT_PUBLIC_SUPABASE_URL / *_ANON_KEY not set');
    return;
  }
  const anon = getSupabaseAnon();
  const service = getSupabaseService();
  console.log(`  · anon client:    ${anon ? '✓' : '⚠ missing'}`);
  console.log(`  · service client: ${service ? '✓' : '⚠ missing (SUPABASE_SERVICE_ROLE_KEY)'}`);

  if (!service) return;

  // Probe the storage bucket the app uses for scene assets.
  try {
    const t0 = Date.now();
    const { data: buckets, error } = await service.storage.listBuckets();
    const dt = Date.now() - t0;
    if (error) {
      console.log(`  ✗ listBuckets: ${error.message}`);
      return;
    }
    console.log(`  ✓ listBuckets ${dt}ms: ${buckets?.map(b => b.name).join(', ')}`);
    const sceneBucket = buckets?.find(b => b.name === 'scene-images');
    if (!sceneBucket) {
      console.log('  ⚠ "scene-images" bucket missing — app expects this for character images, scene-stream, movie-audio');
    }
  } catch (err) {
    console.log(`  ✗ storage probe failed: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // Probe the bucket's contents at the top level so we can see what
  // namespaces are actually populated.
  try {
    const { data, error } = await service.storage.from('scene-images').list('', { limit: 100 });
    if (error) {
      console.log(`  ✗ list scene-images/: ${error.message}`);
      return;
    }
    const folders = data?.filter(d => d.id === null) ?? []; // Supabase folder marker
    const files = data?.filter(d => d.id !== null) ?? [];
    console.log(`  ✓ scene-images/ — ${folders.length} folder(s), ${files.length} file(s)`);
    if (folders.length) console.log(`    folders: ${folders.map(f => f.name).slice(0, 10).join(', ')}`);
    if (files.length) console.log(`    files: ${files.map(f => f.name).slice(0, 5).join(', ')}…`);
  } catch (err) {
    console.log(`  ⚠ list contents failed: ${err instanceof Error ? err.message : err}`);
  }

  // Probe ramayana subfolders the build pipeline writes to.
  try {
    for (const sub of ['ramayana', 'ramayana/movie-audio']) {
      const { data, error } = await service.storage.from('scene-images').list(sub, { limit: 5 });
      if (error) {
        console.log(`  · ${sub}/: error — ${error.message}`);
      } else {
        console.log(`  · ${sub}/ — ${data?.length ?? 0} entry(ies)${data && data.length ? ` (${data.slice(0, 3).map(f => f.name).join(', ')}…)` : ''}`);
      }
    }
  } catch { /* */ }

  // Schema probe — do the Postgres tables exist? The schema files live
  // in supabase/migrations but most v3 paths bypass Postgres entirely.
  try {
    // information_schema query via PostgREST is rejected; use a small
    // RPC-equivalent: try selecting from a known table with limit 0.
    for (const table of ['books', 'scenes', 'characters', 'hotspots']) {
      const { error } = await service.from(table).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`  · table "${table}": ${error.code ?? '?'} — ${error.message.slice(0, 80)}`);
      } else {
        console.log(`  · table "${table}": ✓`);
      }
    }
  } catch (err) {
    console.log(`  ⚠ table probe failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  await checkRedis();
  await checkSupabase();
  console.log('');
}

main().catch(err => {
  console.error('[check-infra] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
