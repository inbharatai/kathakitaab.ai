// ============================================================
// KathaKitaab — Click Classification API
// POST /api/livebook/classify-click
//
// Classifies what the user clicked on in a scene image.
// Used by the click-anywhere system when no hotspot exists.
// ============================================================

import { NextResponse } from 'next/server';
import { classifyImageClick } from '@/lib/engine/clickClassifier';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { canReadBook } from '@/lib/auth/bookAccess';
import { getBook } from '@/lib/data/bookRegistry';
import { isSafeUrl } from '@/lib/safety/urlValidation';

interface ClassifyRequest {
  sceneTitle: string;
  sceneNarration: string;
  characters: string[];
  imageUrl: string | null;
  xPercent: number;
  yPercent: number;
  /** Book slug for auth + visibility gating. Optional for back-compat. */
  bookSlug?: string;
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    const body: ClassifyRequest = await request.json();

    // SSRF guard: block private IPs and non-HTTP(S) URLs.
    const session = await getSessionFromRouteRequest(request);
    if (body.imageUrl && !isSafeUrl(body.imageUrl)) {
      return NextResponse.json({ error: 'Invalid imageUrl' }, { status: 400 });
    }

    // Visibility check for AI-generated books.
    if (body.bookSlug) {
      const book = await getBook(body.bookSlug);
      if (book) {
        const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
        const isAdmin = isAdminSession(session);
        if (!isAdmin && !canReadBook(book, ownerId)) {
          return NextResponse.json({ error: 'Book not found' }, { status: 404 });
        }
      }
    }

    const result = await classifyImageClick(
      body.sceneTitle,
      body.sceneNarration,
      body.characters,
      body.imageUrl,
      body.xPercent,
      body.yPercent,
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Classification failed';
    return NextResponse.json({ meaningful: false, entityType: 'unknown', label: 'Unknown', confidence: 0, reason: msg, suggestedAction: 'ignore' });
  }
}
