import { NextResponse } from 'next/server';
import { getSceneWithHotspots } from '@/lib/data/ramayanaSeed';
import { getBook, getScene as getSceneFromBook } from '@/lib/data/bookRegistry';
import { getScene, updateScene, markSceneStale } from '@/lib/data/sceneRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { resolveBookVisibility } from '@/lib/auth/bookAccess';
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
  //    Use the book's ACTUAL stored slug for scene lookup — when the
  //    URL uses a bare slug (e.g. "mahabharata") but the book was
  //    saved with a preset suffix ("mahabharata-photoreal"), getBook()
  //    finds the fallback. Scene registry keys use the stored slug,
  //    so we must use book.slug, not the URL slug.
  const book = await getBook(slug);
  const sceneSlug = book?.slug ?? slug;
  if (book && resolveBookVisibility(book) === 'private') {
    const ownerId = getOwnerIdFromRequest(request);
    if (!ownerId || book.ownerId !== ownerId) {
      // 404 instead of 403 — don't disclose the slug exists.
      return NextResponse.json({ error: `Scene not found: ${sceneId} in book ${slug}` }, { status: 404 });
    }
  }

  const scene = await getScene(sceneSlug, sceneId);
  if (scene) return NextResponse.json({ scene }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });

  // Fallback: scene may exist in the assembled book JSON but was never
  // written to the per-scene registry (legacy resume/regenerate path).
  const bookScene = await getSceneFromBook(sceneSlug, sceneId);
  if (bookScene) return NextResponse.json({ scene: bookScene }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });

  return NextResponse.json({ error: `Scene not found: ${sceneId} in book ${slug}` }, { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

/** PATCH a scene's content. Ownership is required. When media-relevant
 *  fields (narration, visual description, mood, etc.) change, the scene
 *  is marked stale so downstream image / audio regeneration can resume. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<unknown> }
) {
  const { slug, sceneId } = await params as { slug: string; sceneId: string };

  // Authorize via parent book. Use book.slug for scene lookup so
  // preset-suffixed books work when the URL carries the bare slug.
  const book = await getBook(slug);
  if (!book) {
    return NextResponse.json({ error: `Book not found: ${slug}` }, { status: 404 });
  }
  const patchSceneSlug = book.slug ?? slug;
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

  const existing = await getScene(patchSceneSlug, sceneId);
  if (!existing) {
    return NextResponse.json({ error: `Scene not found: ${sceneId}` }, { status: 404 });
  }

  const updated = await updateScene(patchSceneSlug, sceneId, body);
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
    const stale = await markSceneStale(patchSceneSlug, sceneId);
    if (stale) {
      return NextResponse.json({ scene: stale });
    }
  }

  return NextResponse.json({ scene: updated });
}
