// ============================================================
// lib/auth/adminAllowlist.ts
//
// Single source of truth for "should this user bypass the
// production safety gates" (free-era quota, rate limits, prompt
// moderation). The owner of the deployment is allowlisted by
// default so they can test the live product without burning their
// own free quota or tripping over their own moderation rules.
//
// Additional admins can be added at deploy time via the
// KATHA_ADMIN_EMAILS env var (comma-separated, lowercased on
// lookup). Empty or unset means "only the default owner".
//
// Universal — used by anything that gates a user request.
// Returns false on null/missing email so non-authenticated callers
// can never be admin.
// ============================================================
import type { AuthSession } from './session';

const DEFAULT_ADMIN_EMAILS = ['reetu004@gmail.com'];

let cached: Set<string> | null = null;

function adminSet(): Set<string> {
  if (cached) return cached;
  const fromEnv = (process.env.KATHA_ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  cached = new Set<string>([...DEFAULT_ADMIN_EMAILS.map(e => e.toLowerCase()), ...fromEnv]);
  return cached;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminSet().has(email.trim().toLowerCase());
}

export function isAdminSession(session: AuthSession | null): boolean {
  return !!session && isAdminEmail(session.email);
}
