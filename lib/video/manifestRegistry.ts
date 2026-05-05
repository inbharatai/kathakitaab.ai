// ============================================================
// lib/video/manifestRegistry.ts
//
// Slug → BookMovie manifest lookup. Manifests are JSON files
// produced by `npm run movie:build -- --slug=<slug>` and
// committed to remotion/manifests/. Each book whose canon has
// been processed gets a static import here; the per-book movie
// page (and any future API consumer) reads through this single
// registry so there's one place to plumb a new book in.
//
// We keep this static (no dynamic require()) so the bundler can
// tree-shake unused manifests when only one book ships per route.
// ============================================================

import type { BookMovieManifest } from '@/remotion/BookMovie';
import ramayanaManifest from '@/remotion/manifests/ramayana.json';

const REGISTRY: Record<string, BookMovieManifest> = {
  ramayana: ramayanaManifest as BookMovieManifest,
  // Add new books here as their manifests are committed:
  // mahabharata: mahabharataManifest as BookMovieManifest,
};

export function getManifestForSlug(slug: string): BookMovieManifest | null {
  return REGISTRY[slug] ?? null;
}

export function getAvailableMovieSlugs(): string[] {
  return Object.keys(REGISTRY);
}
