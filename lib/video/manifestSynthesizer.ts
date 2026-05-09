// ============================================================
// lib/video/manifestSynthesizer.ts
//
// Build a BookMovieManifest at runtime from a registered
// GeneratedBook. This is what unlocks the movie/trailer mode for
// books the user types in — no need to commit a static
// remotion/manifests/{slug}.json or run scripts/build-book-video.ts.
//
// What it produces:
//   - Per-scene durationSeconds (from estimateNarrationSeconds in
//     bookGeneratorAgent, or freshly recomputed from word count)
//   - Per-scene motion (from scene.motion if the LLM picked one,
//     else mood→motion default)
//   - Per-scene effects[] (from topicTagger + effectRecipes — same
//     pipeline the live reader uses, so movie + reader stay in sync)
//   - Per-scene subtitles[] (planSubtitles fits cues inside the
//     estimated audio window)
//   - imagePath = scene.background_asset_url (Supabase CDN URL)
//   - audioPath = empty string. The render-movie route fills this
//     in by calling /api/livebook/tts per scene at render time —
//     keeps synthesis cheap and lets us reuse the TTS Redis cache.
// ============================================================

import type { GeneratedBook } from '@/lib/openai/bookGeneratorAgent';
import type { BookMovieManifest, BookMovieScene, BookMovieHotspot } from '@/remotion/BookMovie';
import { motionForMood, type SceneMotion } from './motion';
import { planSubtitles } from './subtitlePlanner';
import { detectTopics } from './effects/topicTagger';
import { buildSceneEffects } from './effects/effectRecipes';
import { speakTTS } from '@/lib/audio/ttsRouter';
import { uploadGeneratedNarration } from '@/lib/storage/audioStorage';
import { concatWav } from '@/lib/audio/concatWav';

// Sarvam latency scales with input length. Below ~450 chars we
// reliably get a response in 8-12s; above 600 chars the call drifts
// past 20s and starts tripping the 22s timeout. Chunking long
// narrations into sentence-aligned segments keeps every individual
// Sarvam call fast, so a 1200-char scene completes in ~24s
// (2 chunks × 12s) instead of timing out at 22s and falling to
// Gemini. concatWav stitches the PCM together byte-perfect.
const SARVAM_CHUNK_CHAR_TARGET = 420;

function chunkNarration(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    // If a single sentence already exceeds the target, ship the
    // current buf first (if any), then ship the long sentence on its
    // own — Sarvam handles up to 1500 chars even if slow.
    if (s.length > SARVAM_CHUNK_CHAR_TARGET) {
      if (buf) { chunks.push(buf); buf = ''; }
      chunks.push(s);
      continue;
    }
    if (buf.length + s.length + 1 > SARVAM_CHUNK_CHAR_TARGET) {
      chunks.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Estimate scene playback length from narration word count when the
 * generator didn't bake one in. ~150 wpm + ~2.5s tail matches the
 * estimateNarrationSeconds heuristic in bookGeneratorAgent.
 */
function fallbackDurationSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / 150) * 60 + 2.5));
}

/**
 * Lazily render scene narrations for a generated book that hasn't
 * been narrated yet. Designed for use from the manifest lookup path:
 * the book gen lambda exits fast (text + images only); the first
 * /api/livebook/manifest fetch hydrates audio inside its own 300s
 * budget. Subsequent fetches see the URLs already on the book and
 * skip this work.
 *
 * Concurrency is intentionally low (2) to stay under Sarvam's per-key
 * rate limits — the same setting that finally produced consistent
 * Sarvam-not-Gemini narrations during testing.
 */
export async function hydrateBookAudio(book: GeneratedBook): Promise<GeneratedBook> {
  const slug = book.slug;
  const scenes = book.scenes.slice();

  // Find the indices of scenes that still need audio. We only render
  // those, so partial hydration (e.g. 2 of 10 scenes failed and a
  // later request retries them) is cheap.
  const missing = scenes
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.narration_audio_url);
  if (missing.length === 0) return book;

  // Serial across scenes (Sarvam rate limit), chunked within each
  // scene (Sarvam latency on long text). For each scene's narration
  // we split into ~420-char chunks, render each chunk through the
  // TTS chain, then byte-concat the PCM WAVs into one file. This
  // gives every individual Sarvam call a fast (~10s) shot at success
  // — no timeouts, no Gemini fallback, no mixed-voice scenes.
  for (const { s, i } of missing) {
    try {
      const chunks = chunkNarration(s.narration);
      const wavBuffers: Buffer[] = [];
      let mime = 'audio/wav';
      for (const chunk of chunks) {
        const result = await speakTTS({
          text: chunk,
          bookSlug: slug,
          mood: s.mood,
        });
        wavBuffers.push(result.audio);
        mime = result.mimeType;
      }
      // If any chunk fell through to Gemini (24kHz vs Sarvam's 22050)
      // concatWav rejects mismatched sample rates. In that case
      // we keep just the first chunk — better one consistent voice
      // than a broken concat.
      let audio: Buffer;
      try {
        audio = wavBuffers.length === 1 ? wavBuffers[0] : concatWav(wavBuffers).buffer;
      } catch (concatErr) {
        console.warn(`[hydrateBookAudio] concat failed for ${s.scene_id} (${concatErr instanceof Error ? concatErr.message : concatErr}); using first chunk only`);
        audio = wavBuffers[0];
      }
      const url = await uploadGeneratedNarration(audio, {
        mimeType: mime,
        path: `${slug}/narration/${s.scene_id}.${mime === 'audio/mpeg' ? 'mp3' : 'wav'}`,
      });
      scenes[i] = { ...scenes[i], narration_audio_url: url };
    } catch (err) {
      console.error(`[hydrateBookAudio] scene ${s.scene_id} failed:`, err instanceof Error ? err.message : err);
      // Leave narration_audio_url unset — the movie composition
      // will play silent for that scene with the mood bed under it,
      // and the next manifest fetch will retry just this one.
    }
  }
  return { ...book, scenes };
}

/**
 * Convert a GeneratedBook into a BookMovieManifest the Remotion
 * BookMovie/BookTrailer compositions can render directly.
 *
 * The synthesizer is deterministic: same input → same manifest. So
 * caching the result by book slug + generatedAt is safe (the
 * render-movie route already hashes the manifest for the MP4 cache).
 */
export function synthesizeBookMovieManifest(book: GeneratedBook): BookMovieManifest {
  const scenes: BookMovieScene[] = book.scenes
    // The reader honours order_index but we sort defensively in case
    // the registry returned them out of order.
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map(s => {
      const durationSeconds = s.duration_seconds ?? fallbackDurationSeconds(s.narration);
      const motion: SceneMotion = (s.motion as SceneMotion | undefined) ?? motionForMood(s.mood);
      const topics = detectTopics(s.narration);
      const effects = buildSceneEffects(topics, s.mood ?? 'serene');

      // narration_audio_url is filled in by bookGeneratorAgent at gen
      // time via Sarvam → Supabase. Empty fallback keeps Remotion
      // happy when audio failed to render — the MP4 still plays with
      // mood music and captions.
      const audioPath = s.narration_audio_url ?? '';

      // Hotspot positions feed BookMovie's per-character ambient
      // layer (breath + sway + glow ring on each character region).
      // We restrict to the three types the renderer cares about; the
      // generator emits 'character' / 'object' / 'place' so this is
      // a straight pass-through with a type narrowing.
      const hotspots: BookMovieHotspot[] = (s.hotspots ?? [])
        .filter(h => h.hotspot_type === 'character' || h.hotspot_type === 'object' || h.hotspot_type === 'place')
        .map(h => ({
          label: h.label,
          type: h.hotspot_type as BookMovieHotspot['type'],
          x: h.x,
          y: h.y,
          width: h.width,
          height: h.height,
        }));

      return {
        sceneId: s.scene_id,
        title: s.title,
        narration: s.narration,
        imagePath: s.background_asset_url || '',
        audioPath,
        narrationAudioUrl: audioPath || undefined,
        durationSeconds,
        mood: s.mood ?? 'serene',
        motion,
        // backgroundMusicUrl unset → BookMovie picks the procedural
        // mood bed at the right tempo for s.mood. Universal.
        backgroundMusicUrl: undefined,
        effects,
        subtitles: planSubtitles(s.narration, durationSeconds),
        hotspots,
      };
    });

  return {
    bookSlug: book.slug,
    bookTitle: book.title,
    scenes,
    generatedAt: new Date(book.generatedAt).toISOString(),
  };
}
