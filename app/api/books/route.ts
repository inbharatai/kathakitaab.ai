import { NextResponse } from 'next/server';
import { getAllBooks as getSeedBooks } from '@/lib/data/ramayanaSeed';
import { getScenesByBookId } from '@/lib/data/scenes';
import { getAllBooks as getRegistryBooks } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { resolveBookVisibility } from '@/lib/auth/bookAccess';

/** Public + my-private books listing.
 *
 *  Privacy contract:
 *  - Public books (seed + AI-generated with visibility=public) are
 *    always listed.
 *  - Private books (visibility=private) are listed only when the
 *    cookie owner matches book.ownerId. Non-owners never see them.
 *  - This means a non-owner walking up to /api/books cannot
 *    enumerate private slugs. The same protection applies in
 *    /api/books/[slug] (404 for non-owners).
 *
 *  Caching note: the registry's getAllBooks() returns the local
 *  in-memory hot cache plus seed books — it does NOT scan Redis
 *  across lambdas. For visibility checks that's actually safer
 *  (we never expose books that lambda hasn't seen this session)
 *  but it does mean the listing is a "best-effort" view, not the
 *  authoritative cross-lambda set. Routes that need authoritative
 *  reads use getBook(slug) which hits Redis.
 */
export async function GET(request: Request) {
  try {
  const seed = getSeedBooks();
  const generated = await getRegistryBooks();
  const ownerId = getOwnerIdFromRequest(request);

  // Debug logging to help trace why books may be missing from the
  // public listing. This fires once per cold-start lambda and helps
  // diagnose Redis scan vs memory-cache mismatches.
  console.log('[api/books] ownerId=%s seedCount=%d generatedCount=%d',
    ownerId ? 'present' : 'none', seed.length, generated.length);

  // Cover for seed books = first scene's background image. Without
  // this, the library shows a placeholder gradient for Ramayana while
  // every AI book gets a real cover from its first scene — the
  // mismatch is jarring.
  const seedAsBook = seed.map(b => {
    const scenes = getScenesByBookId(b.id).sort((a, b) => a.order_index - b.order_index);
    return {
      id: b.id,
      slug: b.slug,
      title: b.title,
      subtitle: b.subtitle,
      description: b.description,
      source_tradition: 'public-domain',
      mode: 'world' as const,
      coverImage: scenes[0]?.background_asset_url || '',
      hasMovie: true,
      movieStatus: 'ready' as const,
      // First-beat of the first 4 scenes — drives the Ken-Burns
      // background cycle on the landing-page cards. Falls back to
      // background_asset_url for any scene without beats.
      previewImages: scenes.slice(0, 4)
        .map(s => s.beats?.[0]?.imageUrl || s.background_asset_url)
        .filter((u): u is string => Boolean(u)),
    };
  });

  const generatedAsBook = generated
    .filter(b => {
      const effective = resolveBookVisibility(b);
      // Public AI-generated books: always visible.
      if (effective === 'public') return true;
      // Private books: only the owner sees them in the listing.
      return ownerId !== null && b.ownerId === ownerId;
    })
    .map(b => {
      // Defensive: books deserialized from Redis may have corrupted
      // or missing scenes arrays. Treat missing/non-array as empty.
      const scenes = Array.isArray(b.scenes) ? b.scenes : [];
      // Prefer the first scene's first beat image (multi-beat books)
      // and fall back to background_asset_url (single-beat / legacy).
      const firstScene = [...scenes].sort((a, b) => a.order_index - b.order_index)[0];
      const coverImage =
        firstScene?.beats?.[0]?.imageUrl
        || firstScene?.background_asset_url
        || '';
      const orderedScenes = [...scenes].sort((a, b) => a.order_index - b.order_index);

      // Backward compatibility: books created before the movieStatus
      // field was added (or where validation was skipped) should still
      // show as having a movie if their scenes have image + audio assets.
      const hasSceneAssets = orderedScenes.some(
        s => s.background_asset_url && s.narration_audio_url
      );
      const explicitReady = b.movieStatus === 'ready';
      const inferredReady = !b.movieStatus && hasSceneAssets;
      const hasMovie = explicitReady || inferredReady;
      const movieStatus = b.movieStatus ?? (hasSceneAssets ? 'ready' : 'pending');

      return {
        id: b.id,
        slug: b.slug,
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        source_tradition: b.source_tradition,
        // Surface the mode so future UI can group "your private stories"
        // separately from the public library. Older books without a
        // mode read as world implicitly.
        mode: b.mode ?? 'world',
        coverImage,
        previewImages: orderedScenes.slice(0, 4)
          .map(s => s.beats?.[0]?.imageUrl || s.background_asset_url)
          .filter((u): u is string => Boolean(u)),
        // So the UI can render owner-only edit/delete controls.
        visibility: b.visibility ?? 'public',
        isOwner: ownerId !== null && b.ownerId === ownerId,
        hasMovie,
        movieStatus,
      };
    });

  return NextResponse.json(
    { books: [...seedAsBook, ...generatedAsBook] },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
  } catch (err) {
    console.error('[api/books] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load library' }, { status: 500 });
  }
}
