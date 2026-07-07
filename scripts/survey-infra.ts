// ============================================================
// scripts/survey-infra.ts
//
// Read-only inventory of what's actually deployed:
//   - Aurora tables (do they exist?)
//   - S3 storage layout (object count + total size)
//   - Redis namespace (key counts by bucket, sample keys)
//   - which env vars are present locally vs documented as required
//
// Output is the input to the "what should I update?" decision —
// no writes anywhere.
// ============================================================

import './_loadEnv';

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getRedis, isRedisConfigured } from '../lib/redis';
import { auroraQuery, isAuroraEnabled, sanitizeErr } from '../lib/db/aurora';

// Tables declared in db/aurora/migrations/.
const EXPECTED_TABLES = [
  'users', 'story_projects', 'story_scenes', 'characters',
  'generated_assets', 'story_versions', 'public_story_links',
  'generation_jobs', 'audit_events', 'waitlist', 'content_reports',
];

async function surveyAurora() {
  console.log('\n─── AWS Aurora ───');
  if (!isAuroraEnabled()) { console.log('  ⚠ not configured'); return; }
  try {
    const r = await auroraQuery<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`);
    const have = new Set((r?.rows ?? []).map(x => x.table_name));
    const present = EXPECTED_TABLES.filter(t => have.has(t));
    const missing = EXPECTED_TABLES.filter(t => !have.has(t));
    console.log(`  · tables present: ${present.length}/${EXPECTED_TABLES.length}`);
    if (present.length) console.log(`    ✓ ${present.join(', ')}`);
    if (missing.length) console.log(`    ✗ missing: ${missing.join(', ')}`);
  } catch (err) {
    console.log(`  ✗ survey failed: ${sanitizeErr(err)}`);
  }
}

async function surveyS3() {
  console.log('\n─── AWS S3 ───');
  const bucket = process.env.KK_S3_BUCKET;
  const region = process.env.KK_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  const accessKeyId = process.env.KK_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.KK_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) { console.log('  ⚠ not configured'); return; }
  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  let total = 0;
  let bytes = 0;
  let cursor: string | undefined;
  try {
    do {
      const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cursor }));
      for (const obj of res.Contents ?? []) {
        total++;
        bytes += obj.Size ?? 0;
      }
      cursor = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (cursor);
    console.log(`  · bucket: ${bucket}`);
    console.log(`  · objects: ${total}`);
    console.log(`  · total size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  · cdn: ${process.env.KK_CDN_HOST ?? '(direct S3 URL)'}`);
  } catch (err) {
    console.log(`  ✗ list failed: ${err instanceof Error ? err.message : err}`);
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
    'DATABASE_URL',
    'USE_AURORA',
    'KK_S3_BUCKET',
    'KK_S3_ACCESS_KEY_ID',
    'KK_S3_SECRET_ACCESS_KEY',
    'KK_CDN_HOST',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ];
  const optional = [
    'SARVAM_TTS_MODEL',
    'GEMINI_TEXT_MODEL',
    'GEMINI_AUDIO_MODEL',
    'OPENAI_TEXT_MODEL',
    'KATHA_ADMIN_OWNER_IDS',
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
  await surveyAurora();
  await surveyS3();
  await surveyRedis();
  console.log('');
}

main().catch(err => {
  console.error('[survey] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
