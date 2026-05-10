import { NextResponse } from 'next/server';
import { getAllBooks as getSeedBooks } from '@/lib/data/ramayanaSeed';
import { getAllBooks as getRegistryBooks } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';

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
  const seed = getSeedBooks();
  const generated = await getRegistryBooks();
  const ownerId = getOwnerIdFromRequest(request);

  const generatedAsBook = generated
    .filter(b => {
      // Public AI-generated books: always visible.
      if (!b.visibility || b.visibility === 'public') return true;
      // Private books: only the owner sees them in the listing.
      return ownerId !== null && b.ownerId === ownerId;
    })
    .map(b => ({
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
    }));

  return NextResponse.json({ books: [...seed, ...generatedAsBook] });
}
