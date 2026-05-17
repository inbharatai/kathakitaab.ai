import { NextResponse } from 'next/server';
import { getSceneWithHotspots } from '@/lib/data/ramayanaSeed';
import { getBook } from '@/lib/data/bookRegistry';
import { getScene, updateScene, markSceneStale } from '@/lib/data/sceneRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import type { GeneratedScene } from '@/lib/openai/bookGeneratorAgent';

export async function GET(
  request: Request,
  { params }: { params: Promise<unknown> }
) {
  const { slug, sceneId } = await params as { slug: string; sceneId: string };

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

/** PATCH a scene's content. Ownership is required. When media-relevant
 *  fields (narration, visual description, mood, etc.) change, the scene
 *  is marked stale so downstream image / audio regeneration can resume. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<unknown> }
) {
  const { slug, sceneId } = await params as { slug: string; sceneId: string };

  // Authorize via parent book
  const book = await getBook(slug);
  if (!book) {
    return NextResponse.json({ error: `Book not found: ${slug}` }, { status: 404 });
  }
  const ownerId = getOwnerIdFromRequest(request);
  const session = await getSessionFromRouteRequest(request);
  const isAdmin = isAdminSession(session);
  const callerId = session?.userId ?? ownerId;
  const isOwner = book.ownerId ? book.ownerId === callerId : false;
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
  }

  let body: Partial<GeneratedScene>;
  try {
    body = (await request.json()) as Partial<GeneratedScene>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const existing = await getScene(slug, sceneId);
  if (!existing) {
    return NextResponse.json({ error: `Scene not found: ${sceneId}` }, { status: 404 });
  }

  const updated = await updateScene(slug, sceneId, body);
  if (!updated) {
    return NextResponse.json({ error: 'Failed to update scene' }, { status: 500 });
  }

  // Mark stale if media-relevant fields changed so images / TTS re-gen.
  const mediaFields = [
    'narration',
    'visual_description',
    'mood',
    'theme',
    'motion',
    'characters_present',
    'characters_absent',
    'beats',
  ];
  const shouldStale = mediaFields.some(f => f in body);
  if (shouldStale) {
    const stale = await markSceneStale(slug, sceneId);
    if (stale) {
      return NextResponse.json({ scene: stale });
    }
  }

  return NextResponse.json({ scene: updated });
}
