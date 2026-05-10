import { NextResponse } from 'next/server';
import { getSceneWithHotspots } from '@/lib/data/ramayanaSeed';
import { getScene, getBook } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; sceneId: string }> }
) {
  const { slug, sceneId } = await params;

  // 1. Try the Ramayana seed (built-in). Always public.
  if (slug === 'ramayana') {
    const scene = getSceneWithHotspots(sceneId);
    if (scene) return NextResponse.json({ scene });
  }

  // 2. Authorize against the parent book's visibility BEFORE returning
  //    a scene. Without this, a private book's scenes were enumerable
  //    even though the book listing hides them. The cookie owner
  //    check matches /api/books/[slug] semantics.
  const book = await getBook(slug);
  if (book && book.visibility === 'private') {
    const ownerId = getOwnerIdFromRequest(request);
    if (!ownerId || book.ownerId !== ownerId) {
      // 404 instead of 403 — don't disclose the slug exists.
      return NextResponse.json({ error: `Scene not found: ${sceneId} in book ${slug}` }, { status: 404 });
    }
  }

  const scene = await getScene(slug, sceneId);
  if (scene) return NextResponse.json({ scene });

  return NextResponse.json({ error: `Scene not found: ${sceneId} in book ${slug}` }, { status: 404 });
}
