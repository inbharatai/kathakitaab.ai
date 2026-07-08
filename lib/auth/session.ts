// ============================================================
// KathaKitaab — Server-side session helpers (anonymous-only)
//
// Supabase auth is gone. The only identity is the anonymous
// `katha:owner` cookie set by proxy.ts (lib/auth/ownerId.ts).
// This module exposes the same two entry points the routes already
// call, but now they return an AuthSession derived from the owner
// cookie instead of a Supabase auth session:
//   - getSessionFromRouteRequest(): inside Route Handlers (req: Request)
//   - getSessionFromCookies(): inside Server Components / Server Actions
//
// `AuthSession.userId` is now the anonymous owner id (text). All
// existing route code that reads `session?.userId` keeps working
// unchanged — the value is still a stable per-user string, it just
// comes from the cookie instead of an OAuth provider. email,
// displayName, isPro, isFreeEraMember are null/false (no profile
// data is collected in anonymous-only mode).
// ============================================================

import { cookies as nextCookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getOwnerIdFromRequest, isValidOwnerId } from './ownerId';

export interface AuthSession {
  /** Anonymous owner id (text, from the katha:owner cookie).
   *  Stable across sessions; the sole authorization principal. */
  userId: string;
  /** Always null in anonymous-only mode. Kept on the type so callers
   *  that read it compile without changes. */
  email: string | null;
  /** Always null in anonymous-only mode. */
  displayName: string | null;
  /** Always false — surfaced from Aurora only when needed elsewhere. */
  isFreeEraMember: boolean;
  /** Always false today (Razorpay deferred). */
  isPro: boolean;
}

function sessionFromOwner(ownerId: string | null): AuthSession | null {
  if (!isValidOwnerId(ownerId)) return null;
  return {
    userId: ownerId,
    email: null,
    displayName: null,
    isFreeEraMember: false,
    isPro: false,
  };
}

/** Read the owner-derived session from inside a Route Handler. */
export async function getSessionFromRouteRequest(req: Request | NextRequest): Promise<AuthSession | null> {
  return sessionFromOwner(getOwnerIdFromRequest(req));
}

/** Read the owner-derived session inside a Server Component / Action. */
export async function getSessionFromCookies(): Promise<AuthSession | null> {
  const jar = await nextCookies();
  const raw = jar.get('katha:owner')?.value ?? null;
  return sessionFromOwner(raw);
}