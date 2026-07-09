// ============================================================
// KathaKitaab — AWS Aurora PostgreSQL client (new durable DB)
//
// Minimal, isolated, and safe-by-default:
//   - Returns null when DATABASE_URL is absent so every caller can
//     fall back to the existing Upstash path without crashing.
//   - USE_AURORA must be "true" (case-insensitive) for any Aurora
//     read/write to actually fire. When false the app behaves
//     exactly as it did before this module existed — full revert.
//   - Aurora errors are logged with a sanitized message (no DSN,
//     no password, no host) so secrets never reach logs.
//
// Aurora is a *new* durable branch. Upstash Redis stays the source
// of truth for legacy reads, cache, progress, locks, rate limits.
// See H0_ARCHITECTURE.md.
// ============================================================

import { Pool, type PoolClient } from 'pg';
// Bare 'fs' (not 'node:fs'): the 'node:' scheme isn't handled by the
// client webpack build, and this module is imported transitively by
// client code. On the client, 'fs' is stubbed to false via next.config
// webpack fallback; the CA-bundle read only ever runs server-side.
import { readFileSync, existsSync } from 'fs';

let cached: Pool | null | undefined;

/** AWS RDS / Aurora CA bundle (public, downloaded into the repo). Used
 *  so we can keep rejectUnauthorized=true — strict cert verification —
 *  without relying on Node's default bundle, which lacks the RDS
 *  intermediate that causes "unable to get local issuer certificate". */
let caBundle: string | null | undefined;
function getCaBundle(): string | null {
  if (caBundle !== undefined) return caBundle;
  const p = process.cwd() + '/db/aurora/rds-ca-bundle.pem';
  try {
    caBundle = existsSync(p) ? readFileSync(p, 'utf8') : null;
  } catch {
    caBundle = null;
  }
  return caBundle;
}

/** Build the pg ssl option. With the RDS bundle present we verify
 *  strictly; without it we fall back to the looser one-shot style so
 *  the app still connects (logged). */
function buildSsl() {
  const ca = getCaBundle();
  if (ca) return { rejectUnauthorized: true, ca };
  // No bundle — still require TLS, just skip cert verification. This
  // is less secure but keeps the app running if the bundle is missing.
  console.warn('[aurora] CA bundle missing — using relaxed TLS verification');
  return { rejectUnauthorized: false };
}

/** True only when USE_AURORA=true AND DATABASE_URL is set. */
export function isAuroraEnabled(): boolean {
  return process.env.USE_AURORA?.toLowerCase() === 'true' && !!process.env.DATABASE_URL;
}

/** The pg connection pool, or null when Aurora is not configured.
 *  Callers MUST handle null (treat as "skip Aurora, use Upstash"). */
export function getAurora(): Pool | null {
  if (!isAuroraEnabled()) return null;
  if (cached !== undefined) return cached;

  const max = Number(process.env.AURORA_POOL_MAX);
  const maxConns = Number.isFinite(max) && max > 0 ? max : 3;

  try {
    cached = new Pool({
      connectionString: process.env.DATABASE_URL,
      // RDS / Aurora require TLS. The ssl object (with the RDS CA
      // bundle) drives verification — do NOT put sslmode= in the URL,
      // since pg v8 maps sslmode=require to verify-full and overrides
      // this option.
      ssl: (process.env.AURORA_SSL ?? 'require') === 'require' ? buildSsl() : undefined,
      max: maxConns,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      // Vercel lambdas recycle fast — don't hold a long-lived idle pool.
      allowExitOnIdle: true,
    });
    cached.on('error', (err) => {
      console.warn('[aurora] pool error:', sanitizeErr(err));
    });
    return cached;
  } catch (err) {
    console.warn('[aurora] failed to construct pool:', sanitizeErr(err));
    cached = null;
    return null;
  }
}

/** Run a query inside a pooled client. Returns null on error so the
 *  caller can fall back — Aurora must never crash a request. */
export async function auroraQuery<T = unknown>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number } | null> {
  const pool = getAurora();
  if (!pool) return null;
  try {
    const res = await pool.query(text, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
  } catch (err) {
    console.warn('[aurora] query failed:', sanitizeErr(err));
    return null;
  }
}

/** Acquire a raw client for multi-statement transactions. Returns null
 *  on error. Caller is responsible for release() in a finally block. */
export async function auroraClient(): Promise<PoolClient | null> {
  const pool = getAurora();
  if (!pool) return null;
  try {
    return await pool.connect();
  } catch (err) {
    console.warn('[aurora] connect failed:', sanitizeErr(err));
    return null;
  }
}

/** Strip any postgres:// DSN, password, or host from an error before
 *  it touches a log line. We never want a connection string leaking. */
export function sanitizeErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-dsn]')
    .replace(/password=[^\s;]+/gi, 'password=[redacted]')
    .replace(/([a-z0-9.-]+\.rds\.amazonaws\.com)/gi, '[redacted-host]');
}

// ============================================================
// Persistent character conversation memory (migration 0004)
//
// ask-character (app/api/livebook/ask-character/route.ts) was stateless;
// these helpers load/append a per-(owner, book, character) thread so a
// character remembers across turns. Both are gated on isAuroraEnabled()
// and never throw — callers treat "Aurora off / error" as "no thread",
// falling back to Redis then to stateless single-turn.
// ============================================================

/** Load the prior turn history for a (owner, book, character) thread.
 *  Returns [] when Aurora is off, the row is absent, or any error
 *  occurs — so the caller can prepend it unconditionally. */
export async function getCharacterThread(
  ownerId: string,
  bookSlug: string,
  charSlug: string,
): Promise<{ role: string; content: string }[]> {
  if (!isAuroraEnabled() || !ownerId) return [];
  const res = await auroraQuery<{ thread: { role: string; content: string }[] }>(
    `SELECT thread FROM character_memory
      WHERE owner_id = $1 AND book_slug = $2 AND character_slug = $3`,
    [ownerId, bookSlug, charSlug],
  );
  if (!res || res.rowCount === 0) return [];
  const thread = res.rows[0]?.thread;
  return Array.isArray(thread) ? thread : [];
}

/** Append one turn to a (owner, book, character) thread via the
 *  append_character_turn plpgsql fn (migration 0004). No-op when Aurora
 *  is off or the owner is empty. Never throws — the route must never
 *  fail to answer the user because the memory write failed. */
export async function appendCharacterTurn(
  ownerId: string,
  bookSlug: string,
  charSlug: string,
  role: string,
  content: string,
): Promise<void> {
  if (!isAuroraEnabled() || !ownerId) return;
  await auroraQuery(
    `SELECT append_character_turn($1, $2, $3, $4, $5)`,
    [ownerId, bookSlug, charSlug, role, content],
  );
}