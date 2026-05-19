// ============================================================
// KathaKitaab — Scene Registry (Redis-backed, per-scene)
//
// Stores individual scenes so generation can resume at any point.
// Each scene is keyed by `{bookSlug}:{sceneId}` and has its own
// status + asset tracking. The book registry still stores the
// assembled book JSON, but the scene registry is the source of
// truth for "which scenes are complete and which are pending."
//
// Scenes never expire (no TTL) — they are user content.
// ============================================================

import { getRedis } from '@/lib/redis';
import type { GeneratedScene, GeneratedBook, GeneratedCharacter } from '@/lib/openai/bookGeneratorAgent';

export type SceneAssetStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'stale';

export interface PersistedScene extends GeneratedScene {
  /** When this scene was last saved to the registry. */
  savedAt: number;
  /** Image generation status per scene. */
  imageStatus: SceneAssetStatus;
  /** TTS / narration audio status per scene. */
  ttsStatus: SceneAssetStatus;
  /** Error message if image generation failed. */
  imageError?: string;
  /** Error message if TTS failed. */
  ttsError?: string;
  /** Optimistic-lock version to prevent lost updates across instances. */
  version?: number;
}

const sceneKey = (bookSlug: string, sceneId: string) => `kk:scene:${bookSlug}:${sceneId}`;
const sceneIndexKey = (bookSlug: string) => `kk:scenes:${bookSlug}`;

// In-process hot cache
const memScenes = new Map<string, PersistedScene>();
const MAX_MEM_SCENES = 800;

function capMap<K, V>(map: Map<K, V>, limit: number) {
  if (map.size <= limit) return;
  const evictCount = Math.ceil(limit * 0.2);
  let i = 0;
  for (const key of map.keys()) {
    if (i >= evictCount) break;
    map.delete(key);
    i++;
  }
}

function now() {
  return Date.now();
}

/** Distributed lock for atomic read-modify-write on a Redis key.
 *  Uses SET NX EX so even if the process crashes, the lock auto-releases.
 *  Falls back to a no-op in the in-memory path. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const r = getRedis();
  if (!r) return fn();

  const lockKey = `${key}:lock`;
  const token = `lock-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const acquired = await r.set(lockKey, token, { nx: true, ex: 30 });
    if (acquired) {
      try {
        return await fn();
      } finally {
        const current = await r.get<string>(lockKey);
        if (current === token) {
          await r.del(lockKey);
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
  }
  console.warn(`[sceneRegistry] Could not acquire lock for ${key}`);
  return null;
}

/** Save a single scene to the registry. Called immediately after
 *  the scene's details are generated, and again after its image
 *  and audio are ready. */
export async function saveScene(
  bookSlug: string,
  scene: PersistedScene,
): Promise<void> {
  const key = sceneKey(bookSlug, scene.scene_id);
  const updated: PersistedScene = {
    ...scene,
    savedAt: now(),
  };

  memScenes.set(key, updated);
  capMap(memScenes, MAX_MEM_SCENES);
  const r = getRedis();
  if (r) {
    await r.set(key, updated);
    await r.sadd(sceneIndexKey(bookSlug), scene.scene_id);
  }
}

/** Save multiple scenes at once (batch after scene-details phase). */
export async function saveScenes(
  bookSlug: string,
  scenes: PersistedScene[],
): Promise<void> {
  await Promise.all(scenes.map(s => saveScene(bookSlug, s)));
}

/** Get a single scene by book slug + scene ID. */
export async function getScene(
  bookSlug: string,
  sceneId: string,
): Promise<PersistedScene | null> {
  const key = sceneKey(bookSlug, sceneId);
  const cached = memScenes.get(key);
  if (cached) return cached;

  const r = getRedis();
  if (!r) return null;
  const scene = await r.get<PersistedScene>(key);
  if (scene) {
    memScenes.set(key, scene);
  }
  return scene ?? null;
}

/** Get all scenes for a book, ordered by order_index. */
export async function getScenesByBookSlug(
  bookSlug: string,
): Promise<PersistedScene[]> {
  const r = getRedis();
  if (!r) {
    // Fallback: scan memory cache
    const out: PersistedScene[] = [];
    const prefix = sceneKey(bookSlug, '');
    for (const [key, scene] of memScenes) {
      if (key.startsWith(prefix)) {
        out.push(scene);
      }
    }
    return out.sort((a, b) => a.order_index - b.order_index);
  }

  const sceneIds = await r.smembers(sceneIndexKey(bookSlug));
  if (!sceneIds || sceneIds.length === 0) return [];

  const scenes = await Promise.all(
    sceneIds.map(id => getScene(bookSlug, id).catch(() => null)),
  );

  return scenes
    .filter((s): s is PersistedScene => s !== null)
    .sort((a, b) => a.order_index - b.order_index);
}

/** Update a specific field on a scene (e.g., mark image as completed
 *  after generation succeeds, or mark TTS as stale after text edit).
 *  Uses a distributed lock to prevent lost updates across serverless instances. */
export async function updateScene(
  bookSlug: string,
  sceneId: string,
  updates: Partial<Omit<PersistedScene, 'scene_id' | 'order_index'>>,
): Promise<PersistedScene | null> {
  const key = sceneKey(bookSlug, sceneId);
  return withLock(key, async () => {
    const existing = await getScene(bookSlug, sceneId);
    if (!existing) return null;

    const updated: PersistedScene = {
      ...existing,
      ...updates,
      savedAt: now(),
      version: (existing.version ?? 0) + 1,
    };

    await saveScene(bookSlug, updated);
    return updated;
  });
}

/** Mark a scene's image as completed and store the URL. */
export async function markSceneImageComplete(
  bookSlug: string,
  sceneId: string,
  imageUrl: string,
  beats?: PersistedScene['beats'],
): Promise<PersistedScene | null> {
  return updateScene(bookSlug, sceneId, {
    background_asset_url: imageUrl,
    imageStatus: 'completed',
    beats,
    imageError: undefined,
  });
}

/** Mark a scene's image as failed. */
export async function markSceneImageFailed(
  bookSlug: string,
  sceneId: string,
  error: string,
): Promise<PersistedScene | null> {
  return updateScene(bookSlug, sceneId, {
    imageStatus: 'failed',
    imageError: error,
  });
}

/** Mark a scene's TTS as completed and store the audio URL. */
export async function markSceneTTSComplete(
  bookSlug: string,
  sceneId: string,
  audioUrl: string,
  provider: 'sarvam' | 'gemini' | 'failed',
): Promise<PersistedScene | null> {
  return updateScene(bookSlug, sceneId, {
    narration_audio_url: audioUrl,
    audio_provider: provider,
    ttsStatus: 'completed',
    ttsError: undefined,
  });
}

/** Mark a scene's TTS as failed. */
export async function markSceneTTSFailed(
  bookSlug: string,
  sceneId: string,
  error: string,
): Promise<PersistedScene | null> {
  return updateScene(bookSlug, sceneId, {
    ttsStatus: 'failed',
    ttsError: error,
  });
}

/** Mark a scene as stale after its text was edited (so downstream
 *  image/audio can be regenerated). */
export async function markSceneStale(
  bookSlug: string,
  sceneId: string,
): Promise<PersistedScene | null> {
  return updateScene(bookSlug, sceneId, {
    imageStatus: 'stale',
    ttsStatus: 'stale',
  });
}

/** Delete all scenes for a book (used when user deletes the draft).
 *  Uses MULTI/EXEC so a concurrent saveScene cannot orphan keys. */
export async function deleteScenesForBook(bookSlug: string): Promise<void> {
  const r = getRedis();
  if (!r) {
    // Memory fallback: scan and delete matching keys
    const prefix = sceneKey(bookSlug, '');
    for (const key of memScenes.keys()) {
      if (key.startsWith(prefix)) {
        memScenes.delete(key);
      }
    }
    return;
  }

  const sceneIds = await r.smembers(sceneIndexKey(bookSlug));
  if (!sceneIds || sceneIds.length === 0) return;

  const keys = sceneIds.map(id => sceneKey(bookSlug, id));
  const pipeline = r.multi();
  pipeline.del(...keys);
  pipeline.del(sceneIndexKey(bookSlug));
  await pipeline.exec();
}

/** Build a GeneratedBook from persisted scenes. Used when resuming
 *  or when the user wants to preview a partially-completed book. */
export async function assembleBookFromScenes(
  bookSlug: string,
  base: Pick<GeneratedBook, 'id' | 'slug' | 'title' | 'subtitle' | 'description' | 'source_tradition' | 'characters' | 'generatedAt' | 'accuracyLabel' | 'qualityScore' | 'mode' | 'ownerId' | 'visibility' | 'metadata' | 'stylePreset'>,
): Promise<GeneratedBook | null> {
  const scenes = await getScenesByBookSlug(bookSlug);
  if (scenes.length === 0) return null;

  return {
    ...base,
    scenes: scenes.map(s => {
      // Strip registry-only fields before returning
      const { savedAt: _sa, imageStatus: _is, ttsStatus: _ts, imageError: _ie, ttsError: _te, ...rest } = s;
      void _sa; void _is; void _ts; void _ie; void _te;
      return rest;
    }),
  };
}

/** Count how many scenes have completed images / TTS. Used for
 *  progress calculation on the My Creations page. */
export async function countSceneAssets(
  bookSlug: string,
): Promise<{ total: number; imagesDone: number; ttsDone: number }> {
  const scenes = await getScenesByBookSlug(bookSlug);
  return {
    total: scenes.length,
    imagesDone: scenes.filter(s => s.imageStatus === 'completed').length,
    ttsDone: scenes.filter(s => s.ttsStatus === 'completed').length,
  };
}

// ── Book-level character persistence (needed for resume) ──

const charactersKey = (bookSlug: string) => `kk:book:${bookSlug}:characters`;

/** Save the character roster so a resumed generation can reconstruct
 *  image prompts and canon references even when the full book JSON
 *  was never saved (e.g., image-generation step failed). */
export async function saveBookCharacters(
  bookSlug: string,
  characters: GeneratedCharacter[],
): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.set(charactersKey(bookSlug), characters);
  }
}

/** Load the character roster saved during the outline phase. */
export async function getBookCharacters(
  bookSlug: string,
): Promise<GeneratedCharacter[] | null> {
  const r = getRedis();
  if (!r) return null;
  return r.get<GeneratedCharacter[]>(charactersKey(bookSlug));
}

/** Delete the character roster for a book. Called when the book is
 *  deleted so Redis doesn't leak orphaned character keys. */
export async function deleteBookCharacters(bookSlug: string): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.del(charactersKey(bookSlug));
  }
}
