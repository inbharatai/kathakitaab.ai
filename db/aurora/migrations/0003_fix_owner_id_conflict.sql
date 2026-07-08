-- ============================================================
-- KathaKitaab 0003 — Fix ON CONFLICT (owner_id) arbiter inference
--
-- 0002 created uq_users_owner_id as a PARTIAL unique index:
--     CREATE UNIQUE INDEX uq_users_owner_id ON users(owner_id)
--       WHERE owner_id IS NOT NULL;
--
-- The quota functions (claim_free_era_seat, increment_books_generated,
-- decrement_books_generated) all use:
--     INSERT INTO users (owner_id, ...) ON CONFLICT (owner_id) DO UPDATE
--
-- Postgres cannot infer a partial unique index as an ON CONFLICT
-- arbiter unless the statement repeats the partial predicate
-- (... ON CONFLICT (owner_id) WHERE owner_id IS NOT NULL DO ...).
-- Without it, every call dies with:
--   "there is no unique or exclusion constraint matching the ON
--    CONFLICT specification"
-- so auroraQuery returns null and the free-era gate waitlists every
-- request (403) — including the ownership:140 e2e.
--
-- Fix: replace the partial index with a non-partial unique index so
-- plain `ON CONFLICT (owner_id)` infers it. Postgres unique indexes
-- treat NULLs as distinct, so multiple legacy rows with NULL owner_id
-- still coexist — the WHERE owner_id IS NOT NULL guard was redundant.
--
-- Idempotent: DROP IF EXISTS then CREATE IF NOT EXISTS. Safe to re-run.
-- ============================================================

DROP INDEX IF EXISTS uq_users_owner_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_owner_id ON users(owner_id);