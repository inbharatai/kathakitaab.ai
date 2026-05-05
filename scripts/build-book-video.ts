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
  durationSeconds: number;
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

async function ttsToFile(scene: Scene, outDir: string, basename: string): Promise<string> {
  const res = await fetch(`${BASE}/api/livebook/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: scene.narration.slice(0, 1450),
      voice: 'narration',
      language: 'en',
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

  const out: ManifestScene[] = [];
  for (const scene of scenes) {
    // Discover whichever extension is already on disk; rebuild if neither.
    const relCandidates = ['mp3', 'wav'].map(ext => `movies/audio/${slug}/${scene.scene_id}.${ext}`);
    let audioFileRel = relCandidates.find(rel => existsSync(join(PUBLIC_DIR, rel)));

    if (!audioFileRel) {
      console.log(`[movie-build] tts: ${scene.scene_id} (${scene.narration.length} chars)`);
      const fileName = await ttsToFile(scene, audioDir, scene.scene_id);
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
    out.push({
      sceneId: scene.scene_id,
      title: scene.title,
      narration: scene.narration,
      imagePath,
      audioPath: audioUrl,
      durationSeconds: duration,
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
