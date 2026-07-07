// ============================================================
// lib/auth/adminAllowlist.ts
//
// Single source of truth for "should this caller bypass the
// production safety gates" (free-era quota, rate limits, prompt
// moderation). The owner of the deployment is allowlisted by
// default so they can test the live product without burning their
// own free quota or tripping over their own moderation rules.
//
// Anonymous-only mode: identity is the katha:owner cookie. Admin
// access is granted by listing an owner id in the
// KATHA_ADMIN_OWNER_IDS env var (comma-separated). Empty/unset
// means "no admin access" — default-deny. Add your owner id by
// reading it from the /admin page (which prints it once you have a
// cookie) and pasting it into the env var.
//
// Universal — used by anything that gates a user request. Returns
// false on null/missing owner id so non-cookie callers can never
// be admin.
// ============================================================
import type { AuthSession } from './session';

let cachedOwners: Set<string> | null = null;
let cachedEmails: Set<string> | null = null;

function ownerSet(): Set<string> {
  if (cachedOwners) return cachedOwners;
  const fromEnv = (process.env.KATHA_ADMIN_OWNER_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (fromEnv.length === 0 && process.env.NODE_ENV === 'production') {
    console.warn('[adminAllowlist] KATHA_ADMIN_OWNER_IDS is not set. No admin access.');
  }
  cachedOwners = new Set<string>(fromEnv);
  return cachedOwners;
}

function emailSet(): Set<string> {
  if (cachedEmails) return cachedEmails;
  // Kept for backward compat with any caller that still keys off
  // email; in anonymous-only mode email is always null, so this
  // set is only populated when an operator leaves the env var set.
  const fromEnv = (process.env.KATHA_ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  cachedEmails = new Set<string>(fromEnv);
  return cachedEmails;
}

/** True when the owner id is on the KATHA_ADMIN_OWNER_IDS allowlist. */
export function isAdminOwner(ownerId: string | null | undefined): boolean {
  if (!ownerId) return false;
  return ownerSet().has(ownerId.trim());
}

/** True when the email is on the KATHA_ADMIN_EMAILS allowlist.
 *  Retained for compat — always false in anonymous-only mode. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return emailSet().has(email.trim().toLowerCase());
}

/** Admin gate for an AuthSession. Reads the owner id (session.userId)
 *  against KATHA_ADMIN_OWNER_IDS.
 *
 *  During local development ONLY, an explicit env var can grant admin
 *  privileges to unauthenticated requests so the owner can seed books
 *  without a cookie. NEVER enable KATHA_DEV_ADMIN_BYPASS in production,
 *  preview, or staging — it would let any visitor bypass quotas and
 *  moderation. */
export function isAdminSession(session: AuthSession | null): boolean {
  if (!session) {
    return process.env.KATHA_DEV_ADMIN_BYPASS === 'true' && process.env.NODE_ENV === 'development';
  }
  return isAdminOwner(session.userId);
}