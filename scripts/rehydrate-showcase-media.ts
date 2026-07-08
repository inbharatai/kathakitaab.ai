// ============================================================
// scripts/rehydrate-showcase-media.ts
//
// Recovers the four showcase books whose scene art + beat images
// died when Supabase storage was removed (2026-07-07). Every
// `background_asset_url` / `beats[].imageUrl` pointing at the dead
// `*.supabase.co` host is regenerated through the same visual
// pipeline the live app uses (visualAgent → S3 → CloudFront) and
// the book is re-saved (Redis + Aurora mirror). The on-disk backup
// JSON is rewritten so the committed backups reflect the recovery.
//
// Operator-run: needs KK_S3_* (or AWS_*) + KK_CDN_HOST=cdn.kathakitaab.com
// + OPENAI_API_KEY (or GEMINI) + UPSTASH_REDIS_REST_* in env.
//
// Run:
//   npx tsx scripts/rehydrate-showcase-media.ts --dry-run              # list what would regenerate
//   npx tsx scripts/rehydrate-showcase-media.ts --slug=akbar-and-birbal
//   npx tsx scripts/rehydrate-showcase-media.ts --all --purge-cache    # force fresh generation
//
// Idempotent: scenes whose background_asset_url already starts with
// https://cdn.kathakitaab.com are skipped. Dead narration_audio_url
// fields are REPORTED but not fixed here (audio rehydrate is a
// separate TTS pass — out of scope for this image recovery).
// ============================================================

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { generateSceneImage } from '../lib/agents/visualAgent';
import { acquireGenerationLock, releaseGenerationLock, saveGeneratedBook } from '../lib/data/bookRegistry';
import { isS3Configured } from '../lib/storage/s3Storage';
import { getRedis } from '../lib/redis';
import { isDeadMediaUrl } from '../lib/world/mediaResolver';

interface Beat { imageUrl?: string; visualDescription?: string; motion?: string; [k: string]: unknown }
interface RehydrateScene {
  scene_id: string;
  title?: string;
  visual_description?: string;
  background_asset_url?: string;
  narration_audio_url?: string;
  characters_present?: string[];
  characters_absent?: string[];
  mood?: string;
  theme?: string;
  beats?: Beat[];
  [k: string]: unknown;
}
interface RehydrateBook {
  slug: string;
  title?: string;
  stylePreset?: string;
  generatedAt?: number;
  updatedAt?: number;
  scenes: RehydrateScene[];
  characters?: unknown[];
  [k: string]: unknown;
}
interface BackupFile {
  book: RehydrateBook;
  scenes?: RehydrateScene[]; // legacy duplicate of book.scenes
}

const BACKUP_DIR = join(process.cwd(), 'data', 'showcase-backups');
const CDN_HOST = 'cdn.kathakitaab.com';

function parseArgs(): { slugs: string[]; dryRun: boolean; purgeCache: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const purgeCache = args.includes('--purge-cache');
  const all = args.includes('--all');
  const slugArg = args.find(a => a.startsWith('--slug='))?.slice('--slug='.length);

  let slugs: string[];
  if (all) {
    slugs = readdirSync(BACKUP_DIR)
      .filter(n => n.endsWith('.json'))
      .map(n => n.replace(/\.json$/, ''));
  } else if (slugArg) {
    slugs = [slugArg];
  } else {
    console.error('Usage: rehydrate-showcase-media.ts --slug=<slug> | --all [--dry-run] [--purge-cache]');
    process.exit(2);
  }
  return { slugs, dryRun, purgeCache };
}

/** Best-effort purge of the 90-day visual prompt cache so rehydrate
 *  forces fresh generation instead of returning a previously-stored
 *  (possibly dead) URL. There is no clearByPrefix in responseCache, so
 *  we SCAN + DEL the `kk:cache:image:scene:*` keys directly. No-op +
 *  warning when Redis isn't configured (local dev). */
async function purgeImageCache(): Promise<number> {
  const redis = getRedis();
  if (!redis) {
    console.warn('[purge] Redis not configured — skipping cache purge (local in-memory cache only).');
    return 0;
  }
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'kk:cache:image:scene:*', count: 200 });
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== '0' && cursor !== '');
  console.log(`[purge] deleted ${deleted} image:scene:* cache key(s).`);
  return deleted;
}

function sceneNeedsRehydrate(scene: RehydrateScene): boolean {
  const url = scene.background_asset_url;
  if (!url) return true;
  if (url.startsWith(`https://${CDN_HOST}/`)) return false;
  return isDeadMediaUrl(url);
}

async function rehydrateOne(slug: string, dryRun: boolean): Promise<{ regenerated: number; skipped: number; deadAudio: number }> {
  const path = join(BACKUP_DIR, `${slug}.json`);
  if (!existsSync(path)) {
    console.error(`[rehydrate] ${slug}: backup not found at ${path}`);
    return { regenerated: 0, skipped: 0, deadAudio: 0 };
  }
  const file = JSON.parse(readFileSync(path, 'utf8')) as BackupFile;
  const book = file.book;
  if (!book || !Array.isArray(book.scenes)) {
    console.error(`[rehydrate] ${slug}: backup missing book.scenes — not a valid showcase payload.`);
    return { regenerated: 0, skipped: 0, deadAudio: 0 };
  }

  const targets = book.scenes.filter(sceneNeedsRehydrate);
  const deadAudio = book.scenes.filter(s => isDeadMediaUrl(s.narration_audio_url)).length;
  console.log(`[rehydrate] ${slug}: ${targets.length}/${book.scenes.length} scene(s) need image rehydrate${deadAudio > 0 ? `, ${deadAudio} dead audio URL(s) reported (not fixed)` : ''}.`);

  if (dryRun) {
    for (const s of targets) console.log(`         · would regenerate: ${s.scene_id} — ${s.title ?? ''}`);
    return { regenerated: 0, skipped: book.scenes.length - targets.length, deadAudio };
  }

  if (!isS3Configured()) {
    console.error(`[rehydrate] ${slug}: S3 not configured (need KK_S3_BUCKET + creds + KK_CDN_HOST=${CDN_HOST}). Aborting — set creds or run with --dry-run.`);
    return { regenerated: 0, skipped: 0, deadAudio };
  }

  const acquired = await acquireGenerationLock(slug);
  if (!acquired) {
    console.warn(`[rehydrate] ${slug}: generation lock held by another run — skipping. Retry later.`);
    return { regenerated: 0, skipped: 0, deadAudio };
  }

  let regenerated = 0;
  let skipped = 0;
  try {
    for (const scene of book.scenes) {
      if (!sceneNeedsRehydrate(scene)) { skipped++; continue; }
      process.stdout.write(`    ${scene.scene_id} (${scene.title ?? ''})… `);
      try {
        const r = await generateSceneImage(scene.visual_description || scene.title || '', {
          bookSlug: slug,
          sceneId: scene.scene_id,
          characters: scene.characters_present ?? [],
          forbiddenCharacters: scene.characters_absent ?? [],
          mood: scene.mood,
          theme: scene.theme,
          stylePreset: book.stylePreset as never,
        });
        if (!r.imageUrl) { console.log('empty (skipped)'); continue; }
        scene.background_asset_url = r.imageUrl;
        if (Array.isArray(scene.beats) && scene.beats[0]) scene.beats[0].imageUrl = r.imageUrl;
        // Mirror to the legacy top-level scenes array if present.
        if (file.scenes) {
          const dup = file.scenes.find(s => s.scene_id === scene.scene_id);
          if (dup) {
            dup.background_asset_url = r.imageUrl;
            if (Array.isArray(dup.beats) && dup.beats[0]) dup.beats[0].imageUrl = r.imageUrl;
          }
        }
        regenerated++;
        console.log(`✓ ${r.source} ${r.imageUrl.slice(0, 60)}…`);
      } catch (err) {
        console.log('fail');
        console.warn(`      → ${err instanceof Error ? err.message : err}`);
      }
    }

    if (regenerated > 0) {
      book.updatedAt = Date.now();
      await saveGeneratedBook(book as never);
      writeFileSync(path, JSON.stringify(file, null, 2), 'utf8');
      console.log(`[rehydrate] ${slug}: saved ${regenerated} new image(s) to Redis+Aurora + rewrote ${path}.`);
    } else {
      console.log(`[rehydrate] ${slug}: no images regenerated — nothing to save.`);
    }
  } finally {
    await releaseGenerationLock(slug);
  }
  return { regenerated, skipped, deadAudio };
}

async function main() {
  const { slugs, dryRun, purgeCache } = parseArgs();

  if (purgeCache && !dryRun) await purgeImageCache();

  console.log(dryRun ? '[rehydrate] DRY RUN — no generation, no saves.' : '[rehydrate] LIVE — will call the image model + upload to S3.');
  let totalRegenerated = 0;
  let totalDeadAudio = 0;
  for (const slug of slugs) {
    const r = await rehydrateOne(slug, dryRun);
    totalRegenerated += r.regenerated;
    totalDeadAudio += r.deadAudio;
  }
  console.log(`\n[rehydrate] done. ${totalRegenerated} image(s) regenerated${totalDeadAudio > 0 ? `, ${totalDeadAudio} dead audio URL(s) still need a TTS rehydrate pass` : ''}.`);
}

main().catch(err => {
  console.error('[rehydrate] fatal:', err);
  process.exit(1);
});