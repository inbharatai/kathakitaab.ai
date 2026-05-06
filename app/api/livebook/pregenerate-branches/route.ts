// ============================================================
// KathaKitaab.ai — Pre-Generate Branches API
// POST /api/livebook/pregenerate-branches
//
// Called when a scene loads. Generates interaction branches
// for ALL entities in the scene in parallel.
// Results are cached — when user clicks, it's instant.
//
// This is the difference between "click and wait 20 seconds"
// and "click and it's already there."
// ============================================================

import { NextResponse } from 'next/server';
import { generateBranch } from '@/lib/agents/branchAgent';
import { checkRateLimit, runInBatches, MAX_PARALLEL_BRANCHES } from '@/lib/middleware/rateLimit';
import {
  getCachedBranch, saveCachedBranch, saveManifest, getManifest, getPregenActions,
  type PreGeneratedBranch, type BranchManifest,
} from '@/lib/engine/branchPreGenerator';

interface Entity {
  entityId: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

// One pre-gen unit of work — a specific (entity, action) pair.
// Splitting this out lets us cache and parallelize at the verb level
// so a "Talk Rama" warm hit never blocks a "Move Rama" miss.
interface PregenJob {
  entity: Entity;
  action: string;
}

interface PregenerateRequest {
  bookSlug: string;
  bookTitle: string;
  sceneId: string;
  sceneTitle: string;
  sceneNarration: string;
  entities: Entity[];
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  try {
    const body: PregenerateRequest = await request.json();
    const { bookSlug, bookTitle, sceneId, sceneTitle, sceneNarration, entities } = body;

    if (!entities || entities.length === 0) {
      return NextResponse.json({ status: 'no_entities', branches: [] });
    }

    // Check if manifest already exists
    const existing = await getManifest(sceneId);
    if (existing && existing.status === 'ready') {
      return NextResponse.json({ status: 'cached', manifest: existing });
    }

    // Cap total entities at 8 and expand each into (entity × top-2
    // canon-allowed actions). This is the fix for the "Talk vs Fight"
    // collision: each verb gets its own warmed branch keyed by action,
    // so the first click of either action hits cache instead of paying
    // for fresh generation. Cost ceiling: 2× per entity → at most 16
    // branches per scene, throttled to MAX_PARALLEL_BRANCHES (default 2).
    const jobs: PregenJob[] = entities.slice(0, 8).flatMap(entity => {
      const actions = getPregenActions(bookSlug, entity.entityId, entity.type);
      return actions.map(action => ({ entity, action }));
    });

    const branches = await runInBatches(
      jobs,
      MAX_PARALLEL_BRANCHES,
      async ({ entity, action }: PregenJob): Promise<PreGeneratedBranch> => {
        const cached = await getCachedBranch(sceneId, entity.entityId, action);
        if (cached) return cached;

        const branch = await generateBranch({
          bookTitle, sceneId, sceneTitle, sceneNarration,
          entityId: entity.entityId,
          entityLabel: entity.label,
          entityType: entity.type as PreGeneratedBranch['entityType'],
          action,
        });

        if (branch.status === 'ready') {
          await saveCachedBranch(sceneId, entity.entityId, action, branch);
        }
        return branch;
      },
    );

    const readyCount = branches.filter(b => b.status === 'ready').length;

    const manifest: BranchManifest = {
      sceneId,
      bookId: bookSlug,
      branches,
      generatedAt: Date.now(),
      status: readyCount === branches.length ? 'ready' : readyCount > 0 ? 'partial' : 'failed',
    };

    await saveManifest(manifest);

    return NextResponse.json({ status: manifest.status, manifest, readyCount, total: branches.length });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Pre-generation failed';
    console.error('[PreGen Error]', msg);
    return NextResponse.json({ status: 'error', error: msg }, { status: 500 });
  }
}

// Branch generation lives in `lib/agents/branchAgent.ts`. Both this
// route and LivingBookBrain delegate there so the verb-to-narration
// contract stays in one place.
