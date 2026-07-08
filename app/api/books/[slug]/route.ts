import { NextResponse, after } from 'next/server';
import { getBook as getSeedBook, getScenesByBookId, getCharactersByBookId } from '@/lib/data/ramayanaSeed';
import { getBook as getRegistryBook, deleteBook } from '@/lib/data/bookRegistry';
import { deleteScenesForBook, deleteBookCharacters } from '@/lib/data/sceneRegistry';
import { getJobBySlug, deleteJob } from '@/lib/data/jobRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { canReadBook } from '@/lib/auth/bookAccess';
import { hydrateAndPersist } from '@/lib/video/manifestRegistry';
import { saveGeneratedBook } from '@/lib/data/bookRegistry';


export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {

  // Try the curated seed (Ramayana) first. Seed books are always
  // public — they predate the ownership model.
  const seedBook = getSeedBook(slug);
  if (seedBook) {
    const scenes = getScenesByBookId(seedBook.id);
    const characters = getCharactersByBookId(seedBook.id);
    return NextResponse.json({ book: seedBook, scenes, characters });
  }

  // Fall back to the bookRegistry (AI-generated books). The shape
  // there is GeneratedBook — slightly different from the seed Book
  // type, so we normalise into the same { book, scenes, characters }
  // envelope the reader expects.
  const generated = await getRegistryBook(slug);
  if (generated) {
    const session = await getSessionFromRouteRequest(request);
    // Use the authed userId when present, else fall back to legacy
    // anonymous owner cookie. Private books only resolve for owner.
    const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
    if (!canReadBook(generated, ownerId)) {
      // 404 instead of 403 so the existence of the slug stays
      // private. A private book to its owner = visible; to anyone
      // else = doesn't exist.
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
    // Self-heal: trigger hydration in after() when any scene either
    // lacks audio OR isn't explicitly tagged as Sarvam-rendered. The
    // provider tag is the global signal — legacy books rendered
    // before the Sarvam chunker fix have Gemini WAVs on now-dead
    // Supabase URLs and no provider tag, so they auto-heal the first
    // time the live
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

    return NextResponse.json(
      {
        book: {
          id: generated.id,
          slug: generated.slug,
          title: generated.title,
          subtitle: generated.subtitle,
          description: generated.description,
          source_tradition: generated.source_tradition,
          stylePreset: generated.stylePreset,
          accuracyLabel: generated.accuracyLabel ?? 'CREATIVE_RETELLING',
        },
        scenes: generated.scenes,
        characters: generated.characters,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  } catch (err) {
    console.error(`[api/books/${slug}] unexpected error:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load book' }, { status: 500 });
  }
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

  const session = await getSessionFromRouteRequest(request);
  const isAdmin = isAdminSession(session);

  // Admin can delete any AI-generated book (public or private).
  // Non-admin owners can only delete their own private books.
  if (!isAdmin) {
    if (generated.visibility !== 'private') {
      return NextResponse.json({ error: 'This book cannot be deleted.' }, { status: 403 });
    }
    const ownerId = getOwnerIdFromRequest(request);
    if (!ownerId || generated.ownerId !== ownerId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
  }

  await deleteBook(slug);

  // Clean up associated scenes, characters, and generation job so Redis doesn't leak.
  await deleteScenesForBook(slug);
  await deleteBookCharacters(slug);
  const job = await getJobBySlug(slug);
  if (job) {
    await deleteJob(job.id);
  }

  return NextResponse.json({ ok: true });
}

/** PATCH /api/books/[slug]
 *
 *  Owner (or admin) metadata edit for an AI-generated book.
 *  Editable fields: title, subtitle, description, visibility.
 *  Returns the updated book envelope.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  if (getSeedBook(slug)) {
    return NextResponse.json({ error: 'Seed books cannot be edited.' }, { status: 403 });
  }

  const generated = await getRegistryBook(slug);
  if (!generated) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  const session = await getSessionFromRouteRequest(request);
  const isAdmin = isAdminSession(session);
  const ownerId = session?.userId ?? getOwnerIdFromRequest(request);

  if (!isAdmin) {
    if (generated.visibility !== 'private') {
      return NextResponse.json({ error: 'This book cannot be edited.' }, { status: 403 });
    }
    if (!ownerId || generated.ownerId !== ownerId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const updates: Partial<Pick<typeof generated, 'title' | 'subtitle' | 'description' | 'visibility'>> = {};
  if (typeof body.title === 'string' && body.title.trim().length > 0) {
    updates.title = body.title.trim();
  }
  if (typeof body.subtitle === 'string') {
    updates.subtitle = body.subtitle.trim();
  }
  if (typeof body.description === 'string') {
    updates.description = body.description.trim();
  }
  if (body.visibility === 'public' || body.visibility === 'private') {
    updates.visibility = body.visibility;
  }

  const updated = {
    ...generated,
    ...updates,
    updatedAt: Date.now(),
  };
  await saveGeneratedBook(updated);

  return NextResponse.json({
    book: {
      id: updated.id,
      slug: updated.slug,
      title: updated.title,
      subtitle: updated.subtitle,
      description: updated.description,
      source_tradition: updated.source_tradition,
      stylePreset: updated.stylePreset,
      accuracyLabel: updated.accuracyLabel ?? 'CREATIVE_RETELLING',
    },
    scenes: updated.scenes,
    characters: updated.characters,
  });
}
