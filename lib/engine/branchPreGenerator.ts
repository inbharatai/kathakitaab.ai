// ============================================================
// KathaKitaab — Branch Pre-Generation Engine
//
// When a scene loads, this engine pre-generates interaction
// branches for every entity (character, object, location).
// By the time the user clicks, the result is already cached.
//
// Flow:
//   Scene loads → fire-and-forget pregenerate call
//   → backend generates branches for all entities in parallel
//   → stores in cache
//   → user clicks → instant result from cache
// ============================================================

import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { getCanonEntry } from '@/lib/data/canonLookup';

export interface PreGeneratedBranch {
  branchId: string;
  parentSceneId: string;
  entityId: string;
  entityLabel: string;
  entityType: 'character' | 'object' | 'location' | 'animal' | 'background';
  actionType: string;
  title: string;
  narration: string;
  sceneText: string;
  imagePrompt: string;
  imageUrl: string | null;
  nextActions: string[];
  status: 'ready' | 'needs_image' | 'failed';
}

export interface BranchManifest {
  sceneId: string;
  bookId: string;
  branches: PreGeneratedBranch[];
  generatedAt: number;
  status: 'ready' | 'partial' | 'failed';
}

// "continue" is scene navigation, not a branch. The pre-gen pipeline
// must skip it — pre-generating a "continue" branch would burn API
// credit on an interaction that never produces narration.
const NAV_ACTIONS = new Set(['continue', 'next', 'back']);

// Default action archetypes per entity kind, used when canon doesn't
// list explicit allowed_actions OR for non-canon discovered entities.
// Top-2 most-likely verbs — keeps pre-gen cost capped at 2× per entity.
const DEFAULT_ACTIONS_BY_TYPE: Record<string, string[]> = {
  character:  ['talk', 'observe'],
  object:     ['inspect', 'observe'],
  location:   ['move', 'observe'],
  place:      ['move', 'observe'],
  animal:     ['observe', 'comfort'],
  background: ['observe'],
};

const PREGEN_ACTIONS_PER_ENTITY = 2;

/**
 * Decide which actions to pre-generate for one entity. Order:
 *   1. Canon's allowed_actions (filtered for nav verbs), capped at top-2.
 *   2. If canon lists fewer than 2, pad with type defaults.
 *   3. If no canon entry, fall back to type defaults.
 *
 * Returning a stable, lowercased list — the same call yields the same
 * cache keys across requests so warm hits never miss.
 */
export function getPregenActions(
  bookSlug: string,
  entityId: string,
  entityType: string,
): string[] {
  const canon = getCanonEntry(bookSlug, entityId);
  const canonical = (canon?.allowed_actions ?? [])
    .map(a => a.toLowerCase())
    .filter(a => !NAV_ACTIONS.has(a));

  const defaults = (DEFAULT_ACTIONS_BY_TYPE[entityType.toLowerCase()] ?? DEFAULT_ACTIONS_BY_TYPE.background)
    .map(a => a.toLowerCase());

  const merged: string[] = [];
  for (const a of [...canonical, ...defaults]) {
    if (merged.length >= PREGEN_ACTIONS_PER_ENTITY) break;
    if (!merged.includes(a)) merged.push(a);
  }
  return merged;
}

// ── Per-(scene, entity, action) cache keys ───────────────────
// The action component is what fixes the Talk-vs-Fight collision:
// each verb gets its own warmed branch, so the first click of either
// verb hits a cache instead of generating fresh.

export function getBranchCacheKey(
  sceneId: string,
  entityId: string,
  actionType: string = 'auto',
): string {
  return buildCacheKey({
    type: 'entity-branch',
    sceneId,
    entityId,
    actionType: actionType.toLowerCase(),
  });
}

export async function getCachedBranch(
  sceneId: string,
  entityId: string,
  actionType: string = 'auto',
): Promise<PreGeneratedBranch | null> {
  const key = getBranchCacheKey(sceneId, entityId, actionType);
  return (await getCachedResponse(key)) as PreGeneratedBranch | null;
}

export async function saveCachedBranch(
  sceneId: string,
  entityId: string,
  actionType: string,
  branch: PreGeneratedBranch,
): Promise<void> {
  const key = getBranchCacheKey(sceneId, entityId, actionType);
  await setCachedResponse(key, branch, 'pre-gen');
}

// ── Get manifest from cache ──────────────────────────────────

export async function getManifest(sceneId: string): Promise<BranchManifest | null> {
  const key = buildCacheKey({ type: 'manifest', sceneId });
  return (await getCachedResponse(key)) as BranchManifest | null;
}

export async function saveManifest(manifest: BranchManifest): Promise<void> {
  const key = buildCacheKey({ type: 'manifest', sceneId: manifest.sceneId });
  await setCachedResponse(key, manifest, 'manifest');
}
