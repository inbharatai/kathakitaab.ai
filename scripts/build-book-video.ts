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
import { concatWav } from '../lib/audio/concatWav';
import { detectTone } from '../lib/audio/emotionTagger';

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

/** Build subtitle cues from real per-clip durations. The cumulative
 *  sum of clip durations gives us the start of each cue, so the
 *  caption track is byte-accurate to the audio — no estimation,
 *  no off-by-300ms drift. */
function buildPerCueSubtitles(sentences: string[], perCueMs: number[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const startMs = cursor;
    const endMs = cursor + (perCueMs[i] ?? 0);
    cues.push({ text: sentences[i], startMs, endMs });
    cursor = endMs;
  }
  return cues;
}

/** Split narration into sentences using the same heuristic the
 *  subtitle planner uses, lifted here so the build script can request
 *  per-cue audio without importing the planner's internal helper. */
function splitSentencesForTTS(narration: string): string[] {
  const trimmed = narration.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[.!?])\s+(?=[A-Zऀ-ॿ])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts.length > 0 ? parts : [trimmed];
}

/** Per-cue TTS: render each sentence with detected tone + scene mood,
 *  concatenate into a single WAV, return the local filename and the
 *  exact per-cue duration list (in ms). The caller uses the durations
 *  to build accurate subtitle timing — no estimation. */
async function ttsPerCueToFile(
  scene: Scene,
  outDir: string,
  basename: string,
  mood?: string,
): Promise<{ fileName: string; perCueMs: number[]; sentences: string[] }> {
  const sentences = splitSentencesForTTS(scene.narration);
  if (sentences.length === 0) throw new Error(`empty narration for ${scene.scene_id}`);

  const buffers: Buffer[] = [];
  console.log(`[movie-build]    per-cue TTS: ${sentences.length} sentence(s)`);
  for (let i = 0; i < sentences.length; i++) {
    const text = sentences[i];
    const tone = detectTone(text); // 'serene'/'dramatic'/etc. or 'neutral'
    console.log(`[movie-build]      cue[${i}] (${tone}, ${text.length} chars): ${text.slice(0, 60)}…`);
    const res = await fetch(`${BASE}/api/livebook/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 1450),
        voice: 'narration',
        language: 'en',
        tone,  // explicit per-cue
        mood,  // floor in case the cue is neutral
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`per-cue TTS ${scene.scene_id}#${i} → ${res.status} ${txt.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') {
      // Per-cue concatenation requires WAV. Sarvam returns WAV by
      // default; if a fallback path is serving MP3, bail and let the
      // caller drop back to the single-call mode. Keeps behavior
      // graceful in environments without WAV-capable TTS.
      throw new Error(`per-cue TTS ${scene.scene_id}#${i}: non-WAV response (cannot concat MP3 here)`);
    }
    buffers.push(buf);
  }

  const result = concatWav(buffers);
  const fileName = `${basename}.wav`;
  writeFileSync(join(outDir, fileName), result.buffer);
  return { fileName, perCueMs: result.durationsMs, sentences };
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
  // Opt-in: render each subtitle cue as its own TTS clip with per-cue
  // emotional tone, then concatenate the WAVs and use the actual
  // per-clip durations as the cue timing. Costs N× more TTS calls
  // per scene (one per sentence) but produces a noticeably more
  // expressive scene narration. Default off — Wave 1.1 mood-aware
  // single-call TTS is the cheap path.
  const perCue = process.argv.includes('--per-cue-tts');

  const audioDir = join(PUBLIC_DIR, 'movies', 'audio', slug);
  const manifestPath = join(MANIFESTS_DIR, `${slug}.json`);
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(MANIFESTS_DIR, { recursive: true });

  console.log(`[movie-build] slug: ${slug} | base: ${BASE} | per-cue=${perCue}`);

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

    // Per-cue mode emits the exact per-sentence durations so we can
    // use them for byte-accurate cue timing. In single-call mode we
    // still compute timings via planSubtitles (length-weighted).
    let perCueDurationsMs: number[] | null = null;
    let perCueSentences: string[] | null = null;

    if (!audioFileRel) {
      if (perCue) {
        console.log(`[movie-build] tts (per-cue): ${scene.scene_id} (${scene.narration.length} chars, mood=${sceneMood ?? 'none'})`);
        const result = await ttsPerCueToFile(scene, audioDir, scene.scene_id, sceneMood);
        audioFileRel = `movies/audio/${slug}/${result.fileName}`;
        perCueDurationsMs = result.perCueMs;
        perCueSentences = result.sentences;
      } else {
        console.log(`[movie-build] tts: ${scene.scene_id} (${scene.narration.length} chars, mood=${sceneMood ?? 'none'})`);
        const fileName = await ttsToFile(scene, audioDir, scene.scene_id, sceneMood);
        audioFileRel = `movies/audio/${slug}/${fileName}`;
      }
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
    const subtitles =
      perCueDurationsMs && perCueSentences
        ? buildPerCueSubtitles(perCueSentences, perCueDurationsMs)
        : planSubtitles(scene.narration, duration);
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
