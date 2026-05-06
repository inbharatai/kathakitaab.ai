// ============================================================
// scripts/build-book-video.ts
//
// Universal book-to-video pipeline. Given any book slug whose
// canon is registered, produces a manifest the Remotion BookMovie
// composition can render. Steps per scene:
//
//   1. Pull scene from /api/books/{slug} on the running dev server
//      (so we get the exact same narration the in-app reader hears).
//   2. Call /api/livebook/tts to render Sarvam Bulbul narration.
//      Cached locally under public/movies/audio/{slug}/ — gitignored
//      because the cache only speeds up rebuilds, not deploys.
//   3. Upload the clip to Supabase Storage at
//      `scene-images/{slug}/movie-audio/` so the Player streams it
//      from the CDN.
//   4. Probe each clip's duration (music-metadata, with a WAV-header
//      fallback for the rare case music-metadata can't read it).
//   5. Write `remotion/manifests/{slug}.json` — the single source of
//      truth the BookMovie composition reads via inputProps.
//
// Idempotent: existing local audio is reused; storage uploads upsert.
// Run after `next dev` is up on :5009.
//
//   npx tsx scripts/build-book-video.ts --slug=ramayana
//   npx tsx scripts/build-book-video.ts --slug=mahabharata
// ============================================================

import './_loadEnv';

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSupabaseService } from '../lib/supabase';
import { planSubtitles, type SubtitleCue } from '../lib/video/subtitlePlanner';
import { motionForMood, type SceneMotion } from '../lib/video/motion';
import { detectTopics } from '../lib/video/effects/topicTagger';
import { buildSceneEffects, describeRecipe } from '../lib/video/effects/effectRecipes';
import type { SceneEffect } from '../lib/video/effects/types';

const PUBLIC_DIR = join(process.cwd(), 'public');
const MANIFESTS_DIR = join(process.cwd(), 'remotion', 'manifests');
const BASE = process.env.MOVIE_BUILD_BASE || 'http://localhost:5009';
const STORAGE_BUCKET = 'scene-images';

interface Scene {
  scene_id: string;
  title: string;
  narration: string;
  background_asset_url: string;
}

interface ManifestScene {
  sceneId: string;
  title: string;
  narration: string;
  imagePath: string;
  audioPath: string;
  /** Same as audioPath — kept under both names so the spec-named
   *  field exists in the manifest (Phase 10 contract). */
  narrationAudioUrl: string;
  durationSeconds: number;
  /** Pre-computed subtitle cues with explicit ms timing. The
   *  Remotion composition reads this directly so the manifest is
   *  the single source of subtitle truth. */
  subtitles: SubtitleCue[];
  /** Per-scene camera motion. Defaults to the mood-based motion
   *  when not explicitly set on a prior manifest. */
  motion: SceneMotion;
  /** Mood tag drives the default music bed and motion. Preserved
   *  from any prior manifest so a re-build doesn't wipe hand-picked
   *  mood overrides. */
  mood?: string;
  /** Explicit ambient bed URL. When unset, the Remotion composition
   *  falls back to the procedural mood WAV at /audio/mood/{mood}.wav.
   *  Setting this to a real CDN URL lets each book ship its own bed. */
  backgroundMusicUrl?: string;
  /** Universal effects DSL — particles, glow, vignette, etc. Same
   *  vocabulary the live reader and the Remotion compositions read.
   *  Derived from narration topics + mood at build time. */
  effects: SceneEffect[];
}

interface Manifest {
  bookSlug: string;
  bookTitle: string;
  scenes: ManifestScene[];
  generatedAt: string;
}

function parseSlugArg(): string {
  const fromArg = process.argv.slice(2).find(a => a.startsWith('--slug='));
  if (fromArg) return fromArg.slice('--slug='.length);
  // Allow positional: `npx tsx build-book-video.ts ramayana`
  const positional = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (positional) return positional;
  throw new Error('book slug required: pass --slug=<slug> or as the first positional arg');
}

async function fetchBook(slug: string): Promise<{ scenes: Scene[]; bookTitle: string }> {
  const res = await fetch(`${BASE}/api/books/${slug}`);
  if (!res.ok) throw new Error(`/api/books/${slug} → ${res.status}`);
  const data = (await res.json()) as { scenes: Scene[]; book?: { title: string } };
  const title = data.book?.title || slug;
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error(`/api/books/${slug} returned no scenes`);
  }
  return { scenes: data.scenes, bookTitle: title };
}

async function ttsToFile(
  scene: Scene,
  outDir: string,
  basename: string,
  mood?: string,
): Promise<string> {
  // Pass mood so the TTS router shapes pace/pitch/loudness for the
  // whole-scene narration. The router still does per-text tone
  // detection on top, so an explicitly-set mood is the floor — text
  // that screams "battle!" can override a "serene" scene mood.
  const res = await fetch(`${BASE}/api/livebook/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: scene.narration.slice(0, 1450),
      voice: 'narration',
      language: 'en',
      mood,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`TTS for ${scene.scene_id} → ${res.status} ${txt.slice(0, 200)}`);
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('audio/')) {
    throw new Error(`TTS for ${scene.scene_id}: non-audio response (${ct})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // Sniff actual format by magic bytes — content-type from upstream
  // chains is unreliable. RIFF=WAV, ID3 or 0xFFFB/E=MP3.
  const head = buf.subarray(0, 4).toString('ascii');
  const ext = head === 'RIFF' ? 'wav' : 'mp3';
  const fileName = `${basename}.${ext}`;
  writeFileSync(join(outDir, fileName), buf);
  return fileName;
}

async function uploadToSupabase(localPath: string, slug: string, remoteName: string): Promise<string> {
  const supabase = getSupabaseService();
  if (!supabase) {
    throw new Error('Supabase service client not configured — set SUPABASE_SERVICE_ROLE_KEY');
  }
  const bytes = readFileSync(localPath);
  const contentType = remoteName.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
  const remotePath = `${slug}/movie-audio/${remoteName}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(remotePath, bytes, {
      contentType,
      upsert: true,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  if (error) throw new Error(`storage upload ${remotePath}: ${error.message}`);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(remotePath);
  return data.publicUrl;
}

async function probeDuration(filePath: string): Promise<number> {
  const { parseFile } = await import('music-metadata');
  const meta = await parseFile(filePath);
  const d = meta.format.duration;
  if (d && Number.isFinite(d) && d > 0) return d;

  // Sarvam/Gemini WAVs sometimes ship without a `data` chunk size,
  // so music-metadata can't compute duration. Fall back to the PCM
  // header math: bytes / (sampleRate * channels * bytesPerSample).
  if (filePath.endsWith('.wav')) {
    const buf = readFileSync(filePath);
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF') {
      const sampleRate = buf.readUInt32LE(24);
      const byteRate = buf.readUInt32LE(28);
      if (byteRate > 0) return (buf.length - 44) / byteRate;
      const channels = buf.readUInt16LE(22);
      const bitsPerSample = buf.readUInt16LE(34);
      if (sampleRate > 0 && channels > 0 && bitsPerSample > 0) {
        const bytesPerSample = bitsPerSample / 8;
        return (buf.length - 44) / (sampleRate * channels * bytesPerSample);
      }
    }
  }
  throw new Error(`could not determine duration for ${filePath}`);
}

async function main() {
  const slug = parseSlugArg();

  const audioDir = join(PUBLIC_DIR, 'movies', 'audio', slug);
  const manifestPath = join(MANIFESTS_DIR, `${slug}.json`);
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(MANIFESTS_DIR, { recursive: true });

  console.log(`[movie-build] slug: ${slug} | base: ${BASE}`);

  const { scenes, bookTitle } = await fetchBook(slug);
  console.log(`[movie-build] ${scenes.length} scenes`);

  // Preserve hand-authored fields from the existing manifest so a
  // rebuild doesn't drop per-scene mood, motion, or music overrides.
  const moodBySceneId: Record<string, string> = {};
  const motionBySceneId: Record<string, SceneMotion> = {};
  const musicUrlBySceneId: Record<string, string> = {};
  if (existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
      for (const s of prev.scenes) {
        if (s.mood) moodBySceneId[s.sceneId] = s.mood;
        if (s.motion) motionBySceneId[s.sceneId] = s.motion;
        if (s.backgroundMusicUrl) musicUrlBySceneId[s.sceneId] = s.backgroundMusicUrl;
      }
      console.log(`[movie-build] preserving ${Object.keys(moodBySceneId).length} mood, ${Object.keys(motionBySceneId).length} motion, ${Object.keys(musicUrlBySceneId).length} music overrides from prior manifest`);
    } catch (err) {
      console.warn(`[movie-build] could not read prior manifest: ${err}`);
    }
  }

  const out: ManifestScene[] = [];
  for (const scene of scenes) {
    // Resolve the mood up front so it can shape TTS delivery on a
    // fresh render. Cached audio (audioFileRel exists) keeps whatever
    // tone shaped its first build — there's no way to know which mood
    // was used previously, so re-running with `--force-tts` would be
    // the right path if the mood changes for a previously-rendered scene.
    const sceneMood = moodBySceneId[scene.scene_id];

    // Discover whichever extension is already on disk; rebuild if neither.
    const relCandidates = ['mp3', 'wav'].map(ext => `movies/audio/${slug}/${scene.scene_id}.${ext}`);
    let audioFileRel = relCandidates.find(rel => existsSync(join(PUBLIC_DIR, rel)));

    if (!audioFileRel) {
      console.log(`[movie-build] tts: ${scene.scene_id} (${scene.narration.length} chars, mood=${sceneMood ?? 'none'})`);
      const fileName = await ttsToFile(scene, audioDir, scene.scene_id, sceneMood);
      audioFileRel = `movies/audio/${slug}/${fileName}`;
    } else {
      console.log(`[movie-build] tts: ${scene.scene_id} (cached: ${audioFileRel})`);
    }

    const audioFileAbs = join(PUBLIC_DIR, audioFileRel);
    const fileName = audioFileRel.split('/').pop()!;
    const duration = await probeDuration(audioFileAbs);
    console.log(`[movie-build]    duration: ${duration.toFixed(2)}s`);

    const audioUrl = await uploadToSupabase(audioFileAbs, slug, fileName);
    console.log(`[movie-build]    uploaded: ${audioUrl}`);

    const imagePath = scene.background_asset_url || `/images/scene_${scene.scene_id}.png`;
    const mood = sceneMood;
    const motion = motionBySceneId[scene.scene_id] ?? motionForMood(mood);
    const subtitles = planSubtitles(scene.narration, duration);
    const topics = detectTopics(scene.narration);
    const effects = buildSceneEffects(topics, mood);
    console.log(`[movie-build]    ${describeRecipe(topics, mood, effects)}`);
    out.push({
      sceneId: scene.scene_id,
      title: scene.title,
      narration: scene.narration,
      imagePath,
      audioPath: audioUrl,
      narrationAudioUrl: audioUrl,
      durationSeconds: duration,
      subtitles,
      motion,
      mood,
      backgroundMusicUrl: musicUrlBySceneId[scene.scene_id],
      effects,
    });
  }

  const manifest: Manifest = {
    bookSlug: slug,
    bookTitle,
    scenes: out,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[movie-build] manifest written: ${manifestPath}`);

  const total = out.reduce((s, x) => s + x.durationSeconds, 0);
  console.log(`[movie-build] total narration: ${(total / 60).toFixed(1)} min across ${out.length} scenes`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
