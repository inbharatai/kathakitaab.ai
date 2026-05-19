// ============================================================
// lib/auth/freeEraGate.ts
//
// First-100-users gate + per-user generation quota.
//
// Rules:
//   1. To generate ANY book the caller must be a signed-in user.
//   2. To be admitted into the free era, the user's id must already
//      carry is_free_era=true on the public.users row, OR they must
//      win one of the first 100 admission slots. Admission is atomic
//      via a Redis counter — race-safe under concurrent first-time
//      generators.
//   3. Each free-era user gets 1 lifetime book generation. After that
//      they're capped until paid tier launches.
//
// Returns one of:
//   - { allowed: true, seq, isFreshAdmission }      — go generate
//   - { allowed: false, reason: 'waitlist' }        — cap reached
//   - { allowed: false, reason: 'quota_exhausted' } — used their 1 gen
//   - { allowed: false, reason: 'misconfigured' }    — infra issue
// ============================================================

import { getRedis } from '@/lib/redis';
import { getSupabaseService } from '@/lib/supabase';
import type { AuthSession } from './session';
import { isAdminSession } from './adminAllowlist';

const FREE_ERA_CAP = 100;
const FREE_ERA_QUOTA_PER_USER = 1;
const FREE_ERA_COUNTER_KEY = 'kk:free_era:admitted';

// Anonymous beta quota — one free generation per browser/device cookie.
// Override via BETA_FREE_GENERATION_LIMIT env var (defaults to 1).
const ANON_QUOTA_KEY_PREFIX = 'kk:anon_quota:';
const ANON_QUOTA_MAX = Number(process.env.BETA_FREE_GENERATION_LIMIT ?? 1) || 1;

export type GateDecision =
  | { allowed: true; seq: number; isFreshAdmission: boolean }
  | { allowed: false; reason: 'waitlist'; message: string }
  | { allowed: false; reason: 'quota_exhausted'; message: string }
  | { allowed: false; reason: 'misconfigured'; message: string };

/**
 * Check + reserve a generation slot for the given session. Idempotent
 * in the sense that a user already inside the free era just gets a
 * cheap "you're in" decision; the side-effect (counter increment + DB
 * flag flip) only happens on FIRST admission.
 *
 * The seat reservation does NOT bump the lifetime counter — that's
 * done by a follow-up call to bookGenerationConsumed() once the
 * request actually starts a generation. That separation means a
 * pre-flight UI check ("can I press the button?") doesn't burn the
 * user's one allowance.
 *
 * Beta change: anonymous users with an owner cookie get a 1-generation
 * quota so the app works without login during Google Play review.
 */
export async function checkFreeEraGate(session: AuthSession | null, ownerId?: string | null): Promise<GateDecision> {
  if (!session) {
    // During beta, anonymous users get a per-device/cookie quota instead
    // of being blocked. If no owner cookie either, fall through to the
    // generic misconfigured path (shouldn't happen — proxy.ts always sets
    // the cookie).
    if (ownerId) {
      return checkAnonymousQuota(ownerId);
    }
    return {
      allowed: false,
      reason: 'misconfigured',
      message: 'Could not establish ownership. Please reload and try again.',
    };
  }

  // Admin allowlist — the deployment owner + any KATHA_ADMIN_EMAILS
  // bypass the free-era cap and per-user quota entirely so they can
  // exercise the live product end-to-end without burning their own
  // allowance. No DB lookup, no counter touch.
  if (isAdminSession(session)) {
    return { allowed: true, seq: -1, isFreshAdmission: false };
  }

  const supabase = getSupabaseService();
  if (!supabase) {
    return {
      allowed: false,
      reason: 'misconfigured',
      message: 'Supabase service role is not configured. Generation is paused.',
    };
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, is_free_era, free_era_seq, is_pro, books_generated_lifetime')
    .eq('id', session.userId)
    .maybeSingle();
  if (error) {
    return { allowed: false, reason: 'misconfigured', message: `users lookup failed: ${error.message}` };
  }
  if (!data) {
    // Should never happen — the auth trigger creates the row. But if
    // it does, surface clearly rather than silently letting them in.
    return { allowed: false, reason: 'misconfigured', message: 'User record missing. Please sign out and in again.' };
  }

  const used = data.books_generated_lifetime ?? 0;

  // Already admitted (free or paid) — just check quota.
  if (data.is_pro) return { allowed: true, seq: data.free_era_seq ?? -1, isFreshAdmission: false };
  if (data.is_free_era) {
    if (used >= FREE_ERA_QUOTA_PER_USER) {
      return {
        allowed: false,
        reason: 'quota_exhausted',
        message: 'You\'ve used your free-era generation. Paid tier launches soon — your existing books stay available.',
      };
    }
    return { allowed: true, seq: data.free_era_seq ?? -1, isFreshAdmission: false };
  }

  // Not yet admitted. Atomically claim a slot if we're under the cap.
  const seq = await reserveFreeEraSeat();
  if (seq === null || seq > FREE_ERA_CAP) {
    return {
      allowed: false,
      reason: 'waitlist',
      message: 'The first-100 free era is full. Join the waitlist and we\'ll email when paid generation opens.',
    };
  }

  // Persist admission. Survives the user's session.
  const { error: updateErr } = await supabase
    .from('users')
    .update({ is_free_era: true, free_era_seq: seq, updated_at: new Date().toISOString() })
    .eq('id', session.userId);
  if (updateErr) {
    // Counter is gone (incremented). Release isn't worth the
    // complexity — at worst the cap admits 99 users instead of 100.
    return {
      allowed: false,
      reason: 'misconfigured',
      message: `Could not record admission: ${updateErr.message}. Please retry.`,
    };
  }

  return { allowed: true, seq, isFreshAdmission: true };
}

/**
 * Read-only counter peek for the sign-in page banner ("Spot 47/100").
 * Never increments. Safe to call from anywhere.
 */
export async function peekFreeEraAdmitted(): Promise<{ admitted: number; cap: number }> {
  const r = getRedis();
  if (!r) return { admitted: 0, cap: FREE_ERA_CAP };
  const raw = await r.get<number>(FREE_ERA_COUNTER_KEY);
  return { admitted: Number(raw ?? 0), cap: FREE_ERA_CAP };
}

/**
 * Bumps the per-user lifetime book counter after a generation actually
 * starts. Call this AFTER setProgress() returns success — that way a
 * user whose generation is rejected by validation doesn't burn their
 * one free shot. Admin allowlist callers are a no-op so testing
 * doesn't drain the deployment owner's quota.
 *
 * Pair with bookGenerationRefund() in the route's error path so a
 * failed generation gives the user their slot back.
 */
export async function bookGenerationConsumed(session: AuthSession | null): Promise<void> {
  if (!session) return;
  if (isAdminSession(session)) return;
  const supabase = getSupabaseService();
  if (!supabase) return;
  // Prefer the SQL function (atomic, race-safe). If it isn't deployed
  // yet — pre-migration boot — fall back to a read-modify-write, which
  // is good enough for a free-era counter that tolerates ±1 drift.
  const { error } = await supabase.rpc('increment_books_generated', { user_id: session.userId });
  if (!error) return;
  const { data } = await supabase
    .from('users')
    .select('books_generated_lifetime')
    .eq('id', session.userId)
    .maybeSingle();
  const cur = (data?.books_generated_lifetime as number | undefined) ?? 0;
  await supabase
    .from('users')
    .update({ books_generated_lifetime: cur + 1, updated_at: new Date().toISOString() })
    .eq('id', session.userId);
}

/**
 * Refund a previously-consumed generation slot. Called from the
 * /api/books/generate failure path so a crashed generation gives the
 * user their one allowance back instead of leaving them empty-handed.
 *
 * Floors the counter at zero — drift from concurrent refunds shouldn't
 * be able to underflow into negatives. Admin callers are a no-op
 * (consumed was a no-op too, nothing to refund).
 */
export async function bookGenerationRefund(session: AuthSession | null): Promise<void> {
  if (!session) return;
  if (isAdminSession(session)) return;
  const supabase = getSupabaseService();
  if (!supabase) return;
  const { error } = await supabase.rpc('decrement_books_generated', { user_id: session.userId });
  if (!error) return;
  // Fallback: read-modify-write, clamped at zero.
  const { data } = await supabase
    .from('users')
    .select('books_generated_lifetime')
    .eq('id', session.userId)
    .maybeSingle();
  const cur = (data?.books_generated_lifetime as number | undefined) ?? 0;
  const next = Math.max(0, cur - 1);
  if (next === cur) return;
  await supabase
    .from('users')
    .update({ books_generated_lifetime: next, updated_at: new Date().toISOString() })
    .eq('id', session.userId);
}

/**
 * Add an email to the waitlist (idempotent — unique constraint on email).
 * Used from the sign-up form when the cap is reached.
 */
export async function joinWaitlist(email: string, source = 'signin'): Promise<void> {
  const supabase = getSupabaseService();
  if (!supabase) return;
  await supabase.from('waitlist').upsert({ email, source }, { onConflict: 'email' });
}

// ── anonymous quota helpers ─────────────────────────────────

async function checkAnonymousQuota(ownerId: string): Promise<GateDecision> {
  const r = getRedis();
  if (!r) {
    // Local dev without Redis = unlimited for convenience.
    return { allowed: true, seq: -1, isFreshAdmission: false };
  }
  const key = `${ANON_QUOTA_KEY_PREFIX}${ownerId}`;
  const used = Number(await r.get<number>(key) ?? 0);
  if (used >= ANON_QUOTA_MAX) {
    return {
      allowed: false,
      reason: 'quota_exhausted',
      message: "You've used your free beta story. More generations and saved accounts are coming soon.",
    };
  }
  return { allowed: true, seq: -1, isFreshAdmission: false };
}

export async function consumeAnonymousQuota(ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  const r = getRedis();
  if (!r) return;
  await r.incr(`${ANON_QUOTA_KEY_PREFIX}${ownerId}`);
}

export async function refundAnonymousQuota(ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  const r = getRedis();
  if (!r) return;
  const key = `${ANON_QUOTA_KEY_PREFIX}${ownerId}`;
  const cur = Number(await r.get<number>(key) ?? 0);
  if (cur > 0) await r.set(key, cur - 1);
}

// ── internal ──

async function reserveFreeEraSeat(): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;
  // Atomic INCR — Upstash supports it. Each caller gets a unique seq.
  const seq = await r.incr(FREE_ERA_COUNTER_KEY);
  return typeof seq === 'number' ? seq : null;
}
