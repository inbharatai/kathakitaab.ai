// ============================================================
// KathaKitaab — Aurora PostgreSQL story storage adapter
//
// The single bridge between the app's book model and the new Aurora
// durable layer. Every function is best-effort: on any Aurora error
// it returns null / false and logs a SANITIZED message (no DSN,
// no host, no password). Callers (bookRegistry / jobRegistry /
// claimBooks) treat "Aurora missed" as "fall back to Upstash" —
// never as "crash the request."
//
// Storage shape (lossless):
//   story_projects.metadata   = full GeneratedBook header (everything
//                               except scenes/characters), as jsonb.
//   story_scenes.metadata     = full PersistedScene / GeneratedScene.
//   characters.visual_profile = full GeneratedCharacter.
//   generated_assets          = denormalized image/audio URLs pulled
//                               from scene fields, with legacy_redis_key.
//
// Redis is NEVER written or deleted by this module. legacy_redis_key
// only *records* which Redis key the row mirrors.
// ============================================================

import { auroraClient, auroraQuery, isAuroraEnabled, sanitizeErr } from '@/lib/db/aurora';
import type { GeneratedBook, GeneratedScene, GeneratedCharacter } from '@/lib/openai/bookGeneratorAgent';
import type { GenerationJob } from '@/lib/data/jobRegistry';

const BOOK_KEY = (slug: string) => `kk:book:${slug}`;

// ---- helpers ---------------------------------------------------------------

function headerOf(book: GeneratedBook): Record<string, unknown> {
  // Strip the big arrays — they get their own rows — and keep
  // everything else (id, slug, title, mode, ownerId, visibility,
  // stylePreset, accuracyLabel, qualityScore, movieStatus,
  // movieMissingAssets, metadata, generatedAt, updatedAt, ...).
  const { scenes: _s, characters: _c, ...header } = book;
  void _s; void _c;
  return header as Record<string, unknown>;
}

/** Pull the user-facing language off the book. GeneratedBook has no
 *  top-level `language` — it lives nested in metadata (classroom or
 *  personalized mode). Returns null for world-mode / legacy books. */
function bookLanguage(book: GeneratedBook): string | null {
  const m = book.metadata;
  return m?.classroom?.language ?? m?.personalized?.language ?? null;
}

/** Pull the original generation prompt off the book. Only the
 *  personalized mode stores it (on metadata.personalized.prompt).
 *  Returns null for world / classroom / legacy books. */
function bookPrompt(book: GeneratedBook): string | null {
  return book.metadata?.personalized?.prompt ?? null;
}

function reconstructBook(
  row: { metadata: Record<string, unknown> | null },
  scenes: GeneratedScene[],
  characters: GeneratedCharacter[],
): GeneratedBook | null {
  if (!row || !row.metadata) return null;
  return {
    ...(row.metadata as object),
    scenes,
    characters,
  } as GeneratedBook;
}

/** Best-effort: ensure a users row exists for an ownerId and return
 *  its uuid. Returns null on any error (caller proceeds without it). */
async function ensureUser(externalId: string): Promise<string | null> {
  const res = await auroraQuery<{ id: string }>(
    `INSERT INTO users (external_id) VALUES ($1)
     ON CONFLICT (external_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [externalId],
  );
  return res?.rows[0]?.id ?? null;
}

// ---- write -----------------------------------------------------------------

/** Upsert a finished book into Aurora. Best-effort — returns true on
 *  success, false on any error (logged sanitized). Never throws. */
export async function upsertStory(book: GeneratedBook): Promise<boolean> {
  if (!isAuroraEnabled()) return false;
  if (!book?.slug || !book?.title || !Array.isArray(book.scenes)) return false;

  const client = await auroraClient();
  if (!client) return false;

  try {
    await client.query('BEGIN');

    // 1. story_projects (header)
    const userId = book.ownerId ? await ensureUser(book.ownerId) : null;
    // ensureUser ran on the pool, not this client's txn — that's fine,
    // it's an independent idempotent upsert.
    const header = headerOf(book);
    const legacyKey = BOOK_KEY(book.slug);
    const projectRow = await client.query<{ id: string }>(
      `INSERT INTO story_projects
         (slug, title, prompt, language, style, status, source, mode,
          visibility, accuracy_label, metadata, legacy_redis_key, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (slug) DO UPDATE SET
         title=EXCLUDED.title,
         prompt=EXCLUDED.prompt,
         style=EXCLUDED.style,
         status=EXCLUDED.status,
         source=EXCLUDED.source,
         mode=EXCLUDED.mode,
         visibility=EXCLUDED.visibility,
         accuracy_label=EXCLUDED.accuracy_label,
         metadata=EXCLUDED.metadata,
         legacy_redis_key=EXCLUDED.legacy_redis_key,
         user_id=COALESCE(EXCLUDED.user_id, story_projects.user_id),
         deleted_at=NULL,
         updated_at=now()
       RETURNING id`,
      [
        book.slug,
        book.title,
        bookPrompt(book),
        bookLanguage(book),
        book.stylePreset ?? null,
        book.movieStatus ?? null,
        book.source_tradition ?? null,
        book.mode ?? null,
        book.visibility ?? 'public',
        book.accuracyLabel ?? null,
        JSON.stringify(header),
        legacyKey,
        userId,
      ],
    );
    const projectId = projectRow.rows[0]?.id;
    if (!projectId) throw new Error('no project id returned');

    // 2. scenes — replace by scene_id within this project
    await client.query('DELETE FROM story_scenes WHERE story_project_id=$1', [projectId]);
    for (let i = 0; i < book.scenes.length; i++) {
      const s = book.scenes[i];
      await client.query(
        `INSERT INTO story_scenes
           (story_project_id, scene_id, scene_index, title, narration_text, visual_prompt, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          projectId,
          s.scene_id,
          s.order_index ?? i,
          s.title ?? null,
          s.narration ?? null,
          s.visual_description ?? null,
          JSON.stringify(s),
        ],
      );
    }

    // 3. characters — replace by slug within this project
    await client.query('DELETE FROM characters WHERE story_project_id=$1', [projectId]);
    for (const c of book.characters ?? []) {
      await client.query(
        `INSERT INTO characters
           (story_project_id, slug, name, description, visual_profile)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          projectId,
          c.slug,
          c.name,
          c.short_summary || c.role || null,
          JSON.stringify(c),
        ],
      );
    }

    // 4. generated_assets — denormalized from scene URLs
    await client.query('DELETE FROM generated_assets WHERE story_project_id=$1', [projectId]);
    const assetRows = collectAssets(book, legacyKey);
    for (const a of assetRows) {
      await client.query(
        `INSERT INTO generated_assets
           (story_project_id, scene_id, asset_type, provider, url, metadata, legacy_redis_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [projectId, a.sceneId, a.type, a.provider, a.url, JSON.stringify(a.meta), legacyKey],
      );
    }

    // 5. public_story_links
    if (book.visibility === 'public') {
      await client.query(
        `INSERT INTO public_story_links (story_project_id, slug, is_public)
         VALUES ($1,$2,true)
         ON CONFLICT (slug) DO UPDATE SET is_public=true, updated_at=now()`,
        [projectId, book.slug],
      );
    } else {
      await client.query(
        `UPDATE public_story_links SET is_public=false, updated_at=now() WHERE slug=$1`,
        [book.slug],
      );
    }

    // 6. audit
    await client.query(
      `INSERT INTO audit_events (entity_type, entity_id, event_type, metadata)
       VALUES ('story_project', $1, 'upsert', $2)`,
      [book.slug, JSON.stringify({ ts: Date.now(), source: 'bookRegistry.saveGeneratedBook' })],
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.warn('[storyStore] upsertStory failed:', sanitizeErr(err));
    return false;
  } finally {
    client.release();
  }
}

interface AssetRow { sceneId: string | null; type: string; provider: string | null; url: string; meta: Record<string, unknown>; }

/** Pull image + audio URLs out of the book's scenes into asset rows. */
function collectAssets(book: GeneratedBook, legacyKey: string): AssetRow[] {
  const out: AssetRow[] = [];
  const seen = new Set<string>();
  const push = (a: AssetRow) => {
    const key = `${a.type}|${a.sceneId ?? ''}|${a.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...a, meta: { ...a.meta, legacy_redis_key: legacyKey } });
  };
  for (const s of book.scenes ?? []) {
    if (s.background_asset_url) {
      push({ sceneId: s.scene_id, type: 'image', provider: null, url: s.background_asset_url, meta: { field: 'background_asset_url' } });
    }
    for (const b of s.beats ?? []) {
      if (b.imageUrl) push({ sceneId: s.scene_id, type: 'image', provider: null, url: b.imageUrl, meta: { field: 'beat', beat: b.visualDescription } });
    }
    if (s.narration_audio_url) {
      push({ sceneId: s.scene_id, type: 'audio', provider: s.audio_provider ?? null, url: s.narration_audio_url, meta: { field: 'narration_audio_url' } });
    }
  }
  return out;
}

// ---- read ------------------------------------------------------------------

/** Read a book from Aurora by slug. Returns null if not found OR if
 *  Aurora is unavailable — the caller falls back to Upstash in both
 *  cases. Never throws. */
export async function getStoryBySlug(slug: string): Promise<GeneratedBook | null> {
  if (!isAuroraEnabled()) return null;

  const project = await auroraQuery<{ metadata: Record<string, unknown> | null }>(
    `SELECT metadata FROM story_projects WHERE slug=$1 AND deleted_at IS NULL`,
    [slug],
  );
  if (!project || project.rowCount === 0) return null;
  const row = project.rows[0];
  if (!row?.metadata) return null;

  // Resolve project id from the header-less row by re-querying —
  // cheaper to just fetch id alongside metadata. (Kept separate so
  // the common "miss" path above doesn't pay for it.)
  const idRes = await auroraQuery<{ id: string }>(
    `SELECT id FROM story_projects WHERE slug=$1 AND deleted_at IS NULL`, [slug],
  );
  const projectId = idRes?.rows[0]?.id;
  if (!projectId) return null;

  const [scenesRes, charsRes] = await Promise.all([
    auroraQuery<{ metadata: GeneratedScene }>(
      `SELECT metadata FROM story_scenes WHERE story_project_id=$1 ORDER BY scene_index`, [projectId],
    ),
    auroraQuery<{ visual_profile: GeneratedCharacter }>(
      `SELECT visual_profile FROM characters WHERE story_project_id=$1`, [projectId],
    ),
  ]);

  const scenes = (scenesRes?.rows ?? [])
    .map(r => r.metadata)
    .filter((s): s is GeneratedScene => !!s);
  const characters = (charsRes?.rows ?? [])
    .map(r => r.visual_profile)
    .filter((c): c is GeneratedCharacter => !!c);

  return reconstructBook(row, scenes, characters);
}

// ---- delete ----------------------------------------------------------------

/** Soft-delete a book in Aurora (set deleted_at). Never hard-deletes
 *  so the row remains as an audit trail. Best-effort, never throws. */
export async function softDeleteStory(slug: string): Promise<boolean> {
  if (!isAuroraEnabled()) return false;
  const ok = await auroraQuery(
    `UPDATE story_projects SET deleted_at=now() WHERE slug=$1 AND deleted_at IS NULL`,
    [slug],
  );
  await auroraQuery(
    `INSERT INTO audit_events (entity_type, entity_id, event_type, metadata)
     VALUES ('story_project', $1, 'deleted', $2)`,
    [slug, JSON.stringify({ ts: Date.now() })],
  );
  return !!ok && ok.rowCount > 0;
}

// ---- jobs (metadata mirror) ------------------------------------------------

/** Mirror a GenerationJob into Aurora generation_jobs. Best-effort.
 *  Redis stays the source of truth for in-flight jobs. */
export async function upsertJobMetadata(job: GenerationJob): Promise<boolean> {
  if (!isAuroraEnabled()) return false;
  // Link to story_projects by slug when possible.
  const proj = await auroraQuery<{ id: string }>(
    `SELECT id FROM story_projects WHERE slug=$1 AND deleted_at IS NULL`, [job.slug],
  );
  const projectId = proj?.rows[0]?.id ?? null;
  const ok = await auroraQuery(
    `INSERT INTO generation_jobs (id, story_project_id, job_type, status, provider, metadata, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, to_timestamp($7/1000.0), to_timestamp($8/1000.0))
     ON CONFLICT (id) DO UPDATE SET
       story_project_id=COALESCE(EXCLUDED.story_project_id, generation_jobs.story_project_id),
       job_type=EXCLUDED.job_type,
       status=EXCLUDED.status,
       provider=EXCLUDED.provider,
       metadata=EXCLUDED.metadata,
       updated_at=to_timestamp($8/1000.0)`,
    [
      job.id,
      projectId,
      job.mode,
      job.status,
      job.stylePreset ?? null,
      JSON.stringify(job),
      job.createdAt,
      job.updatedAt,
    ],
  );
  return !!ok;
}

// ---- admin / judge proof ---------------------------------------------------

export interface AuroraStats {
  enabled: boolean;
  counts: Record<string, number>;
}

/** Live row counts per table — used by /api/admin/aurora/stats to
 *  prove Aurora is genuinely in use. */
export async function getAuroraStats(): Promise<AuroraStats> {
  if (!isAuroraEnabled()) return { enabled: false, counts: {} };
  const tables = [
    'users', 'story_projects', 'story_scenes', 'characters',
    'generated_assets', 'story_versions', 'public_story_links',
    'generation_jobs', 'audit_events',
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const res = await auroraQuery<{ c: number }>(`SELECT count(*)::int AS c FROM ${t}`);
    counts[t] = res?.rows[0]?.c ?? 0;
  }
  return { enabled: true, counts };
}