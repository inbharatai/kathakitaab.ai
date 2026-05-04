// ============================================================
// KathaKitaab.ai — Entity Interaction Engine
//
// When user clicks a character, object, or location on the scene:
//   1. Check scene graph for cached branch
//   2. If not cached: generate new branch (text + image + narration)
//   3. Add to scene graph
//   4. Trigger narration
//   5. Return the branch for display
//
// This is the core of "click anything → something happens"
// ============================================================

import { getBranch, addBranch, markEntityDiscovered, type SceneBranch } from './sceneGraph';
import { onEntityInteraction } from './narrationManager';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { getCachedBranch } from './branchPreGenerator';

export interface EntityClickContext {
  bookSlug: string;
  bookTitle: string;
  sceneId: string;
  sceneTitle: string;
  sceneNarration: string;
  entityId: string;
  entityType: 'character' | 'object' | 'location' | 'background';
  entityLabel: string;
  characterNames: string[];
  /**
   * The verb the user clicked — talk / leap / fight / confront /
   * observe / inspect / etc. Optional for back-compat. Threaded into
   * the cache key so the same entity yields different responses for
   * different actions, instead of every action collapsing to one
   * cached "default" reply.
   */
  actionType?: string;
  /** Narrative theme — universal axis used by generate-scene + image. */
  theme?: string;
}

export interface EntityInteractionResult {
  branch: SceneBranch;
  cached: boolean;
  imageGenerating: boolean;
  /** Resolves with the generated image URL once the background job
   * finishes, or null if it failed. Undefined if no image was queued. */
  imagePromise?: Promise<string | null>;
}

/**
 * Poll /api/livebook/branch-image for the given branch until it
 * resolves (ready/failed/unknown) or the timeout elapses. Returns
 * the imageUrl on success, null on failure.
 */
export async function pollBranchImage(
  branchId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`/api/livebook/branch-image?branchId=${encodeURIComponent(branchId)}`);
      if (res.ok) {
        const data = (await res.json()) as { status: string; imageUrl?: string };
        if (data.status === 'ready' && data.imageUrl) return data.imageUrl;
        if (data.status === 'failed') return null;
      } else if (res.status === 404) {
        // Job was swept or never created — give up.
        return null;
      }
    } catch { /* network blip — keep polling */ }
    await new Promise(r => setTimeout(r, interval));
  }
  return null;
}

/**
 * Handle a click on any entity in the scene.
 * Returns a branch with narration, text, and optional image.
 */
export async function handleEntityClick(
  ctx: EntityClickContext,
): Promise<EntityInteractionResult> {
  // 1. Check scene graph cache
  const existing = getBranch(ctx.sceneId, ctx.entityId);
  if (existing) {
    existing.visited = true;
    onEntityInteraction(existing.narration, getVoiceForEntity(ctx));
    return { branch: existing, cached: true, imageGenerating: false };
  }

  // 2. Check pre-generated branch cache (from pregenerate-branches API)
  const preGenBranch = await getCachedBranch(ctx.sceneId, ctx.entityId);
  if (preGenBranch && preGenBranch.status === 'ready' && preGenBranch.narration) {
    const branch: SceneBranch = {
      id: preGenBranch.branchId,
      parentSceneId: preGenBranch.parentSceneId,
      entityId: preGenBranch.entityId,
      entityType: preGenBranch.entityType as SceneBranch['entityType'],
      entityLabel: preGenBranch.entityLabel,
      title: preGenBranch.title,
      narration: preGenBranch.narration,
      imageUrl: preGenBranch.imageUrl,
      imagePrompt: preGenBranch.imagePrompt,
      nextActions: preGenBranch.nextActions,
      createdAt: Date.now(),
      visited: true,
    };
    addBranch(ctx.sceneId, branch);
    markEntityDiscovered(ctx.sceneId, ctx.entityId);
    onEntityInteraction(branch.narration, getVoiceForEntity(ctx));
    return { branch, cached: true, imageGenerating: false };
  }

  // 3. Check response cache. Cache key shape now matches the server's
  // entity-interact key so client + server stay coherent: same intent
  // → same cached response, different intent → different bucket.
  const cacheKey = buildCacheKey({
    type: 'entity-branch',
    bookSlug: ctx.bookSlug,
    sceneId: ctx.sceneId,
    entityId: ctx.entityId,
    entityType: ctx.entityType,
    actionType: (ctx.actionType || 'auto').toLowerCase(),
    theme: ctx.theme || 'none',
  });
  const cachedBranch = (await getCachedResponse(cacheKey)) as SceneBranch | null;
  if (cachedBranch) {
    addBranch(ctx.sceneId, cachedBranch);
    markEntityDiscovered(ctx.sceneId, ctx.entityId);
    onEntityInteraction(cachedBranch.narration, getVoiceForEntity(ctx));
    return { branch: cachedBranch, cached: true, imageGenerating: false };
  }

  // 3. Generate new branch via API
  const res = await fetch('/api/livebook/entity-interact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ctx),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to generate interaction');
  }

  const data = await res.json() as {
    branchId?: string;
    title: string;
    narration: string;
    imageUrl?: string | null;
    imagePrompt?: string;
    imageStatus?: 'pending' | 'none';
    nextActions?: string[];
  };
  const branch: SceneBranch = {
    id: data.branchId ?? `branch-${ctx.sceneId}-${ctx.entityId}-${Date.now()}`,
    parentSceneId: ctx.sceneId,
    entityId: ctx.entityId,
    entityType: ctx.entityType,
    entityLabel: ctx.entityLabel,
    title: data.title,
    narration: data.narration,
    imageUrl: data.imageUrl || null,
    imagePrompt: data.imagePrompt || '',
    nextActions: data.nextActions || [],
    createdAt: Date.now(),
    visited: true,
  };

  // 4. Save to graph + cache
  addBranch(ctx.sceneId, branch);
  markEntityDiscovered(ctx.sceneId, ctx.entityId);
  await setCachedResponse(cacheKey, branch, 'entity-interaction');

  // 5. Trigger narration immediately — image keeps generating in
  // the background and the caller polls /branch-image to swap it in.
  onEntityInteraction(branch.narration, getVoiceForEntity(ctx));

  const imagePending = data.imageStatus === 'pending' && !!data.branchId;
  return {
    branch,
    cached: false,
    imageGenerating: imagePending,
    imagePromise: imagePending ? pollBranchImage(data.branchId!) : undefined,
  };
}

function getVoiceForEntity(ctx: EntityClickContext): string {
  if (ctx.entityType !== 'character') return 'narration';
  const name = ctx.entityLabel.toLowerCase();
  if (['rama', 'lakshmana', 'bharata', 'hanuman', 'sugriva'].includes(name)) return 'male_character';
  if (['sita'].includes(name)) return 'female_character';
  if (['ravana'].includes(name)) return 'villain';
  if (['vishwamitra', 'dasharatha', 'janaka', 'vashishtha'].includes(name)) return 'sage';
  return 'narration';
}
