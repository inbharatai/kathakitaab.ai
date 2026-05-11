import { NextResponse, after } from 'next/server';
import { getBook as getSeedBook, getScenesByBookId, getCharactersByBookId } from '@/lib/data/ramayanaSeed';
import { getBook as getRegistryBook, deleteBook } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { hydrateAndPersist } from '@/lib/video/manifestRegistry';

// Anonymous visitors can only open the curated Ramayana seed. Every
// other book (AI-generated mythology, fables, personalised stories)
// requires sign-in. This is the operator directive: free reading is
// restricted to the canonical reference book; signed-in users get
// the full library.
const ANONYMOUS_READABLE_SLUGS = new Set(['ramayana']);

/** Returns true when the requester may read this AI-generated book.
 *  Public books are always readable. Private books are readable only
 *  by the owner (cookie match). For non-owners we 404 — never 403 —
 *  so the existence of a private slug isn't disclosed. */
function canRead(book: { visibility?: 'public' | 'private'; ownerId?: string }, ownerId: string | null): boolean {
  if (!book.visibility || book.visibility === 'public') return true;
  if (!ownerId) return false;
  return book.ownerId === ownerId;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Try the curated seed (Ramayana) first. Seed books are always
  // public — they predate the ownership model.
  const seedBook = getSeedBook(slug);
  if (seedBook) {
    const scenes = getScenesByBookId(seedBook.id);
    const characters = getCharactersByBookId(seedBook.id);
    return NextResponse.json({ book: seedBook, scenes, characters });
  }

  // For any non-seed book, require a signed-in user — anonymous
  // visitors are restricted to the Ramayana seed only. Returns 401
  // so the client can redirect to /signin?next=<here>; respond with
  // the slug so the UI can show a clear "sign in to read X" prompt.
  const session = await getSessionFromRouteRequest(request);
  if (!session && !ANONYMOUS_READABLE_SLUGS.has(slug)) {
    return NextResponse.json({
      error: 'Sign in to read this book. The Ramayana is open to everyone — every other book requires a free account.',
      reason: 'auth_required',
      slug,
    }, { status: 401 });
  }

  // Fall back to the bookRegistry (AI-generated books). The shape
  // there is GeneratedBook — slightly different from the seed Book
  // type, so we normalise into the same { book, scenes, characters }
  // envelope the reader expects.
  const generated = await getRegistryBook(slug);
  if (generated) {
    // Use the authed userId when present, else fall back to legacy
    // anonymous owner cookie. Private books only resolve for owner.
    const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
    if (!canRead(generated, ownerId)) {
      // 404 instead of 403 so the existence of the slug stays
      // private. A private book to its owner = visible; to anyone
      // else = doesn't exist.
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
    // Self-heal: trigger hydration in after() when any scene either
    // lacks audio OR isn't explicitly tagged as Sarvam-rendered. The
    // provider tag is the global signal — legacy books rendered
    // before the Sarvam chunker fix have Gemini WAVs on Supabase and
    // no provider tag, so they auto-heal the first time the live
    // reader opens them. After re-render every scene is tagged
    // 'sarvam' and subsequent visits short-circuit.
    const needsHydration = generated.scenes.some(s =>
      !s.narration_audio_url || s.audio_provider !== 'sarvam');
    if (needsHydration) {
      after(async () => {
        try {
          await hydrateAndPersist(slug);
        } catch (err) {
          console.warn(`[books/${slug}] background hydration failed:`,
            err instanceof Error ? err.message : err);
        }
      });
    }

    return NextResponse.json({
      book: {
        id: generated.id,
        slug: generated.slug,
        title: generated.title,
        subtitle: generated.subtitle,
        description: generated.description,
        source_tradition: generated.source_tradition,
      },
      scenes: generated.scenes,
      characters: generated.characters,
    });
  }

  return NextResponse.json({ error: 'Book not found' }, { status: 404 });
}

/** DELETE /api/books/[slug]
 *
 *  Owner-only deletion of a private book. Public books and seed
 *  books cannot be deleted via this endpoint — those would need a
 *  privileged operator path which we don't ship to anonymous users.
 *
 *  Behaviour:
 *  - Seed/Ramayana → 403 (these are static, can't be deleted)
 *  - Public AI-generated book → 403 (ditto — we don't let anonymous
 *    cookie owners delete things they didn't make private)
 *  - Private AI-generated book where cookie matches owner → 200
 *  - Private AI-generated book where cookie doesn't match → 404
 *    (don't reveal the slug exists)
 *  - Missing slug → 404
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Seed books are immutable from this endpoint.
  if (getSeedBook(slug)) {
    return NextResponse.json({ error: 'This book cannot be deleted.' }, { status: 403 });
  }

  const generated = await getRegistryBook(slug);
  if (!generated) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  // Public AI-generated books: not deletable by anonymous owner.
  // We don't currently have a public/personal-public distinction;
  // any book stored as visibility=public is treated as canon-ish.
  if (generated.visibility !== 'private') {
    return NextResponse.json({ error: 'This book cannot be deleted.' }, { status: 403 });
  }

  const ownerId = getOwnerIdFromRequest(request);
  if (!ownerId || generated.ownerId !== ownerId) {
    // 404 not 403 — non-owner shouldn't even know the slug exists.
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  await deleteBook(slug);
  return NextResponse.json({ ok: true });
}
