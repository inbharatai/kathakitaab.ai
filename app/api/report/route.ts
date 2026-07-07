// POST /api/report
//
// Anyone can report a book or scene. Writes a row into the Aurora
// content_reports table for the operator to triage. Inserts use the
// pooled pg client (service-role; no RLS in anonymous-only mode).
//
// Rate-limited at the 'expensive' scope so a single attacker can't
// flood the queue.

import { NextResponse } from 'next/server';
import { auroraQuery, isAuroraEnabled } from '@/lib/db/aurora';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
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

  if (!isAuroraEnabled()) {
    return NextResponse.json({ error: 'Reporting is not configured' }, { status: 503 });
  }

  const ownerId = getOwnerIdFromRequest(request);

  const result = await auroraQuery(
    `INSERT INTO content_reports (book_slug, scene_id, reporter_owner_id, reason, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      body.bookSlug,
      body.sceneId ?? null,
      ownerId,
      body.reason,
      (body.notes ?? '').slice(0, 2000),
    ],
  );

  if (!result) {
    captureMessage('content_report_insert_failed', 'warning', {
      extra: { slug: body.bookSlug },
    });
    return NextResponse.json({ error: 'Could not record the report. Please email hello@kathakitaab.com.' }, { status: 500 });
  }

  // Operator-side breadcrumb in Sentry so a triage spike is visible
  // even before the dashboard is built.
  captureMessage(`content_reported: ${body.bookSlug} (${body.reason})`, 'info', {
    tags: { kind: 'content_report' },
    extra: { slug: body.bookSlug, scene: body.sceneId, reason: body.reason },
  });

  return NextResponse.json({ ok: true });
}