-- ============================================================
-- KathaKitaab H0 — AWS Aurora PostgreSQL durable schema
--
-- New, isolated durable layer. Upstash Redis remains the source of
-- truth for legacy books, cache, progress, locks, rate limits.
-- Every table here mirrors durable story data that also lives (or
-- lived) in Redis; legacy_redis_key links a row back to the
-- untouched Redis original so the migration helper can prove it
-- never deleted anything.
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS so re-running the migration is safe.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   text UNIQUE,
  email         text,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  slug              text NOT NULL UNIQUE,
  title             text NOT NULL,
  prompt            text,
  language          text,
  style             text,
  status            text,
  source            text,
  mode              text,
  visibility        text NOT NULL DEFAULT 'public',
  accuracy_label    text,
  metadata          jsonb,
  legacy_redis_key  text UNIQUE,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_scenes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_project_id  uuid NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
  scene_id          text NOT NULL,
  scene_index       integer NOT NULL,
  title             text,
  narration_text    text,
  visual_prompt     text,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_project_id, scene_id)
);

CREATE TABLE IF NOT EXISTS characters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_project_id  uuid NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name              text NOT NULL,
  description       text,
  visual_profile    jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_project_id, slug)
);

CREATE TABLE IF NOT EXISTS generated_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_project_id  uuid NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
  scene_id          text,
  asset_type        text NOT NULL,
  provider          text,
  url               text NOT NULL,
  metadata          jsonb,
  legacy_redis_key  text,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_project_id  uuid NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
  version_number    integer NOT NULL,
  payload           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_story_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_project_id  uuid NOT NULL REFERENCES story_projects(id) ON DELETE CASCADE,
  slug              text NOT NULL UNIQUE,
  is_public         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id                uuid PRIMARY KEY,
  story_project_id  uuid REFERENCES story_projects(id) ON DELETE SET NULL,
  job_type          text,
  status            text NOT NULL,
  provider          text,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text,
  entity_id     text,
  event_type    text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the read paths the adapter uses.
CREATE INDEX IF NOT EXISTS idx_story_projects_user ON story_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_story_scenes_project ON story_scenes(story_project_id, scene_index);
CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(story_project_id);
CREATE INDEX IF NOT EXISTS idx_assets_project ON generated_assets(story_project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);

-- Auto-bump updated_at on every UPDATE so timestamps stay honest.
CREATE OR REPLACE FUNCTION kk_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_touch ON users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated_at();

DROP TRIGGER IF EXISTS trg_story_projects_touch ON story_projects;
CREATE TRIGGER trg_story_projects_touch BEFORE UPDATE ON story_projects
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated_at();

DROP TRIGGER IF EXISTS trg_story_scenes_touch ON story_scenes;
CREATE TRIGGER trg_story_scenes_touch BEFORE UPDATE ON story_scenes
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated_at();

DROP TRIGGER IF EXISTS trg_characters_touch ON characters;
CREATE TRIGGER trg_characters_touch BEFORE UPDATE ON characters
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated_at();

DROP TRIGGER IF EXISTS trg_assets_touch ON generated_assets;
CREATE TRIGGER trg_assets_touch BEFORE UPDATE ON generated_assets
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated_at();

DROP TRIGGER IF EXISTS trg_public_links_touch ON public_story_links;
CREATE TRIGGER trg_public_links_touch BEFORE UPDATE ON public_story_links
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_touch ON generation_jobs;
CREATE TRIGGER trg_jobs_touch BEFORE UPDATE ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION kk_touch_updated_at();