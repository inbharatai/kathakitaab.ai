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
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { canReadBook } from '@/lib/auth/bookAccess';
import { getBook } from '@/lib/data/bookRegistry';

// Access control: private books can only be watched by their owner or
// an admin — enforced via canReadBook below, same rule as
// /api/books/[slug]. Public books (including the curated Ramayana
// movie) are watchable by anyone. (Auth is anonymous-only now; the old
// sign-in-gated "anonymous can watch only Ramayana" rule was removed
// with the rest of the accounts surface.)

// First call for an AI-generated book hydrates all scene narrations
// via Gemini → S3 (CloudFront CDN). ~11 scenes × 6s = ~70s. Subsequent calls
// hit the cached URLs and return in milliseconds.
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug query parameter is required' }, { status: 400 });
  }

  // Visibility check: private books can only be rendered by owner or admin.
  const session = await getSessionFromRouteRequest(request);
  const book = await getBook(slug);
  if (book) {
    const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
    const isAdmin = isAdminSession(session);
    if (!isAdmin && !canReadBook(book, ownerId)) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
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

  // Validate assets for AI-generated books. Static manifests (Ramayana)
  // are always considered ready. For generated books, check that every
  // scene has image and audio before claiming the movie is ready.
  const hydratedBook = await getBook(slug);
  const isStatic = !hydratedBook; // static manifests have no registry entry
  if (!isStatic && hydratedBook) {
    const missing: Array<{ sceneId: string; missing: string }> = [];
    for (const s of hydratedBook.scenes) {
      if (!s.background_asset_url) missing.push({ sceneId: s.scene_id, missing: 'image' });
      if (!s.narration_audio_url) missing.push({ sceneId: s.scene_id, missing: 'audio' });
    }
    if (missing.length > 0) {
      return NextResponse.json(
        { manifest, ready: false, missing },
        { status: 202 },
      );
    }
  }

  return NextResponse.json({ manifest, ready: true });
}
