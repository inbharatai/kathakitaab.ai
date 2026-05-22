// ============================================================
// KathaKitaab — Server-side session helpers
//
// One entry point each for the two server contexts:
//   - getSessionFromRouteRequest(): inside Route Handlers (req: Request)
//   - getSessionFromCookies(): inside Server Components / Server Actions
//
// Both return a normalized AuthSession or null. Null means "anonymous"
// — pair with getOwnerIdFromRequest() to fall back to the legacy
// anonymous-cookie ownership model. Authenticated users carry both
// the legacy cookie AND the auth session; once they sign in, server
// routes should prefer userId over ownerId.
// ============================================================

import { cookies as nextCookies } from 'next/headers';
import { createServerAuthClient } from './supabaseAuthClient';

export interface AuthSession {
  /** Supabase user id (UUID). Stable across email changes / re-sign-ins. */
  userId: string;
  /** Authenticated email if available (Google sign-ins always have one). */
  email: string | null;
  /** Display name from the OAuth provider. Falls back to local-part. */
  displayName: string | null;
  /** Whether the user has been admitted under the first-100-users
   *  free era. Stored in the public.users row, surfaced here so the
   *  rate-limit / generation gate doesn't need a second DB hit. */
  isFreeEraMember: boolean;
  /** Optional future flag for paid users — kept here so callers can
   *  light up Pro features without another lookup. Always false today
   *  (Razorpay deferred). */
  isPro: boolean;
}

/** Read the session from inside a Route Handler. Pass `req` so we
 *  can hand a cookies-compatible adapter to @supabase/ssr without
 *  pulling in next/headers (which only works in server scopes). */
export async function getSessionFromRouteRequest(req: Request): Promise<AuthSession | null> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const all = parseCookies(cookieHeader);
  const client = createServerAuthClient({
    getAll: () => all.map(([name, value]) => ({ name, value })),
    // Route handlers can write cookies via the Response, but
    // @supabase/ssr only needs `setAll` for refresh flows we don't
    // exercise from inside a GET. Drop writes silently — the browser
    // already has the canonical session in its cookies.
    setAll: () => {},
  });
  if (!client) return null;
  return resolveSession(client);
}

/** Read the session inside a Server Component or Server Action.
 *  Uses next/headers cookies(). */
export async function getSessionFromCookies(): Promise<AuthSession | null> {
  const jar = await nextCookies();
  const client = createServerAuthClient({
    getAll: () => jar.getAll().map(c => ({ name: c.name, value: c.value })),
    setAll: (cookies) => {
      for (const { name, value, options } of cookies) {
        try {
          jar.set({ name, value, ...options });
        } catch {
          // RSC throws on cookie writes; ignore — middleware refreshes
          // the session on the next request.
        }
      }
    },
  });
  if (!client) return null;
  return resolveSession(client);
}

async function resolveSession(client: NonNullable<ReturnType<typeof createServerAuthClient>>): Promise<AuthSession | null> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  // Surface flags from the public.users row when available — the
  // shape is fully owned by us in Supabase, so no schema risk.
  const meta = await client
    .from('users')
    .select('is_free_era, is_pro, display_name')
    .eq('id', u.id)
    .maybeSingle();
  const row = meta.data as { is_free_era?: boolean; is_pro?: boolean; display_name?: string } | null;
  const fallbackName = u.user_metadata?.full_name as string | undefined
    ?? (u.email ? u.email.split('@')[0] : null);
  return {
    userId: u.id,
    email: u.email ?? null,
    displayName: row?.display_name ?? fallbackName ?? null,
    isFreeEraMember: row?.is_free_era ?? false,
    isPro: row?.is_pro ?? false,
  };
}

function parseCookies(header: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    try {
      out.push([trimmed.slice(0, eq), decodeURIComponent(trimmed.slice(eq + 1))]);
    } catch {
      // Malformed percent-encoding — skip this cookie silently.
    }
  }
  return out;
}
