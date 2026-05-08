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
