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
import { saveGeneratedBook } from '@/lib/data/bookRegistry';

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
 * Render scene narrations into Supabase Storage so the live reader and
 * movie can play them straight from CDN. Routes through speakTTS
 * (Sarvam → Gemini fallback) — same chain as /api/livebook/tts, so
 * the pre-rendered voice matches the on-the-fly voice exactly.
 *
 * Why not call Gemini directly:
 *   The previous implementation hardcoded geminiTTS, which meant
 *   every pre-hydrated book got Gemini regardless of Sarvam's
 *   availability. Sarvam is faster and produces better Indic
 *   prosody; skipping it forced every reader through the slow
 *   path. Routing through speakTTS gets each scene whichever
 *   provider Sarvam gives us first, with Gemini as the safety net.
 *
 * Resilience:
 *   - Per-scene try/catch — one bad scene doesn't poison the rest.
 *   - speakTTS already has its own provider-fallback chain inside,
 *     so a per-scene failure here means BOTH Sarvam and Gemini
 *     refused the text.
 *   - Serial with a small gap. Sarvam's per-key RPM is generous;
 *     Gemini's is the bottleneck. Spacing keeps both inside their
 *     budgets even when scenes fall through to Gemini.
 */
export async function hydrateBookAudio(book: GeneratedBook): Promise<GeneratedBook> {
  const slug = book.slug;
  const scenes = book.scenes.slice();

  // Find the indices of scenes that need audio. We re-render any
  // scene that doesn't have a URL OR isn't explicitly tagged as
  // Sarvam-rendered. Untagged URLs are treated as legacy / unknown
  // provenance — almost certainly Gemini-voiced because the broken
  // 500-char Sarvam path drove every long narration into the
  // fallback before the chunker fix shipped. Hitting them all once
  // on the first manifest fetch is the global self-heal, no
  // operator-named slug needed.
  //
  // Cost: ~$0.10 one-time per legacy book. Re-renders use upsert on
  // the same Supabase path, so old URLs keep working through the
  // transition and tagged scenes don't re-render on subsequent reads.
  const missing = scenes
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.narration_audio_url || s.audio_provider !== 'sarvam');
  if (missing.length === 0) return book;

  // Persist after EACH successful scene so partial progress survives
  // a process restart, lambda timeout, or page navigation. The previous
  // contract only saved at the very end, which meant losing 8 minutes
  // of paid TTS work whenever scene 9 of 10 timed out. Saving inline
  // also lets a follow-up call to hydrateBookAudio resume from where
  // the prior run gave up — `missing` already filters to scenes
  // without a URL, so re-running is cheap and idempotent.
  for (const { s, i } of missing) {
    // speakTTS auto-detects language from script (Devanagari → hi,
    // else → en) so we don't need to pass it explicitly. Mood is
    // forwarded so Sarvam can pick a matching pace/pitch/loudness.
    let attempt = 0;
    let succeeded = false;
    while (attempt < 2 && !succeeded) {
      try {
        const result = await speakTTS({
          text: s.narration.slice(0, 1500),
          mood: s.mood,
        });
        const ext = result.mimeType.includes('wav') ? 'wav' : result.mimeType.includes('mp3') ? 'mp3' : 'bin';
        const url = await uploadGeneratedNarration(result.audio, {
          mimeType: result.mimeType,
          path: `${slug}/narration/${s.scene_id}.${ext}`,
        });
        scenes[i] = {
          ...scenes[i],
          narration_audio_url: url,
          // Tag the provider so the self-heal in hydrateAndPersist
          // (and force-reaudio) can detect mis-rendered audio
          // automatically next time without anyone naming the book.
          audio_provider: result.provider,
        };
        succeeded = true;
        // Checkpoint: write the partially-hydrated book back to Redis
        // so this URL is durable even if the next scene blows up.
        try {
          await saveGeneratedBook({ ...book, scenes });
        } catch (saveErr) {
          // A failed checkpoint isn't fatal — the next scene will try
          // again, and the final return still carries the full result
          // for the caller's own save. Just surface it for debugging.
          console.warn(`[hydrateBookAudio] checkpoint save failed for ${slug} after ${s.scene_id}:`, saveErr instanceof Error ? saveErr.message : saveErr);
        }
      } catch (err) {
        attempt++;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          // Both Sarvam and Gemini refused. Don't crash the whole
          // hydration — the live reader will catch this scene later
          // via /api/livebook/tts on demand (same chain, same cache).
          console.error(`[hydrateBookAudio] both providers failed for ${s.scene_id}:`, err instanceof Error ? err.message : err);
        }
      }
    }
    // Brief gap so a Gemini-fallback wave doesn't blow the per-key RPM.
    await new Promise(r => setTimeout(r, 800));
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

      // Multi-beat visual track. When the generator painted 2+ beats
      // for this scene, forward them so BookMovie cross-fades through
      // them across `durationSeconds`. Single-beat (or legacy) scenes
      // omit the field and the renderer holds on `imagePath`.
      const beats = s.beats && s.beats.length >= 2
        ? s.beats.map(b => ({ imagePath: b.imageUrl }))
        : undefined;

      return {
        sceneId: s.scene_id,
        title: s.title,
        narration: s.narration,
        imagePath: s.background_asset_url || '',
        beats,
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
