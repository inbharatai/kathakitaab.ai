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
import { geminiTTS } from '@/lib/audio/geminiAudioClient';
import { uploadGeneratedNarration } from '@/lib/storage/audioStorage';

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

  // Serial Gemini with one retry on failure. The previous parallel-5
  // attempt left ~40% of scenes unhydrated due to Gemini's per-key
  // RPM cap. Going serial with a 1.5s gap between calls keeps every
  // request inside the rate budget; one retry catches the rare
  // transient hiccup. 10 scenes × ~8s + 10 × 1.5s gap = ~95s, well
  // inside the 300s manifest-route budget.
  for (const { s, i } of missing) {
    const language = /[ऀ-ॿ]/.test(s.narration) ? 'hi' : 'en';
    const stageDirection = language === 'hi'
      ? '[गर्म, धीमा भारतीय कथावाचक की आवाज़ में पढ़ें।]\n'
      : '[Read this as a warm, dignified Indian-English narrator. Steady pace, slight resonance.]\n';

    let attempt = 0;
    let succeeded = false;
    while (attempt < 2 && !succeeded) {
      try {
        const result = await geminiTTS({
          text: stageDirection + s.narration.slice(0, 4000),
          language,
          voiceName: 'Charon',
        });
        const url = await uploadGeneratedNarration(result.audio, {
          mimeType: result.mimeType,
          path: `${slug}/narration/${s.scene_id}.wav`,
        });
        scenes[i] = { ...scenes[i], narration_audio_url: url };
        succeeded = true;
      } catch (err) {
        attempt++;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          console.error(`[hydrateBookAudio] gemini failed twice for ${s.scene_id}:`, err instanceof Error ? err.message : err);
        }
      }
    }
    // Small gap between scenes to stay under Gemini's RPM cap.
    await new Promise(r => setTimeout(r, 1500));
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
