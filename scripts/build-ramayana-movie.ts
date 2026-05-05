// ============================================================
// scripts/build-ramayana-movie.ts
//
// Sole pipeline stage for the live Ramayana trailer. This script:
//
//   1. Pulls every static Ramayana scene from the running dev server
//      (so we get the exact same narration the in-app reader hears).
//   2. Calls /api/livebook/tts for each scene to render Sarvam Bulbul
//      narration. Caches mp3/wav locally under public/movies/audio/
//      (gitignored — the cache speeds up reruns; it's not deployed).
//   3. Uploads each clip to Supabase Storage (`scene-images` bucket,
//      `ramayana/movie-audio/` prefix) so the Remotion Player on the
//      landing page streams them from the CDN, not from /public.
//   4. Probes each clip's duration with `music-metadata` so the
//      composition can size each Sequence correctly.
//   5. Writes `remotion/ramayana-manifest.json` — the single source
//      of truth the RamayanaMovie composition reads at module load.
//
// Idempotent: existing local audio is reused, existing storage
// uploads upsert. Run after `next dev` is up on :5009.
// ============================================================

import './_loadEnv';

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSupabaseService } from '../lib/supabase';

const PUBLIC_DIR = join(process.cwd(), 'public');
const AUDIO_DIR = join(PUBLIC_DIR, 'movies', 'audio');
const MANIFEST_PATH = join(process.cwd(), 'remotion', 'ramayana-manifest.json');

const BASE = process.env.MOVIE_BUILD_BASE || 'http://localhost:5009';
const STORAGE_BUCKET = 'scene-images';
const STORAGE_PREFIX = 'ramayana/movie-audio';

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
  bookSlug: 'ramayana';
  bookTitle: string;
  scenes: ManifestScene[];
  generatedAt: string;
}

async function fetchBook(): Promise<{ scenes: Scene[]; bookTitle: string }> {
  const res = await fetch(`${BASE}/api/books/ramayana`);
  if (!res.ok) throw new Error(`/api/books/ramayana → ${res.status}`);
  const data = (await res.json()) as { scenes: Scene[]; book?: { title: string } };
  // book is sometimes flattened; tolerate both shapes
  const title = data.book?.title || 'The Ramayana';
  return { scenes: data.scenes, bookTitle: title };
}

// Returns { extension, contentType } so caller can pick a sensible filename.
// Both providers in the chain (Sarvam mp3, Gemini wav) are valid Remotion
// <Audio> sources, but file-extension must match content or music-metadata
// chokes on the format probe.
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

async function uploadToSupabase(localPath: string, remoteName: string): Promise<string> {
  const supabase = getSupabaseService();
  if (!supabase) {
    throw new Error('Supabase service client not configured — set SUPABASE_SERVICE_ROLE_KEY');
  }
  const bytes = readFileSync(localPath);
  const ext = remoteName.endsWith('.wav') ? 'wav' : 'mp3';
  const contentType = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const remotePath = `${STORAGE_PREFIX}/${remoteName}`;

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

  // Some Sarvam/Gemini WAV blobs come without a `data` chunk size set,
  // so music-metadata can't compute duration. Compute from PCM headers
  // ourselves: bytes / (sampleRate * channels * bytesPerSample).
  if (filePath.endsWith('.wav')) {
    const buf = readFileSync(filePath);
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF') {
      const sampleRate = buf.readUInt32LE(24);
      const byteRate = buf.readUInt32LE(28);
      if (byteRate > 0) {
        const dataBytes = buf.length - 44; // header is 44 bytes
        return dataBytes / byteRate;
      }
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
  mkdirSync(AUDIO_DIR, { recursive: true });
  console.log(`[movie-build] base: ${BASE}`);

  const { scenes, bookTitle } = await fetchBook();
  console.log(`[movie-build] ${scenes.length} scenes`);

  const out: ManifestScene[] = [];
  for (const scene of scenes) {
    // Discover whichever extension is already on disk; rebuild if neither.
    const candidates = ['mp3', 'wav'].map(ext => `movies/audio/${scene.scene_id}.${ext}`);
    let audioFileRel = candidates.find(rel => existsSync(join(PUBLIC_DIR, rel)));

    if (!audioFileRel) {
      console.log(`[movie-build] tts: ${scene.scene_id} (${scene.narration.length} chars)`);
      const fileName = await ttsToFile(scene, AUDIO_DIR, scene.scene_id);
      audioFileRel = `movies/audio/${fileName}`;
    } else {
      console.log(`[movie-build] tts: ${scene.scene_id} (cached: ${audioFileRel})`);
    }
    const audioFileAbs = join(PUBLIC_DIR, audioFileRel);
    const fileName = audioFileRel.split('/').pop()!;

    const duration = await probeDuration(audioFileAbs);
    console.log(`[movie-build]    duration: ${duration.toFixed(2)}s`);

    // Upload narration to Supabase Storage so the Remotion Player on
    // the landing page streams it from the CDN. The local cache stays
    // around for fast rebuilds but is gitignored — only the public
    // CDN URL flows into the manifest that ships to the browser.
    const audioUrl = await uploadToSupabase(audioFileAbs, fileName);
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
    bookSlug: 'ramayana',
    bookTitle,
    scenes: out,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[movie-build] manifest written: ${MANIFEST_PATH}`);

  const total = out.reduce((s, x) => s + x.durationSeconds, 0);
  console.log(`[movie-build] total narration: ${(total / 60).toFixed(1)} min across ${out.length} scenes`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

// Tiny helper used when re-imported: lets other scripts read the
// generated manifest without having to know the path.
export function readManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}
