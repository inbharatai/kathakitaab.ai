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

import { NextResponse, after } from 'next/server';
import { getManifestForSlugAsync, kickOffAudioHydrationIfNeeded } from '@/lib/video/manifestRegistry';

// We respond immediately with whatever audio is already hydrated and
// kick off the rest in `after()`. The lambda still gets 300s for the
// background hydration to finish.
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug query parameter is required' }, { status: 400 });
  }

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

  // If any scenes still need narration audio, run the hydration pass
  // AFTER the response is sent. The user gets the manifest instantly
  // (images + captions + music + any already-hydrated audio); the
  // background pass writes URLs back to the registry. On the next
  // fetch — usually a refresh a couple of minutes later — the audio
  // is there.
  after(async () => {
    try {
      await kickOffAudioHydrationIfNeeded(slug);
    } catch (err) {
      console.error('[manifest] background hydration failed:', err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({ manifest });
}
