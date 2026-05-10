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
import { synthesizeBookMovieManifest, hydrateBookAudio } from './manifestSynthesizer';

// Static manifests ship pre-rendered into the JSON itself: scene
// images, narration audio URLs, hotspots, and durations are all
// inline. The previous build pulled hotspots from a separate seed
// file at module load, but the AI-regenerated Ramayana carries its
// own hotspots and the seed's scene_ids no longer line up — running
// the old enrichment would have erased every hotspot. Refresh
// ramayana.json via `scripts/refresh-static-manifest.ts ramayana`
// after each regen so this stays in sync.
const STATIC_REGISTRY: Record<string, BookMovieManifest> = {
  ramayana: ramayanaManifest as BookMovieManifest,
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

/**
 * Synchronous audio hydration. Returns when all missing scene
 * narrations have been rendered + uploaded + saved back to the
 * registry. No-op on an already-hydrated book or one that's not in
 * the registry. The caller (manifest route) awaits this so the
 * response carries fully-populated audio URLs.
 */
export async function hydrateAndPersist(slug: string): Promise<void> {
  const generated = await getBook(slug);
  if (!generated) return;
  const needsAudio = generated.scenes.some(s => !s.narration_audio_url);
  if (!needsAudio) return;
  const hydrated = await hydrateBookAudio(generated);
  await saveGeneratedBook(hydrated);
}

export function getAvailableMovieSlugs(): string[] {
  return Object.keys(STATIC_REGISTRY);
}
