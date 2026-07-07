// ============================================================
// scripts/migrate-supabase-to-s3.ts
//
// One-shot migration of generated assets from Supabase Storage to
// AWS S3 + CloudFront. Walks the JSON manifests + canon files that
// embed hardcoded Supabase CDN URLs, downloads each unique object,
// uploads it to S3 under the same key, and rewrites the URLs to the
// CloudFront (cdn.kathakitaab.com) form.
//
// DEPLOY-PENDING: requires real AWS credentials (KK_S3_*) to run.
// The script is idempotent — it skips URLs already on the CDN host
// and skips S3 objects that already exist (HeadObject).
//
// Run:
//   npx tsx scripts/migrate-supabase-to-s3.ts            # all files
//   npx tsx scripts/migrate-supabase-to-s3.ts --dry-run  # report only
//   npx tsx scripts/migrate-supabase-to-s3.ts --file=path/to/one.json
// ============================================================

import './_loadEnv';

import { readFile, writeFile, readdir } from 'node:fs';
import { join } from 'node:path';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { publicUrlFor } from '../lib/storage/s3Storage';

// Files that may carry hardcoded Supabase CDN URLs.
const FILE_GLOBS = [
  'data/showcase-backups',
  'lib/data/canon',
  'remotion/manifests',
];

// Matches a Supabase Storage public URL and captures the object key.
// e.g. https://esaypdyvmymsmlgxxylv.supabase.co/storage/v1/object/public/scene-images/ramayana/foo.png
//   → key = "ramayana/foo.png", bucket = "scene-images"
const SUPABASE_URL = /https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/([a-z0-9-]+)\/([^\s"',}\]]+)/g;

interface MigrationStats {
  scanned: number;
  migrated: number;
  skippedExisting: number;
  failed: number;
  rewritten: number;
}

function s3Client(): S3Client | null {
  const accessKeyId = process.env.KK_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.KK_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.KK_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  if (!process.env.KK_S3_BUCKET || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadFromUrl(client: S3Client, bucket: string, key: string, sourceUrl: string): Promise<boolean> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    console.warn(`  ✗ fetch failed (${res.status}): ${sourceUrl}`);
    return false;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? guessContentType(key);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return true;
}

function guessContentType(key: string): string {
  if (key.endsWith('.mp4')) return 'video/mp4';
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

/** Walk a parsed JSON value, collecting every Supabase URL string. */
function collectUrls(value: unknown, out: Map<string, string>): void {
  if (typeof value === 'string') {
    let m: RegExpExecArray | null;
    SUPABASE_URL.lastIndex = 0;
    while ((m = SUPABASE_URL.exec(value)) !== null) {
      const full = m[0];
      if (!out.has(full)) out.set(full, full);
    }
    return;
  }
  if (Array.isArray(value)) { for (const v of value) collectUrls(v, out); return; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) collectUrls(v, out); }
}

function listJsonFiles(dir: string): string[] {
  let entries: string[];
  try { entries = readdir(dir); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e);
    if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const fileArg = argv.find(a => a.startsWith('--file='))?.slice('--file='.length);

  const client = s3Client();
  const bucket = process.env.KK_S3_BUCKET!;
  if (!client || !bucket) {
    console.error('S3 not configured. Set KK_S3_BUCKET + KK_S3_ACCESS_KEY_ID + KK_S3_SECRET_ACCESS_KEY (+ KK_CDN_HOST).');
    process.exit(1);
  }

  // Gather target files.
  const files: string[] = [];
  if (fileArg) {
    files.push(fileArg);
  } else {
    for (const dir of FILE_GLOBS) {
      for (const f of listJsonFiles(dir)) files.push(f);
    }
  }

  const stats: MigrationStats = { scanned: 0, migrated: 0, skippedExisting: 0, failed: 0, rewritten: 0 };
  console.log(`[migrate] ${files.length} file(s) to scan${dryRun ? ' (dry-run)' : ''}`);

  for (const file of files) {
    let raw: string;
    try { raw = readFile(file, 'utf8'); } catch { continue; }
    stats.scanned++;

    // Collect URLs across the whole file (string-level scan so we
    // rewrite every occurrence, including ones inside strings the
    // JSON walker would also find — we just use the walker for the
    // unique set).
    const urlMap = new Map<string, string>();
    collectUrls(JSON.parse(raw), urlMap);
    if (urlMap.size === 0) continue;

    console.log(`[migrate] ${file}: ${urlMap.size} unique Supabase URL(s)`);

    const rewriteMap = new Map<string, string>();
    for (const url of urlMap.keys()) {
      const m = SUPABASE_URL.exec(url);
      SUPABASE_URL.lastIndex = 0;
      if (!m) continue;
      const key = m[2];

      if (await objectExists(client, bucket, key)) {
        stats.skippedExisting++;
        rewriteMap.set(url, publicUrlFor(key));
        continue;
      }
      if (dryRun) {
        rewriteMap.set(url, publicUrlFor(key));
        continue;
      }
      const ok = await uploadFromUrl(client, bucket, key, url);
      if (ok) {
        stats.migrated++;
        rewriteMap.set(url, publicUrlFor(key));
      } else {
        stats.failed++;
      }
    }

    if (rewriteMap.size === 0) continue;

    // Rewrite every URL occurrence in the raw text and write back.
    let next = raw;
    for (const [oldUrl, newUrl] of rewriteMap) {
      next = next.split(oldUrl).join(newUrl);
    }
    if (next !== raw && !dryRun) {
      writeFile(file, next);
      stats.rewritten++;
      console.log(`[migrate]   ✓ rewrote ${file}`);
    } else if (dryRun) {
      console.log(`[migrate]   (dry-run) would rewrite ${file}`);
    }
  }

  console.log('\n[migrate] done:', JSON.stringify(stats));
}

main().catch(err => {
  console.error('[migrate] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});