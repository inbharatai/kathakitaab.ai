// ============================================================
// lib/observability/sentry.ts
//
// Lightweight Sentry capture. POSTs straight to Sentry's envelope
// endpoint when SENTRY_DSN is set; no-op when it isn't. Lets us
// surface real errors in production without pulling in the full
// @sentry/nextjs SDK weight.
//
// Set SENTRY_DSN in env to enable. Get one from sentry.io → Project
// → Settings → Client Keys. Format:
//   https://<key>@<host>/<project_id>
//
// Trade-offs vs the full SDK:
//   - No source-mapped stack traces unless source maps are uploaded
//     separately. Good enough for triage.
//   - No automatic breadcrumbs. We'd add them by hand if needed.
//   - No transaction / performance traces. Acceptable at this scale.
//   - Tiny code surface — works from edge runtime too.
// ============================================================

interface SentryEvent {
  message?: string;
  level: 'fatal' | 'error' | 'warning' | 'info';
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  exception?: { values: Array<{ type: string; value: string; stacktrace?: { frames: unknown[] } }> };
}

interface DsnParts {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
}

let cached: DsnParts | null | undefined;

function parseDsn(): DsnParts | null {
  if (cached !== undefined) return cached;
  const raw = process.env.SENTRY_DSN;
  if (!raw) { cached = null; return null; }
  try {
    const u = new URL(raw);
    // Sentry DSN shape: https://{publicKey}@{host}/{projectId}
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projectId) { cached = null; return null; }
    cached = { protocol: u.protocol.replace(':', ''), publicKey: u.username, host: u.host, projectId };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function isSentryEnabled(): boolean {
  return !!parseDsn();
}

/**
 * Fire-and-forget exception capture. Never throws. Safe to call
 * from anywhere (Node, Edge, route handlers, scripts).
 */
export function captureException(
  err: unknown,
  context: { tags?: Record<string, string>; extra?: Record<string, unknown> } = {},
): void {
  const dsn = parseDsn();
  if (!dsn) return;
  const ev = buildEventFromError(err, context);
  void postEnvelope(dsn, ev).catch(() => {});
}

export function captureMessage(
  message: string,
  level: SentryEvent['level'] = 'info',
  context: { tags?: Record<string, string>; extra?: Record<string, unknown> } = {},
): void {
  const dsn = parseDsn();
  if (!dsn) return;
  void postEnvelope(dsn, {
    message,
    level,
    tags: context.tags,
    extra: context.extra,
  }).catch(() => {});
}

// ── internals ──

function buildEventFromError(
  err: unknown,
  context: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): SentryEvent {
  if (err instanceof Error) {
    return {
      level: 'error',
      tags: context.tags,
      extra: context.extra,
      exception: {
        values: [{
          type: err.name || 'Error',
          value: err.message,
          stacktrace: err.stack ? { frames: parseStack(err.stack) } : undefined,
        }],
      },
    };
  }
  return {
    level: 'error',
    message: typeof err === 'string' ? err : JSON.stringify(err).slice(0, 1000),
    tags: context.tags,
    extra: context.extra,
  };
}

function parseStack(stack: string): unknown[] {
  // Minimal frame parser — Sentry's envelope accepts this shape.
  const frames: unknown[] = [];
  for (const line of stack.split('\n').slice(1)) {
    const m = line.match(/\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
    if (m) {
      frames.push({
        function: m[1],
        filename: m[2],
        lineno: Number(m[3]),
        colno: Number(m[4]),
      });
    }
  }
  return frames.reverse(); // Sentry expects oldest-first
}

async function postEnvelope(dsn: DsnParts, event: SentryEvent): Promise<void> {
  const eventId = randomHex(32);
  const url = `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=7`;
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' });
  const itemBody = JSON.stringify({
    event_id: eventId,
    platform: 'javascript',
    timestamp: Math.floor(Date.now() / 1000),
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
    ...event,
  });
  const body = `${header}\n${itemHeader}\n${itemBody}`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body,
  });
}

function randomHex(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
