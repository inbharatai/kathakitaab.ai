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

// Anonymous visitors can watch only the curated Ramayana movie. Every
// other movie / trailer needs sign-in — matches the read access rule
// in /api/books/[slug].
const ANONYMOUS_WATCHABLE_SLUGS = new Set(['ramayana']);

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

  // Same anonymous gate as /api/books/[slug]: only Ramayana plays
  // without sign-in. Every other movie/trailer requires an account.
  const session = await getSessionFromRouteRequest(request);
  if (!session && !ANONYMOUS_WATCHABLE_SLUGS.has(slug)) {
    return NextResponse.json({
      error: 'Sign in to watch this movie. The Ramayana plays for everyone — every other movie needs a free account.',
      reason: 'auth_required',
      slug,
    }, { status: 401 });
  }

  // Visibility check: private books can only be rendered by owner or admin.
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

  return NextResponse.json({ manifest });
}
