// ============================================================
// app/api/livebook/manifest/route.ts
//
// Returns the BookMovie manifest for any book — static for the
// pre-baked Ramayana/Mahabharata/etc., synthesised on demand for
// AI-generated books in the registry.
//
// This is what the per-book movie page calls to bring up its
// <Player>, and what the trailer button on the books index page
// can pre-fetch when the user hovers a card. One endpoint,
// universal for every book the engine knows about.
// ============================================================

import { NextResponse } from 'next/server';
import { getManifestForSlugAsync, hydrateAndPersist } from '@/lib/video/manifestRegistry';

// First call for an AI-generated book hydrates all scene narrations
// via Gemini → Supabase. ~11 scenes × 6s = ~70s. Subsequent calls
// hit the cached URLs and return in milliseconds.
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug query parameter is required' }, { status: 400 });
  }

  // Hydrate inline. Sarvam-in-after() couldn't deliver reliably; the
  // synchronous Gemini path takes ~70s on a fresh book and 0s once
  // the book has been hydrated.
  await hydrateAndPersist(slug);

  const manifest = await getManifestForSlugAsync(slug);
  if (!manifest) {
    return NextResponse.json(
      {
        error: `No manifest found for "${slug}"`,
        hint: 'Generate the book first via /api/books/generate, or commit a static manifest to remotion/manifests/',
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ manifest });
}
