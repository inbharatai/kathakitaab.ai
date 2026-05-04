// ============================================================
// KathaKitaab.ai — Branch Pre-Generation Engine
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

// ── Check if a branch is already cached ──────────────────────

export function getBranchCacheKey(sceneId: string, entityId: string): string {
  return buildCacheKey({ type: 'entity-branch', sceneId, entityId });
}

export function getCachedBranch(sceneId: string, entityId: string): PreGeneratedBranch | null {
  const key = getBranchCacheKey(sceneId, entityId);
  return getCachedResponse(key) as PreGeneratedBranch | null;
}

export function saveCachedBranch(sceneId: string, entityId: string, branch: PreGeneratedBranch): void {
  const key = getBranchCacheKey(sceneId, entityId);
  setCachedResponse(key, branch, 'pre-gen');
}

// ── Get manifest from cache ──────────────────────────────────

export function getManifest(sceneId: string): BranchManifest | null {
  const key = buildCacheKey({ type: 'manifest', sceneId });
  return getCachedResponse(key) as BranchManifest | null;
}

export function saveManifest(manifest: BranchManifest): void {
  const key = buildCacheKey({ type: 'manifest', sceneId: manifest.sceneId });
  setCachedResponse(key, manifest, 'manifest');
}
