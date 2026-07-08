// ============================================================
// lib/auth/freeEraGate.ts
//
// First-100-users gate + per-owner generation quota.
//
// Supabase auth is gone. The durable identity is the anonymous
// `owner_id` (text) set as the katha:owner cookie by proxy
// (lib/auth/ownerId.ts). Quota + free-era admission live in Aurora
// (db/aurora/migrations/0002_quota_and_reports.sql), keyed on
// owner_id text. No Redis, no Supabase.
//
// Rules:
//   1. To generate ANY book the caller must carry an owner cookie.
//   2. To be admitted into the free era, the owner's Aurora users
//      row must already carry is_free_era=true, OR they must win one
//      of the first FREE_ERA_CAP admission slots via the atomic
//      claim_free_era_seat() SQL function (race-safe).
//   3. Each free-era owner gets FREE_ERA_QUOTA_PER_USER lifetime book
//      generations. After that they're capped until paid tier launches.
//   4. Admin owner ids (KATHA_ADMIN_OWNER_IDS) bypass everything.
//
// When Aurora isn't configured (local dev), the gate returns
// `allowed` so development keeps working without infrastructure —
// same graceful-degradation the Supabase path used to offer.
// ============================================================

import { auroraQuery, isAuroraEnabled } from '@/lib/db/aurora';
import type { AuthSession } from './session';
import { isAdminSession } from './adminAllowlist';

const FREE_ERA_CAP = 100;
const FREE_ERA_QUOTA_PER_USER = 1;

export type GateDecision =
  | { allowed: true; seq: number; isFreshAdmission: boolean }
  | { allowed: false; reason: 'waitlist'; message: string }
  | { allowed: false; reason: 'quota_exhausted'; message: string }
  | { allowed: false; reason: 'misconfigured'; message: string };

interface OwnerQuotaRow {
  is_free_era: boolean | null;
  free_era_seq: number | null;
  is_pro: boolean | null;
  books_generated_lifetime: number | null;
}

/**
 * Check + reserve a generation slot for the given owner. Idempotent
 * in the sense that an owner already inside the free era just gets a
 * cheap "you're in" decision; the side-effect (seat claim + DB row
 * insert) only happens on FIRST admission.
 *
 * The seat reservation does NOT bump the lifetime counter — that's
 * done by a follow-up call to bookGenerationConsumed() once the
 * request actually starts a generation. That separation means a
 * pre-flight UI check ("can I press the button?") doesn't burn the
 * owner's one allowance.
 */
export async function checkFreeEraGate(session: AuthSession | null, ownerId?: string | null): Promise<GateDecision> {
  const oid = session?.userId ?? ownerId;
  if (!oid) {
    return {
      allowed: false,
      reason: 'misconfigured',
      message: 'Could not establish ownership. Please reload and try again.',
    };
  }

  // Admin allowlist — the deployment owner + any KATHA_ADMIN_OWNER_IDS
  // bypass the free-era cap and per-owner quota entirely so they can
  // exercise the live product end-to-end without burning their own
  // allowance. No DB lookup.
  if (isAdminSession(session)) {
    return { allowed: true, seq: -1, isFreshAdmission: false };
  }

  // Local dev / not configured → unlimited for convenience, same as
  // the old "no Redis" path. Production with Aurora disabled is
  // already a misconfiguration; surfacing it as allowed keeps the app
  // usable while the operator wires up the DB.
  if (!isAuroraEnabled()) {
    return { allowed: true, seq: -1, isFreshAdmission: false };
  }

  const { rows } = (await auroraQuery<OwnerQuotaRow>(
    `SELECT is_free_era, free_era_seq, is_pro, books_generated_lifetime
       FROM users
      WHERE owner_id = $1
      LIMIT 1`,
    [oid],
  )) ?? { rows: [], rowCount: 0 };

  const row = rows[0];

  // Already admitted (paid or free) — just check quota.
  if (row?.is_pro) return { allowed: true, seq: row.free_era_seq ?? -1, isFreshAdmission: false };
  if (row?.is_free_era) {
    const used = row.books_generated_lifetime ?? 0;
    if (used >= FREE_ERA_QUOTA_PER_USER) {
      return {
        allowed: false,
        reason: 'quota_exhausted',
        message: 'You\'ve used your free-era generation. Paid tier launches soon — your existing books stay available.',
      };
    }
    return { allowed: true, seq: row.free_era_seq ?? -1, isFreshAdmission: false };
  }

  // Not yet admitted. Atomically claim a seat under the cap.
  const seat = await auroraQuery<{ claim_free_era_seat: number | null }>(
    'SELECT claim_free_era_seat($1, $2)',
    [oid, FREE_ERA_CAP],
  );
  const seq = seat?.rows[0]?.claim_free_era_seat ?? null;

  if (seq === null) {
    return {
      allowed: false,
      reason: 'waitlist',
      message: 'The first-100 free era is full. Join the waitlist and we\'ll email when paid generation opens.',
    };
  }

  return { allowed: true, seq, isFreshAdmission: true };
}

/**
 * Read-only counter peek for UI banners ("Spot 47/100"). Never
 * increments. Counts admitted owners (free_era_seq not null).
 */
export async function peekFreeEraAdmitted(): Promise<{ admitted: number; cap: number }> {
  if (!isAuroraEnabled()) return { admitted: 0, cap: FREE_ERA_CAP };
  const { rows } = (await auroraQuery<{ c: string }>(
    'SELECT COUNT(*)::text AS c FROM users WHERE free_era_seq IS NOT NULL',
  )) ?? { rows: [{ c: '0' }], rowCount: 0 };
  return { admitted: Number(rows[0]?.c ?? 0), cap: FREE_ERA_CAP };
}

/**
 * Bumps the per-owner lifetime book counter after a generation
 * actually starts. Call this AFTER setProgress() returns success —
 * that way an owner whose generation is rejected by validation
 * doesn't burn their one free shot. Admin allowlist callers are a
 * no-op so testing doesn't drain the deployment owner's quota.
 *
 * Pair with bookGenerationRefund() in the route's error path so a
 * failed generation gives the owner their slot back.
 */
export async function bookGenerationConsumed(session: AuthSession | null): Promise<void> {
  if (!session) return;
  if (isAdminSession(session)) return;
  await incrementOwnerQuota(session.userId);
}

/**
 * Refund a previously-consumed generation slot. Called from the
 * /api/books/generate failure path so a crashed generation gives the
 * owner their one allowance back instead of leaving them empty-handed.
 * Floors the counter at zero via the SQL function. Admin callers are
 * a no-op (consumed was a no-op too, nothing to refund).
 */
export async function bookGenerationRefund(session: AuthSession | null): Promise<void> {
  if (!session) return;
  if (isAdminSession(session)) return;
  await decrementOwnerQuota(session.userId);
}

/**
 * Anonymous-quota consume (cookie-only path). Same durable counter
 * as bookGenerationConsumed — kept as a separate export so the
 * generate route's existing if/else over session vs ownerId stays
 * untouched. Idempotent in shape; increments once per call.
 */
export async function consumeAnonymousQuota(ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  await incrementOwnerQuota(ownerId);
}

export async function refundAnonymousQuota(ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  await decrementOwnerQuota(ownerId);
}

/**
 * Add an email to the waitlist (idempotent — unique constraint on
 * email). Used from the sign-up form when the cap is reached.
 */
export async function joinWaitlist(email: string, source = 'signin'): Promise<void> {
  if (!isAuroraEnabled()) return;
  await auroraQuery(
    `INSERT INTO waitlist (email, source) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email.trim().toLowerCase(), source],
  );
}

// ── internal ──

async function incrementOwnerQuota(ownerId: string): Promise<void> {
  if (!isAuroraEnabled()) return;
  // Atomic RPC only — the SQL function inserts the owner row on first
  // use and bumps the lifetime counter in one statement, so concurrent
  // first-generators can't create duplicate quota rows.
  await auroraQuery('SELECT increment_books_generated($1)', [ownerId]);
}

async function decrementOwnerQuota(ownerId: string): Promise<void> {
  if (!isAuroraEnabled()) return;
  await auroraQuery('SELECT decrement_books_generated($1)', [ownerId]);
}