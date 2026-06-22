// ============================================================
// /api/aurora/status — PUBLIC judge-facing Aurora proof endpoint
//
// Returns whether the Aurora durable layer is enabled, the Postgres
// engine version (proves a real live connection), and aggregate row
// counts per table (proves real data is being written). No secrets,
// no private story content, no PII — just enough for H0 judges to
// verify the AWS Aurora integration is genuine and in use.
//
// Cache-Control: no-store so judges always see live numbers.
// ============================================================

import { NextResponse } from 'next/server';
import { isAuroraEnabled, auroraQuery, sanitizeErr } from '@/lib/db/aurora';
import { getAuroraStats } from '@/lib/storage/storyStore';

export async function GET() {
  const enabled = isAuroraEnabled();

  if (!enabled) {
    return NextResponse.json(
      { aurora: { enabled: false, note: 'USE_AURORA=false or DATABASE_URL unset — running on Upstash-only legacy mode.' } },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  // Prove a real live connection by reading the engine version.
  const ver = await auroraQuery<{ version: string }>('SELECT version()');
  const stats = await getAuroraStats();

  return NextResponse.json({
    aurora: {
      enabled: true,
      engine: ver?.rows[0]?.version ?? null,
      engineError: ver ? null : sanitizeErr('connection returned no rows'),
      tables: stats.counts,
      durableRole: 'story_projects, story_scenes, characters, generated_assets, generation_jobs, audit_events',
      legacyRole: 'Upstash Redis — legacy reads, cache, progress, locks, rate limits (untouched)',
      readOrder: 'Aurora-first → Upstash Redis fallback',
    },
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}