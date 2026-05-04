// ============================================================
// KathaKitaab.ai — Supabase Clients
//
// Two clients exposed:
//   - getSupabaseAnon():    safe for browser/server reads, scoped
//                           by RLS, uses NEXT_PUBLIC_SUPABASE_ANON_KEY
//   - getSupabaseService(): server-only, bypasses RLS, uses
//                           SUPABASE_SERVICE_ROLE_KEY. Never import
//                           this into a "use client" file.
//
// Both return null when env vars are missing so callers can fall
// back gracefully rather than crashing the build.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let anonClient: SupabaseClient | null | undefined;
let serviceClient: SupabaseClient | null | undefined;

export function getSupabaseAnon(): SupabaseClient | null {
  if (anonClient !== undefined) return anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    anonClient = null;
    return null;
  }
  anonClient = createClient(url, key, { auth: { persistSession: false } });
  return anonClient;
}

export function getSupabaseService(): SupabaseClient | null {
  if (serviceClient !== undefined) return serviceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    serviceClient = null;
    return null;
  }
  serviceClient = createClient(url, key, { auth: { persistSession: false } });
  return serviceClient;
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseAnon() !== null;
}
