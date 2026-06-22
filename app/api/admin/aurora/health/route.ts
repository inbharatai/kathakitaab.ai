// ============================================================
// /api/admin/aurora/health — admin-gated Aurora connectivity check
//
// Deeper than the public /api/aurora/status: confirms the pool can
// round-trip a query, returns the configured pool max + SSL mode,
// and the most recent audit_events so the owner can see writes are
// landing. 403 for non-admin callers.
// ============================================================

import { NextResponse } from 'next/server';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { isAuroraEnabled, auroraQuery, sanitizeErr } from '@/lib/db/aurora';
import { getAuroraStats } from '@/lib/storage/storyStore';

export async function GET(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  if (!isAdminSession(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const enabled = isAuroraEnabled();
  const ping = enabled
    ? await auroraQuery<{ ok: number }>('SELECT 1 AS ok')
    : null;
  const stats = await getAuroraStats();
  const recent = await auroraQuery<{ entity_type: string; entity_id: string; event_type: string; created_at: string }>(
    `SELECT entity_type, entity_id, event_type, created_at
     FROM audit_events ORDER BY created_at DESC LIMIT 10`,
  );

  return NextResponse.json({
    enabled,
    reachable: !!(ping && ping.rowCount > 0),
    poolMax: Number(process.env.AURORA_POOL_MAX) || 3,
    ssl: process.env.AURORA_SSL ?? 'require',
    counts: stats.counts,
    recentAudit: recent?.rows ?? [],
    error: ping ? null : sanitizeErr('ping failed or aurora disabled'),
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}