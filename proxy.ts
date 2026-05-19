// ============================================================
// proxy.ts — issues the anonymous owner cookie
//
// Every visitor gets a stable `katha:owner` UUID cookie. The
// cookie is the sole authorization principal for private books
// (personalized / classroom) until real auth ships. Public Ramayana
// and other world books don't need it — they read without checking.
//
// Notes on choices:
//   • SameSite=Lax — allows top-level navigations (a parent
//     bookmarking their child's story page works), blocks cross-
//     origin POSTs (CSRF defense).
//   • HttpOnly is INTENTIONALLY OFF. We never read this cookie
//     from JavaScript today, but a future "show me my private
//     books" client widget needs JS access. Toggling later is a
//     one-line change.
//   • Secure in production only — local http://localhost would
//     drop a Secure cookie.
//   • 180-day expiry — long enough to survive school holidays,
//     short enough that a long-abandoned cookie eventually
//     forgets ownership of stale stories.
//   • Skips Next.js internals + static assets so the matcher
//     doesn't churn on every PNG request.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { OWNER_COOKIE, isValidOwnerId, newOwnerId } from '@/lib/auth/ownerId';

const COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function proxy(request: NextRequest) {
  const existing = request.cookies.get(OWNER_COOKIE)?.value;
  // Idempotent: never overwrite a valid existing cookie. A user who
  // returns after months keeps their owner ID — and therefore keeps
  // ownership of their old private books.
  if (existing && isValidOwnerId(existing)) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set({
    name: OWNER_COOKIE,
    value: newOwnerId(),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

// Matcher: every page + every API route, but skip Next.js internals
// and static assets. The Next docs recommend exactly this shape.
export const config = {
  matcher: [
    // Match everything except _next/static, _next/image, favicon,
    // and known asset extensions. The negative lookahead keeps the
    // hot path cheap.
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|webp|gif|svg|ico|mp4|wav|mp3|webm|woff2?)$).*)',
  ],
};
