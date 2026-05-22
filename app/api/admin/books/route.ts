import { NextResponse } from 'next/server';
import { getAllBooks as getSeedBooks } from '@/lib/data/ramayanaSeed';
import { getScenesByBookId } from '@/lib/data/scenes';
import { getAllBooks as getRegistryBooks } from '@/lib/data/bookRegistry';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';

/** Admin-only listing of every book (public + private + seed).
 *
 *  Returns 403 for non-admin users.
 */
export async function GET(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const seed = getSeedBooks();
  const generated = await getRegistryBooks();

  const seedAsBook = seed.map(b => {
    const scenes = getScenesByBookId(b.id).sort((a, b) => a.order_index - b.order_index);
    return {
      id: b.id,
      slug: b.slug,
      title: b.title,
      subtitle: b.subtitle,
      description: b.description,
      mode: 'world' as const,
      visibility: 'public' as const,
      ownerId: null as string | null,
      coverImage: scenes[0]?.background_asset_url || '',
    };
  });

  const generatedAsBook = generated.map(b => {
    // Defensive: Redis-deserialized books may have missing or
    // non-array scenes. Treat as empty so the listing never crashes.
    const scenes = Array.isArray(b.scenes) ? b.scenes : [];
    const firstScene = [...scenes].sort((a, b) => a.order_index - b.order_index)[0];
    const coverImage =
      firstScene?.beats?.[0]?.imageUrl
      || firstScene?.background_asset_url
      || '';
    return {
      id: b.id,
      slug: b.slug,
      title: b.title,
      subtitle: b.subtitle,
      description: b.description,
      mode: b.mode ?? 'world',
      visibility: b.visibility ?? 'public',
      ownerId: b.ownerId ?? null,
      coverImage,
    };
  });

  return NextResponse.json({ books: [...seedAsBook, ...generatedAsBook] });
}
