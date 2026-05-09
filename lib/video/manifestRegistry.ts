// ============================================================
// lib/video/manifestRegistry.ts
//
// Slug → BookMovie manifest lookup. Two sources, in order:
//
//   1. Static, pre-baked JSON in remotion/manifests/{slug}.json —
//      produced by `npm run movie:build -- --slug=<slug>` and
//      committed to the repo. Fully bake-tested manifests for
//      curated books like Ramayana.
//
//   2. AI-generated books in the bookRegistry — synthesised on
//      the fly via manifestSynthesizer. This unlocks the movie /
//      trailer modes for any book a user types in (Akbar &
//      Birbal, Tenali Raman, Buddha tales, NCERT chapters)
//      without anyone having to commit a JSON.
//
// Static manifests are kept for the books that ship pre-baked
// audio + tuned camera motion. Synthesised manifests fall back
// to procedural mood beds and LLM-picked motion — perfectly
// playable, just not hand-tuned.
//
// The synchronous `getManifestForSlug` keeps the existing
// Player-on-the-landing-page wiring working; new async callers
// (render-movie route, /books/[slug]/movie page) should use
// `getManifestForSlugAsync` so they pick up generated books too.
// ============================================================

import type { BookMovieManifest } from '@/remotion/BookMovie';
import ramayanaManifest from '@/remotion/manifests/ramayana.json';
import { getBook, saveGeneratedBook } from '@/lib/data/bookRegistry';
import { ramayanaHotspots } from '@/lib/data/hotspots';
import { synthesizeBookMovieManifest, hydrateBookAudio } from './manifestSynthesizer';

/**
 * Enrich the static Ramayana manifest with the hand-authored
 * hotspot positions from `lib/data/hotspots.ts`. The committed JSON
 * pre-dates the BookMovie ambient layer, so without this step the
 * Ramayana movie wouldn't have per-character puppet states (breath,
 * sway, glow ring) — only the live reader would. Doing it here once
 * at module load keeps the manifest immutable and avoids
 * regenerating the JSON every time the hotspots change.
 */
function enrichRamayanaWithHotspots(m: BookMovieManifest): BookMovieManifest {
  return {
    ...m,
    scenes: m.scenes.map(s => {
      // The seed lives at lib/data/hotspots.ts indexed by scene_id.
      const sceneHotspots = ramayanaHotspots
        .filter(h => h.scene_id === s.sceneId)
        .filter(h => h.hotspot_type === 'character' || h.hotspot_type === 'object' || h.hotspot_type === 'place')
        .map(h => ({
          label: h.label,
          type: h.hotspot_type as 'character' | 'object' | 'place',
          x: h.x,
          y: h.y,
          width: h.width,
          height: h.height,
        }));
      return { ...s, hotspots: sceneHotspots };
    }),
  };
}

const STATIC_REGISTRY: Record<string, BookMovieManifest> = {
  ramayana: enrichRamayanaWithHotspots(ramayanaManifest as BookMovieManifest),
  // Add new books here as their pre-baked manifests are committed.
};

/**
 * Synchronous lookup. Returns only static manifests — used by the
 * landing-page Player which can't await module init.
 */
export function getManifestForSlug(slug: string): BookMovieManifest | null {
  return STATIC_REGISTRY[slug] ?? null;
}

/**
 * Async lookup. Returns the static manifest if one exists; otherwise
 * synthesises a manifest from the AI-generated book in the registry.
 * Returns null only when the slug is unknown to both sources.
 *
 * Audio URLs are returned as-is from the registry — already-hydrated
 * scenes have URLs, un-hydrated ones get an empty audioPath and play
 * silent under the mood bed. The /api/livebook/manifest route kicks
 * off the audio hydration in `after()` so the response is instant.
 */
export async function getManifestForSlugAsync(slug: string): Promise<BookMovieManifest | null> {
  const staticManifest = STATIC_REGISTRY[slug];
  if (staticManifest) return staticManifest;

  const generated = await getBook(slug);
  if (!generated) return null;

  return synthesizeBookMovieManifest(generated);
}

// Tracks slugs whose hydration is currently running on this lambda.
// Without this, every concurrent manifest fetch for the same slug
// fires its own hydration job — wasteful and confusing under load.
// (Cross-lambda coordination would need Redis; this is a per-instance
// best-effort dedupe that's good enough for the typical "user opens
// movie page → maybe refreshes → fetches twice" pattern.)
const inFlightHydrations = new Set<string>();

/**
 * Run audio hydration for any scenes that are still missing URLs,
 * if no other hydration for this slug is already in flight on the
 * same lambda. Designed to be called from `after()` so the cost
 * lands AFTER the response, inside the lambda's 300s budget.
 */
export async function kickOffAudioHydrationIfNeeded(slug: string): Promise<void> {
  if (inFlightHydrations.has(slug)) return;
  const generated = await getBook(slug);
  if (!generated) return;
  const needsAudio = generated.scenes.some(s => !s.narration_audio_url);
  if (!needsAudio) return;

  inFlightHydrations.add(slug);
  try {
    const hydrated = await hydrateBookAudio(generated);
    await saveGeneratedBook(hydrated);
  } finally {
    inFlightHydrations.delete(slug);
  }
}

export function getAvailableMovieSlugs(): string[] {
  return Object.keys(STATIC_REGISTRY);
}
