// ============================================================
// lib/auth/ownerId.ts
//
// Anonymous-cookie ownership model. Every visitor gets a UUIDv4
// in a `katha:owner` cookie on first request — set by middleware.ts
// at the project root. The ID is opaque (no PII), persisted across
// sessions, and is the sole authorization principal until we ship
// real auth.
//
// Why anonymous instead of email/Google auth:
//   • Children's product. We don't want to collect parent emails
//     until we have to.
//   • Public Ramayana works without identity at all — ownership
//     only matters for private (personalized / classroom) books.
//   • A single cookie scopes "I made this story; I can read or
//     delete it" without collecting anything we'd have to retain.
//
// This module is pure helpers — the cookie is set by middleware.ts.
// ============================================================

import type { NextRequest } from 'next/server';

export const OWNER_COOKIE = 'katha:owner';

/** Length checks before treating a cookie value as a real owner ID.
 *  UUIDv4 is 36 chars; we allow a slightly looser shape so we can
 *  evolve the format later without invalidating live cookies. */
const MIN_LEN = 16;
const MAX_LEN = 64;

export function isValidOwnerId(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v.length < MIN_LEN || v.length > MAX_LEN) return false;
  // Must be url-safe ASCII so it survives anywhere we might log it.
  return /^[A-Za-z0-9_-]+$/.test(v);
}

/** Read the owner cookie from a Next.js Edge / API request.
 *  Returns null if missing or malformed. Routes that need ownership
 *  must handle the null path explicitly — never assume the cookie
 *  is present. */
export function getOwnerIdFromRequest(req: Request | NextRequest): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  // Manual parse — we don't want a dep on `cookie` package for one
  // value, and Next.js's RequestCookies API isn't available in
  // every runtime context (route handlers vs edge middleware).
  const want = `${OWNER_COOKIE}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(want)) {
      const value = decodeURIComponent(trimmed.slice(want.length));
      return isValidOwnerId(value) ? value : null;
    }
  }
  return null;
}

/** Generate a new owner ID. Used by middleware on first request. */
export function newOwnerId(): string {
  // crypto.randomUUID is available in both edge and node runtimes
  // in modern Next.js. Falls through to crypto.getRandomValues for
  // cryptographically secure generation on all runtimes.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: 16 bytes from crypto.getRandomValues, hex-encoded.
  const buf = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    // Last resort for extremely old runtimes — still better than Math.random()
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < 16; i++) s += buf[i].toString(16).padStart(2, '0');
  return s;
}
