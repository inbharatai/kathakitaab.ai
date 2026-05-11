// ============================================================
// Supabase OAuth + magic-link callback.
//
// Supabase redirects here after the user authenticates with an
// external provider (Google) or clicks an email magic link. We
// exchange the `code` query param for a real session — the SSR
// helpers stash the access + refresh tokens into cookies the rest
// of the app can read.
//
// After exchange we redirect to `next` (defaulting to /books) so
// the user lands on whatever they were trying to do before sign-in.
// ============================================================

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerAuthClient } from '@/lib/auth/supabaseAuthClient';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { claimAnonymousBooks } from '@/lib/auth/claimBooks';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = sanitizeNext(url.searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(new URL('/signin?error=missing_code', url.origin));
  }

  const jar = await cookies();
  const client = createServerAuthClient({
    getAll: () => jar.getAll().map(c => ({ name: c.name, value: c.value })),
    setAll: (cookieList) => {
      for (const { name, value, options } of cookieList) {
        try {
          jar.set({ name, value, ...options });
        } catch {
          // Ignored — see callers in lib/auth/session.ts for why
        }
      }
    },
  });

  if (!client) {
    return NextResponse.redirect(new URL('/signin?error=auth_not_configured', url.origin));
  }

  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/signin?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // Claim any books the user generated anonymously before signing in.
  // Their `katha:owner` cookie is the proof — books owned by that
  // cookie's UUID get re-owned under the new userId. Failures here
  // shouldn't block sign-in; surface a warning and continue.
  const legacyOwnerId = getOwnerIdFromRequest(request);
  if (legacyOwnerId && data.user?.id) {
    try {
      await claimAnonymousBooks(legacyOwnerId, data.user.id);
    } catch (err) {
      console.warn('[auth/callback] book claim failed:',
        err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

/** Don't redirect to absolute URLs — only same-origin paths. Prevents
 *  open-redirect through the `next` param. */
function sanitizeNext(raw: string | null): string {
  if (!raw) return '/books';
  if (!raw.startsWith('/')) return '/books';
  if (raw.startsWith('//')) return '/books';
  return raw;
}
