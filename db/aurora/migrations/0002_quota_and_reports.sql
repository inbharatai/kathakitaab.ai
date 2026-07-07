-- ============================================================
-- KathaKitaab 0002 — Anonymous-owner quota, waitlist, content reports
--
-- Supabase auth is gone. The durable identity is the anonymous
-- `owner_id` (text) set as the katha:owner cookie by middleware
-- (lib/auth/ownerId.ts). This migration adds the quota + moderation
-- tables that used to live in Supabase (002_auth_users.sql,
-- 003_quota_refund.sql), keyed on owner_id text instead of a Supabase
-- auth UUID. No auth.users FK, no RLS — Aurora is service-role only.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
-- Safe to re-run.
-- ============================================================

-- ---- Quota columns on users ----------------------------------------------
-- owner_id is the anonymous cookie id (text). It is the real key for
-- quota in anonymous-only mode. The existing uuid `id` stays as the
-- PK so story_projects.user_id (uuid FK) keeps working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_free_era boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_era_seq integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pro boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS books_generated_lifetime integer NOT NULL DEFAULT 0;

-- One row per anonymous owner. Unique on owner_id so concurrent
-- first-generation races can't create duplicate quota rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_owner_id ON users(owner_id) WHERE owner_id IS NOT NULL;

-- ---- Waitlist ------------------------------------------------------------
-- Email capture for the free-era cap overflow. Same shape as the old
-- Supabase waitlist table.
CREATE TABLE IF NOT EXISTS waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);

-- ---- Content reports -----------------------------------------------------
-- Reader-initiated moderation flags on public books. owner_id is the
-- reporter's anonymous cookie (null if the reader had no cookie yet).
CREATE TABLE IF NOT EXISTS content_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_slug           text NOT NULL,
  scene_id           text,
  reporter_owner_id   text,
  reason              text NOT NULL,
  notes               text,
  status              text NOT NULL DEFAULT 'open',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
CREATE INDEX IF NOT EXISTS idx_content_reports_book ON content_reports(book_slug);

-- ---- Quota functions -----------------------------------------------------
-- Atomic bump of lifetime generated count. Inserts the owner row on
-- first use. Returns the new lifetime count, or NULL if owner_id is
-- null/empty (defensive — callers should never pass null).
CREATE OR REPLACE FUNCTION increment_books_generated(p_owner_id text)
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_owner_id IS NULL OR btrim(p_owner_id) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO users (owner_id, books_generated_lifetime, is_free_era)
  VALUES (p_owner_id, 1, true)
  ON CONFLICT (owner_id) DO UPDATE
    SET books_generated_lifetime = users.books_generated_lifetime + 1
  RETURNING books_generated_lifetime INTO v_count;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Atomic refund (decrement, floored at 0). Used when a generation
-- fails after the quota was consumed.
CREATE OR REPLACE FUNCTION decrement_books_generated(p_owner_id text)
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_owner_id IS NULL OR btrim(p_owner_id) = '' THEN
    RETURN NULL;
  END IF;

  UPDATE users
     SET books_generated_lifetime = GREATEST(0, books_generated_lifetime - 1)
   WHERE owner_id = p_owner_id
  RETURNING books_generated_lifetime INTO v_count;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ---- Free-era seat assignment -------------------------------------------
-- Claim a numbered seat in the first FREE_ERA_CAP admitted owners.
-- Returns the assigned seat number (1..CAP) or NULL if the cap is full
-- / owner already had a seat (caller distinguishes via the SELECT).
-- Idempotent: assigning a seat to an owner that already has one is a
-- no-op that returns the existing seat.
CREATE OR REPLACE FUNCTION claim_free_era_seat(p_owner_id text, p_cap integer)
RETURNS integer AS $$
DECLARE
  v_existing integer;
  v_next     integer;
BEGIN
  IF p_owner_id IS NULL OR btrim(p_owner_id) = '' THEN
    RETURN NULL;
  END IF;

  SELECT free_era_seq INTO v_existing FROM users WHERE owner_id = p_owner_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;             -- already admitted
  END IF;

  SELECT COALESCE(MAX(free_era_seq), 0) + 1 INTO v_next
    FROM users WHERE free_era_seq IS NOT NULL;

  IF p_cap IS NOT NULL AND v_next > p_cap THEN
    RETURN NULL;                    -- cap full
  END IF;

  INSERT INTO users (owner_id, free_era_seq, is_free_era, books_generated_lifetime)
  VALUES (p_owner_id, v_next, true, 0)
  ON CONFLICT (owner_id) DO UPDATE
    SET free_era_seq = EXCLUDED.free_era_seq,
        is_free_era  = true
  RETURNING free_era_seq INTO v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;