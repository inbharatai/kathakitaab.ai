// ============================================================
// KathaKitaab.ai — Supabase Auth clients (browser + server)
//
// Cookie-backed Supabase auth. The session lives in cookies (set by
// the SSR helpers) so server components and API routes see the same
// auth state the browser does — no JWT-passing fiddle, no localStorage
// drift between tabs.
//
// Three clients to use depending on context:
//   - createBrowserAuthClient(): client components, useEffect, etc.
//   - createServerAuthClient(): Server Components (RSC) — read-only
//   - createRouteAuthClient(): Route handlers + Server Actions — can write cookies
//
// All three resolve to null when Supabase env vars are missing so the
// app keeps running anonymously during dev / preview without auth.
// ============================================================

import {
  createBrowserClient,
  createServerClient,
  type CookieMethodsServer,
} from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

function env() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function isSupabaseAuthConfigured(): boolean {
  const { url, key } = env();
  return !!(url && key);
}

/** Browser-side Supabase client. Persists session in cookies via
 *  @supabase/ssr's setAll/getAll, so server components see the same
 *  user the browser does. Safe to call from "use client" files. */
export function createBrowserAuthClient(): SupabaseClient | null {
  const { url, key } = env();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

/** Server-side client with cookie methods supplied by the caller.
 *  Used inside Route Handlers + Server Actions where Next.js gives
 *  us a mutable cookies() object. For Server Components see
 *  createServerAuthClientReadOnly() — RSC can read cookies but not
 *  write them, which @supabase/ssr handles by silently dropping
 *  writes (the next route handler will re-issue). */
export function createServerAuthClient(cookies: CookieMethodsServer): SupabaseClient | null {
  const { url, key } = env();
  if (!url || !key) return null;
  return createServerClient(url, key, { cookies });
}
