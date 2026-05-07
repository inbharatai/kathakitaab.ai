// ============================================================
// scripts/survey-infra.ts
//
// Read-only inventory of what's actually deployed:
//   - all migration tables (do they exist?)
//   - Supabase storage layout (folders + sizes)
//   - Redis namespace (key counts by bucket, sample keys)
//   - which env vars are present locally vs documented as required
//
// Output is the input to the "what should I update?" decision —
// no writes anywhere.
// ============================================================

import './_loadEnv';

import { getRedis, isRedisConfigured } from '../lib/redis';
import { getSupabaseService, isSupabaseConfigured } from '../lib/supabase';

// Tables declared in supabase/migrations/001_initial_schema.sql.
const EXPECTED_TABLES = [
  'books', 'book_sources', 'scenes', 'hotspots', 'characters',
  'character_assets', 'scene_assets', 'quiz_questions',
  'narration_lines', 'safety_flags', 'cache_entries',
];

async function surveySupabase() {
  console.log('\n─── Supabase Postgres ───');
  if (!isSupabaseConfigured()) { console.log('  ⚠ not configured'); return; }
  const svc = getSupabaseService()!;
  const present: string[] = [];
  const missing: string[] = [];
  for (const t of EXPECTED_TABLES) {
    const { error } = await svc.from(t).select('*', { count: 'exact', head: true });
    if (error) missing.push(`${t} (${error.message.slice(0, 60)})`);
    else present.push(t);
  }
  console.log(`  · tables present: ${present.length}/${EXPECTED_TABLES.length}`);
  console.log(`    ✓ ${present.join(', ')}`);
  if (missing.length) console.log(`    ✗ ${missing.join(' | ')}`);
}

async function surveyStorage() {
  console.log('\n─── Supabase Storage ───');
  if (!isSupabaseConfigured()) { console.log('  ⚠ not configured'); return; }
  const svc = getSupabaseService()!;
  const { data: buckets } = await svc.storage.listBuckets();
  if (!buckets) { console.log('  ✗ listBuckets returned null'); return; }
  for (const b of buckets) {
    console.log(`  · bucket "${b.name}" (public=${b.public ?? false})`);
    const { data: top } = await svc.storage.from(b.name).list('', { limit: 100 });
    if (!top) continue;
    for (const item of top) {
      const isFolder = item.id === null;
      if (isFolder) {
        const { data: sub } = await svc.storage.from(b.name).list(item.name, { limit: 200 });
        const count = sub?.length ?? 0;
        const totalBytes = (sub ?? []).reduce((s, x) => s + (x.metadata?.size ?? 0), 0);
        console.log(`      📁 ${item.name}/  (${count} entries, ${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        const sz = (item.metadata?.size ?? 0) / 1024;
        console.log(`      📄 ${item.name}  (${sz.toFixed(1)} KB)`);
      }
    }
  }
}

async function surveyRedis() {
  console.log('\n─── Upstash Redis ───');
  if (!isRedisConfigured()) { console.log('  ⚠ not configured'); return; }
  const r = getRedis()!;

  // Walk the entire kk:* namespace and bucket by 4th colon-segment
  // (kk:cache:type:tts → "cache:type:tts").
  const buckets: Record<string, number> = {};
  const ttsKeys: string[] = [];
  let cursor: string | number = 0;
  let total = 0;
  let scanned = 0;
  do {
    const [next, keys] = (await r.scan(cursor, { match: 'kk:*', count: 500 })) as [string, string[]];
    cursor = next;
    scanned++;
    for (const k of keys) {
      total++;
      const parts = k.split(':');
      const bucket = parts.slice(0, 4).join(':');
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
      // Collect a sample of TTS keys so we can see whether the v3
      // tone+mood-aware shape is present (those keys carry "|tone:" /
      // "|mood:" segments after the type prefix).
      if (k.includes('cache:type:tts') && ttsKeys.length < 8) ttsKeys.push(k);
    }
    if (scanned > 80) break;
  } while (String(cursor) !== '0');

  console.log(`  · total kk:* keys: ${total}`);
  for (const [b, n] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${b.padEnd(40)} ${n}`);
  }
  if (ttsKeys.length) {
    console.log(`  · TTS key samples (look for tone:* / mood:* segments — Wave 1.1 cache shape):`);
    for (const k of ttsKeys) console.log(`      ${k}`);
  }
}

function surveyLocalEnv() {
  console.log('\n─── Local .env.local key presence ───');
  const required = [
    'SARVAM_API_KEY',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
  ];
  const recommended = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_DB_URL',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ];
  const optional = [
    'SARVAM_TTS_MODEL',
    'GEMINI_TEXT_MODEL',
    'GEMINI_AUDIO_MODEL',
    'OPENAI_TEXT_MODEL',
  ];
  for (const [label, list] of [
    ['required', required],
    ['recommended', recommended],
    ['optional (defaults provided)', optional],
  ] as const) {
    console.log(`  · ${label}:`);
    for (const k of list) {
      const v = process.env[k];
      const tag = v ? `✓ set (${v.length} chars)` : '✗ MISSING';
      console.log(`      ${k.padEnd(34)} ${tag}`);
    }
  }
}

async function main() {
  surveyLocalEnv();
  await surveySupabase();
  await surveyStorage();
  await surveyRedis();
  console.log('');
}

main().catch(err => {
  console.error('[survey] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
