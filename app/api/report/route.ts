// POST /api/report
//
// Anyone can report a book or scene. Writes a row into
// public.content_reports for the operator to triage. Inserts use
// the service-role client because the public anon role can't INSERT
// without an RLS policy that we didn't grant (we want operator-only
// reads but write-only inserts from anyone; using service role for
// the write is simpler than weaving a policy that exposes nothing
// useful).
//
// Rate-limited at the 'expensive' scope so a single attacker can't
// flood the queue.

import { NextResponse } from 'next/server';
import { getSupabaseService } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { captureMessage } from '@/lib/observability/sentry';

interface ReportBody {
  bookSlug: string;
  sceneId?: string;
  reason: 'inappropriate' | 'inaccurate' | 'copyright' | 'other';
  notes?: string;
}

const VALID_REASONS = new Set<ReportBody['reason']>(['inappropriate', 'inaccurate', 'copyright', 'other']);

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  let body: ReportBody;
  try {
    body = (await request.json()) as ReportBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.bookSlug || !body.reason || !VALID_REASONS.has(body.reason)) {
    return NextResponse.json({ error: 'bookSlug and a valid reason are required' }, { status: 400 });
  }

  const supabase = getSupabaseService();
  if (!supabase) {
    return NextResponse.json({ error: 'Reporting is not configured' }, { status: 503 });
  }

  const session = await getSessionFromRouteRequest(request);
  const ownerId = getOwnerIdFromRequest(request);

  const { error } = await supabase.from('content_reports').insert({
    book_slug: body.bookSlug,
    scene_id: body.sceneId ?? null,
    reporter_user_id: session?.userId ?? null,
    reporter_owner_id: session ? null : ownerId, // dedupe — store one
    reason: body.reason,
    notes: (body.notes ?? '').slice(0, 2000),
  });

  if (error) {
    captureMessage('content_report_insert_failed', 'warning', {
      extra: { error: error.message, slug: body.bookSlug },
    });
    return NextResponse.json({ error: 'Could not record the report. Please email hello@kathakitaab.ai.' }, { status: 500 });
  }

  // Operator-side breadcrumb in Sentry so a triage spike is visible
  // even before the dashboard is built.
  captureMessage(`content_reported: ${body.bookSlug} (${body.reason})`, 'info', {
    tags: { kind: 'content_report' },
    extra: { slug: body.bookSlug, scene: body.sceneId, reason: body.reason },
  });

  return NextResponse.json({ ok: true });
}
