// ============================================================
// lib/observability/analytics.ts
//
// Lightweight PostHog-compatible event tracking. POSTs to the
// PostHog /capture endpoint when NEXT_PUBLIC_POSTHOG_KEY is set;
// no-op otherwise. Same idea as the Sentry wrapper — minimal
// dependency, environment-flagged, swap for the full SDK later
// if you want session replay / autocapture.
//
// Env vars:
//   NEXT_PUBLIC_POSTHOG_KEY   project API key (safe to expose)
//   NEXT_PUBLIC_POSTHOG_HOST  defaults to https://app.posthog.com
//
// The public key + host are exposed via NEXT_PUBLIC_* so this file
// works from both client and server contexts. PostHog's capture
// endpoint doesn't accept a server-only secret today.
// ============================================================

interface AnalyticsEvent {
  /** What happened — e.g. 'book_generated', 'movie_watched'. */
  event: string;
  /** Distinct identifier for the user. Pass userId when signed in,
   *  ownerId when anonymous. PostHog stitches anon→identified on
   *  the same distinct_id with $identify, which we leave to the
   *  client if/when we wire it. */
  distinctId: string;
  /** Bag of properties — keep keys snake_case for PostHog's UI. */
  properties?: Record<string, unknown>;
}

let cached: { key: string; host: string } | null | undefined;

function config() {
  if (cached !== undefined) return cached;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) { cached = null; return null; }
  cached = {
    key,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
  };
  return cached;
}

export function isAnalyticsEnabled(): boolean {
  return !!config();
}

/**
 * Fire-and-forget event capture. Never throws. Use from anywhere.
 * Returns a promise so callers that want to await (e.g. server
 * routes serializing analytics with the response) can — but the
 * normal pattern is `void capture(...)`.
 */
export async function capture(ev: AnalyticsEvent): Promise<void> {
  const c = config();
  if (!c) return;
  try {
    await fetch(`${c.host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: c.key,
        event: ev.event,
        distinct_id: ev.distinctId,
        properties: ev.properties ?? {},
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Analytics is observability — never let it bring the app down.
  }
}
