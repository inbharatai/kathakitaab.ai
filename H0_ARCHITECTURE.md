# KathaKitaab Global — H0 Architecture (Vercel + AWS Aurora PostgreSQL)

> KathaKitaab Global is an AI-native entertainment platform that lets users
> create interactive stories, comics, narrated books, and visual story worlds.
> For H0, the architecture was upgraded from **Vercel + Upstash-only** to
> **Vercel + AWS Aurora PostgreSQL** as the durable global story database,
> while preserving **Upstash Redis** for legacy fallback, cache, and temporary
> generation state.

This document is the architecture explanation for H0 judges. It covers the
two stores, the read/write flow, the safety guarantees, and how to verify the
Aurora integration is genuine (not cosmetic).

---

## 1. Topology

```
            ┌──────────────────────────────┐
            │   Vercel (Next.js 16 app)    │   ← frontend + API routes
            │   frontend unchanged         │
            └───────────────┬──────────────┘
                            │
        ┌───────────────────┴────────────────────┐
        ▼                                         ▼
┌───────────────────────────┐        ┌────────────────────────────┐
│  AWS Aurora PostgreSQL    │        │  Upstash Redis             │
│  (NEW durable layer)      │        │  (LEGACY — untouched)      │
│                           │        │                            │
│  users                    │        │  kk:book:*       (365d TTL)│
│  story_projects           │        │  kk:scene:*      (no TTL)  │
│  story_scenes             │        │  kk:scenes:*     (index)   │
│  characters               │        │  kk:job:*        (7d TTL)  │
│  generated_assets         │        │  kk:gen:progress:* (30m)   │
│  story_versions           │        │  kk:gen:lock:*   (locks)   │
│  public_story_links       │        │  kk:cache:*      (24h)     │
│  generation_jobs          │        │  kk:rl:* / kk:anon_quota:*│
│  audit_events             │        │                            │
└───────────────────────────┘        └────────────────────────────┘
        ▲ new durable writes                  ▲ legacy reads + cache +
        │ (dual-write on save)                  transient state (unchanged)
        │
   Image/audio bytes live in S3 (served via the CloudFront CDN).
   Only the URL strings are stored in Redis book/scene JSON and
   mirrored to Aurora generated_assets.
```

---

## 2. What lives where

### AWS Aurora PostgreSQL — durable, long-term (NEW)
- `users`, `story_projects`, `story_scenes`, `characters`,
  `generated_assets`, `story_versions`, `public_story_links`,
  `generation_jobs`, `audit_events`.
- Written on every book save (`saveGeneratedBook`) — the durable copy.
- Engine: `aurora-postgresql 17.7`, Serverless v2 (0.5–2 ACU).

### Upstash Redis — legacy / cache / transient (UNCHANGED)
- Legacy AI-generated books (`kk:book:*`) — still the source of truth
  for anything created before Aurora was enabled.
- Per-scene generation state (`kk:scene:*`, `kk:scenes:*`).
- In-flight generation jobs + progress (`kk:job:*`, `kk:gen:progress:*`).
- Distributed locks (`kk:gen:lock:*`, `kk:*:lock`).
- Response / image / TTS URL cache (`kk:cache:*`).
- Rate limits + anonymous quotas (`kk:rl:*`, `kk:anon_quota:*`).

**Nothing in Redis was deleted, renamed, or rewritten by this integration.**
The legacy copy helper only *reads* Redis and *writes* Aurora.

---

## 3. Read flow — Aurora-first, Redis fallback

```
getBook(slug)
  1. in-process hot cache (per-lambda)          ← unchanged
  2. seed books (Ramayana etc.)                 ← unchanged
  3. IF USE_AURORA: try Aurora getStoryBySlug   ← NEW
        hit  → return book (warm cache)
        miss → fall through
        error → log sanitized, fall through
  4. Upstash Redis (kk:book:{slug})             ← unchanged, with the
        existing bare/suffixed-slug fallback          existing suffix
                                                     fallback logic
```

- A brand-new story (created with `USE_AURORA=true`) is found in Aurora at
  step 3 and returned.
- A legacy story not yet copied to Aurora misses at step 3 and is returned
  from Redis at step 4 — **the Redis key is never deleted**.
- If Aurora is down, every read transparently falls back to Redis.

---

## 4. Write flow — dual-write, Redis stays source of truth

```
saveGeneratedBook(book)
  1. validate + in-process cache                 ← unchanged
  2. Upstash Redis SET kk:book:{slug} (365d TTL) ← unchanged, source of truth
  3. IF USE_AURORA: upsertStory(book)            ← NEW, best-effort
        → story_projects + story_scenes + characters
          + generated_assets + public_story_links + audit_events
        failure → log sanitized, NEVER blocks the Redis write or the request
```

Additional best-effort Aurora mirrors (all gated by `USE_AURORA`, all
swallow their own errors):
- `jobRegistry.createJob` / `updateJob` → `generation_jobs` metadata.
- `claimBooks` (anonymous→authed ownership) → re-upserts the book so
  Aurora's `user_id` stays in sync with Redis's `ownerId`.
- `deleteBook` → soft-delete (`deleted_at = now()`) + `audit_events` row.
  The Aurora row is kept as an audit trail; only Redis is hard-deleted.

---

## 5. Safety guarantees (H0 non-negotiables)

1. **No Upstash data is deleted.** The legacy copy helper only reads Redis.
2. **No `FLUSHDB` / `FLUSHALL` / broad `DEL`.** Not run, not added.
3. **No Redis key prefixes renamed or overwritten.** Aurora uses its own
   `legacy_redis_key` column to *reference* the Redis original, never to
   mutate it.
4. **The Upstash integration is not removed.** Every Redis code path is
   intact and is the fallback when `USE_AURORA=false`.
5. **Old stories/videos still load.** Asset URLs live inside the Redis
   book/scene JSON; those keys are untouched, and reads fall back to them.
6. **No secrets in code/logs/README/commits.** Connection errors are passed
   through `sanitizeErr()` which strips DSNs, passwords, and hosts. The
   `.env*` files are gitignored. The RDS CA bundle is a public file.
7. **Aurora is genuinely used**, not cosmetic: every book save writes 6
   tables; the judge-facing `/api/aurora/status` returns live row counts
   from a real `SELECT count(*)` + `SELECT version()`.
8. **Minimal, clean, reversible.** Flip `USE_AURORA=false` to revert to
   the exact pre-Aurora behavior. No schema migration is needed to revert.

---

## 6. Environment variables

Existing Upstash / OpenAI / Gemini / Sarvam vars are **unchanged**. Supabase
was removed (2026-07-07); storage is now AWS S3 + CloudFront and the durable
DB is AWS Aurora PostgreSQL.

| Variable | Purpose | Example (no real secrets) |
|---|---|---|
| `DATABASE_URL` | Aurora PostgreSQL connection string (no `sslmode=`; TLS via the `ssl` object + RDS CA bundle) | `postgresql://kathakitaab:••••@kathakitaab-aurora.cluster-xxxx.us-east-1.rds.amazonaws.com:5432/kathakitaab` |
| `USE_AURORA` | Master feature flag. `false` = full revert to Upstash-only. | `true` |
| `AURORA_SSL` | TLS mode for the pool. | `require` |
| `AURORA_POOL_MAX` | Max pg connections per lambda (keep small on serverless). | `3` |
| `MIGRATE_LEGACY` | Opt-in for the non-destructive Redis→Aurora copy helper. | `false` |

> **Rotate secrets regularly.** No secret values are stored in this repo.

---

## 7. Verify it yourself (for judges)

After deploy, hit the public endpoint:

```
GET https://kathakitaab.com/api/aurora/status
```

Expected (live — counts grow with usage; shape is stable):
```json
{
  "aurora": {
    "enabled": true,
    "engine": "PostgreSQL 17.7 on aarch64-unknown-linux-gnu, ...",
    "engineError": null,
    "tables": {
      "users": 0, "story_projects": N, "story_scenes": N, "characters": N,
      "generated_assets": N, "story_versions": 0, "public_story_links": N,
      "generation_jobs": 0, "audit_events": N
    },
    "durableRole": "story_projects, story_scenes, characters, generated_assets, generation_jobs, audit_events",
    "legacyRole": "Upstash Redis — legacy reads, cache, progress, locks, rate limits (untouched)",
    "readOrder": "Aurora-first → Upstash Redis fallback"
  }
}
```

`enabled: true` + a non-null `engine` string prove the pool reached Aurora
over strict TLS. `tables.*` are real `SELECT count(*)` per table — they rise
as books are saved (and include soft-deleted rows, which are kept as an
audit trail rather than hard-deleted).

Local smoke test (writes a throwaway story to Aurora, reads it back,
asserts the Redis key was NOT created, then soft-deletes):

```
npm run aurora:smoke
```

Non-destructive legacy copy (reads Redis, writes Aurora, proves Redis
count is unchanged before vs after):

```
MIGRATE_LEGACY=true npm run migrate:legacy
```

---

## 8. Files added / changed for H0

**New:**
- `lib/db/aurora.ts` — pg Pool singleton (SSL + RDS CA bundle, sanitized logging).
- `lib/storage/storyStore.ts` — adapter: `upsertStory`, `getStoryBySlug`,
  `softDeleteStory`, `upsertJobMetadata`, `getAuroraStats`.
- `db/aurora/migrations/0001_init.sql` — schema (9 tables + indexes + `updated_at` trigger).
- `db/aurora/rds-ca-bundle.pem` — public AWS RDS CA bundle for strict TLS.
- `scripts/apply-aurora-migrations.ts` — migration runner.
- `scripts/aurora-smoke.ts` — end-to-end smoke test.
- `scripts/migrate-redis-to-aurora.ts` — non-destructive legacy copy helper.
- `app/api/aurora/status/route.ts` — public judge-facing proof endpoint.
- `app/api/admin/aurora/health/route.ts` — admin-gated connectivity check.
- `.env.example` — env template (no real secrets).

**Edited (minimal, flag-gated):**
- `lib/data/bookRegistry.ts` — Aurora-first read, dual-write on save, soft-delete on delete.
- `lib/data/jobRegistry.ts` — best-effort `generation_jobs` metadata mirror.
- `lib/auth/claimBooks.ts` — best-effort Aurora owner sync on claim.
- `next.config.ts` — `pg` server-external; CA bundle in file-tracing includes
  (`outputFileTracingIncludes` global key `'/*'`); client-only webpack
  `resolve.fallback` stubs for `tls/net/dns/fs/child_process` so `pg` (reached
  transitively by client code via `bookRegistry`) doesn't break the browser bundle.
- `package.json` — `pg` moved to runtime deps; `migrate:aurora` / `aurora:smoke` / `migrate:legacy` scripts.

**Untouched:** every Upstash code path, the storage adapters, the frontend,
and every API route's contract.