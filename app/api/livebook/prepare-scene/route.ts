// ============================================================
// KathaKitaab.ai — Prepare Scene API (Brain-Powered)
// POST /api/livebook/prepare-scene
//
// The complete brain pipeline:
//   Research → Plan → Generate Image → Detect Entities →
//   Pre-generate ALL branches → Validate → Cache → Serve
//
// Returns a scene with pre-generated branches for every entity.
// Every click is instant because branches are already ready.
// ============================================================

import { NextResponse } from 'next/server';
import { prepareScene, type BrainRequest } from '@/lib/brain/LivingBookBrain';
import type { StoryScene, SceneHotspot, SceneCharacter } from '@/lib/types/storyScene';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export async function POST(request: Request) {
  const limited = checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  try {
    const body: BrainRequest = await request.json();

    if (!body.bookTitle) {
      return NextResponse.json({ error: 'bookTitle required' }, { status: 400 });
    }

    // Run the full brain pipeline
    const result = await prepareScene(body);

    // Convert to StoryScene format for the frontend
    const hotspots: SceneHotspot[] = result.entities.map((e, i) => ({
      id: `${result.sceneId}-hs-${i}`,
      target_id: e.entityId,
      label: e.label,
      type: e.type === 'animal' ? 'object' as const : e.type === 'background' ? 'place' as const : e.type as 'character' | 'object' | 'place',
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      allowed_actions: e.type === 'character'
        ? ['talk' as const, 'move' as const, 'change' as const, 'continue' as const]
        : ['ask' as const, 'inspect' as const, 'change' as const, 'continue' as const],
      tooltip: e.label,
      quick_speak: result.branches.find(b => b.entityId === e.entityId)?.narration?.slice(0, 60),
    }));

    const characters: SceneCharacter[] = result.entities
      .filter(e => e.type === 'character')
      .map(e => ({
        id: e.entityId, name: e.label,
        x: e.x, y: e.y, width: e.width, height: e.height,
        image_url: null, pose: 'standing', mood: result.mood,
        animation: 'breathe' as const,
        click_actions: ['talk' as const, 'move' as const, 'change' as const, 'continue' as const],
        character_slug: e.entityId,
      }));

    const scene: StoryScene = {
      scene_id: result.sceneId,
      story_id: result.bookId,
      page_title: result.title,
      story_text: result.narration,
      background: { image_url: result.imageUrl, prompt: result.visualDescription },
      characters,
      objects: [],
      effects: [],
      hotspots,
      choices: [],
      world_state: {
        continuity_summary: result.continuitySummary,
        mood: result.mood,
      },
      previous_actions: [],
      safety_rating: result.safetyRating as 'child_safe' | 'teen_safe' | 'blocked',
      learning_points: result.learningPoints,
      source_notes: result.sourceNotes,
      order_index: body.sceneIndex ?? 0,
      previous_scene_id: null,
      next_scene_id: null,
      visual_description: result.visualDescription,
      quiz_questions: [],
      unverified: result.unverified,
      verification_note: result.verificationNote,
    };

    return NextResponse.json({
      scene,
      brainResult: {
        entities: result.entities,
        branchCount: result.branches.length,
        readyBranches: result.branches.filter(b => b.status === 'ready').length,
        qaReady: result.qaReady,
        qaWarnings: result.qaWarnings,
        cached: result.cached,
      },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Brain failed';
    console.error('[Brain Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
