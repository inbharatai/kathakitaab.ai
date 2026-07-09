-- ============================================================
-- KathaKitaab 0004 — Persistent character conversation memory
--
-- ask-character (app/api/livebook/ask-character/route.ts) was stateless:
-- each turn built a per-request cache key with no thread id, so a
-- character never remembered the prior turn. This migration adds a
-- durable thread store keyed on the anonymous `owner_id` cookie
-- (lib/auth/ownerId.ts) + book + character.
--
-- Aurora is the durable branch (USE_AURORA=true). When Aurora is off
-- or unreachable the route falls back to Redis, then to stateless
-- single-turn (see lib/db/aurora.ts + the route's degrade ladder). So
-- this table existing is a progressive enhancement, not a hard dep.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS character_memory (
  owner_id        text    NOT NULL,
  book_slug       text    NOT NULL,
  character_slug  text    NOT NULL,
  -- Array of {role: 'user'|'assistant', content: text} turns, most-
  -- recent last. Capped at MAX_TURNS by append_character_turn so a
  -- long conversation can't grow a row without bound.
  thread          jsonb   NOT NULL DEFAULT '[]'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, book_slug, character_slug)
);

CREATE INDEX IF NOT EXISTS idx_character_memory_owner
  ON character_memory(owner_id);

-- append_character_turn(owner, book, character, role, content, max_turns)
-- Inserts the row on first contact, then appends one turn to the thread.
-- Trims the thread to the last `max_turns` entries (default 20) so a
-- runaway conversation stays cheap. Returns the full resulting thread
-- (an array), or NULL if owner_id is null/empty (defensive).
CREATE OR REPLACE FUNCTION append_character_turn(
  p_owner_id        text,
  p_book_slug       text,
  p_character_slug  text,
  p_role            text,
  p_content         text,
  p_max_turns       integer DEFAULT 20
) RETURNS jsonb AS $$
DECLARE
  v_thread jsonb;
  v_entry  jsonb;
BEGIN
  IF p_owner_id IS NULL OR btrim(p_owner_id) = '' THEN
    RETURN NULL;
  END IF;

  v_entry := jsonb_build_object('role', p_role, 'content', p_content);

  INSERT INTO character_memory (owner_id, book_slug, character_slug, thread)
  VALUES (p_owner_id, p_book_slug, p_character_slug, jsonb_build_array(v_entry))
  ON CONFLICT (owner_id, book_slug, character_slug) DO UPDATE
    SET thread   = character_memory.thread || jsonb_build_array(v_entry),
        updated_at = now()
  RETURNING thread INTO v_thread;

  -- Trim to the last p_max_turns turns, preserving chronological order.
  -- WITH ORDINALITY gives each element its 1-based index; we keep the
  -- last N by descending ord, then re-aggregate ascending so the thread
  -- stays oldest→newest.
  --
  -- IMPORTANT: the ON CONFLICT above wrote the UNtrimmed thread to the
  -- row. The trim below mutates the local v_thread (returned to the
  -- caller) AND must be persisted back — otherwise the stored column
  -- grows without bound and the cap is cosmetic. Only persist when we
  -- actually trimmed (array longer than the cap), to avoid a redundant
  -- write on every turn once the thread is already at-or-under the cap.
  IF p_max_turns IS NOT NULL AND p_max_turns > 0
     AND jsonb_array_length(v_thread) > p_max_turns THEN
    SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb) INTO v_thread
      FROM (
        SELECT value AS elem, ord
          FROM jsonb_array_elements(v_thread) WITH ORDINALITY AS t(value, ord)
         ORDER BY ord DESC
         LIMIT p_max_turns
      ) trimmed;

    UPDATE character_memory
       SET thread = v_thread, updated_at = now()
     WHERE owner_id = p_owner_id
       AND book_slug = p_book_slug
       AND character_slug = p_character_slug;
  END IF;

  RETURN v_thread;
END;
$$ LANGUAGE plpgsql;