import { NextResponse } from 'next/server';
import { getBook as getRegistryBook, saveGeneratedBook } from '@/lib/data/bookRegistry';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { hydrateBookAudio } from '@/lib/video/manifestSynthesizer';

/** Admin-only force audio hydration for a single book.
 *
 *  POST /api/admin/books/[slug]/hydrate
 *  Returns 403 for non-admin users.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getSessionFromRouteRequest(request);
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { slug } = await params;
  const book = await getRegistryBook(slug);
  if (!book) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  try {
    const hydrated = await hydrateBookAudio(book);
    await saveGeneratedBook(hydrated);
    return NextResponse.json({ ok: true, scenesHydrated: hydrated.scenes.filter(s => s.narration_audio_url).length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Hydration failed: ${message}` }, { status: 500 });
  }
}
