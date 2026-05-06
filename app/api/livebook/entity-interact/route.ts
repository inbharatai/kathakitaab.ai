// ============================================================
// KathaKitaab.ai — Entity Interaction API
// POST /api/livebook/entity-interact
//
// When user clicks a character, object, or location:
//   1. Generate context-aware interaction (text + narration)
//   2. Generate a new image for the interaction
//   3. Return branch data for the scene graph
//
// Uses OpenAI (primary) or Gemini (fallback)
// ============================================================

import { NextResponse, after } from 'next/server';
import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';
import { generateSceneImage } from '@/lib/agents/visualAgent';
import { checkContentSafety } from '@/lib/agents/safetyAgent';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { getCachedBranch, getManifest } from '@/lib/engine/branchPreGenerator';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { buildCanonPromptFragment } from '@/lib/data/canonLookup';
import { startBranchImageJob } from '@/lib/engine/branchImageJobs';

// gpt-image-1 cold gens regularly run 25-45s. Vercel's default 10s
// (Hobby) and 60s (Pro Node) gates would kill the background image
// job before it finishes, so request the longest the platform allows.
// On Hobby, drop this to 60 manually if needed.
export const maxDuration = 300;

interface EntityInteractRequest {
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
   * What the user *did* to this entity — talk / move / fight / leap /
   * confront / observe / inspect / ask / continue. Locks the cache key
   * so different actions on the same entity don't collide. Universal
   * — the canon registry decides which set is valid per character/role
   * (see allowed_actions on CanonEntry); this field just records the
   * user's choice. Optional for back-compat with older clients.
   */
  actionType?: string;
  /** Narrative theme — same universal axis used by generate-scene. */
  theme?: string;
}

const PROMPTS: Record<string, string> = {
  character: `The user clicked on the character "{label}" in the scene "{sceneTitle}".
Generate a rich interactive moment from this character's perspective.
Include their inner thoughts, a short dialogue, and what they do next.
Make it emotional, cinematic, and faithful to the source material.`,

  object: `The user clicked on the object "{label}" in the scene "{sceneTitle}".
Generate an interesting detail about this object — its history, significance, and what it reveals about the story.
Make it feel like discovering a hidden detail in a game.`,

  location: `The user clicked on the location "{label}" in the scene "{sceneTitle}".
Generate a vivid description of this place and what the user discovers by exploring it.
Include atmospheric details, hidden elements, and a sense of walking into the location.`,

  background: `The user clicked on the background of the scene "{sceneTitle}" near "{label}".
Generate an atmospheric detail — what the user notices, hears, or discovers in this part of the scene.
Make it feel like the world is alive and responsive to exploration.`,
};

// Universal action vocabulary. The verb the user clicks shapes the
// *kind* of moment we generate — without this, every click on a
// character collapses to "introspective dialogue", regardless of
// whether they tapped 'talk' or 'fight'. Unknown verbs (rare books
// with novel canon vocab) fall through to the entityType prompt.
const ACTION_GUIDANCE: Record<string, string> = {
  talk: 'Frame this as a spoken exchange — the user addresses the character; render their reply as a short cinematic line plus inner thought.',
  move: 'Frame this as movement — the character leads the user a few steps toward something significant; describe what they pass and arrive at.',
  leap: 'Frame this as a powerful leap or flight — describe the launch, what the character sees in motion, and where they land.',
  fight: 'Frame this as a controlled, age-appropriate combat moment — strikes, courage under pressure, no graphic violence; resolve quickly.',
  confront: 'Frame this as a tense confrontation — the user challenges the character; render the verbal exchange and the unspoken stakes.',
  observe: 'Frame this as quiet observation — the user watches without engaging; render what is noticed, with no dialogue.',
  comfort: 'Frame this as a moment of comfort — the user reaches out; render a small grounding gesture and the character\'s soft reply.',
  guard: 'Frame this as a protective stance — the character shields someone or something; render the readiness and the silent vow.',
  counsel: 'Frame this as receiving counsel — the character offers a brief teaching or warning; render it as memorable parable-like advice.',
  ally: 'Frame this as forging or affirming an alliance — render the pledge, the gesture sealing it, and the new shared intent.',
  learn: 'Frame this as receiving teaching — the character imparts a lesson; render the lesson and the moment of recognition.',
  petition: 'Frame this as a petition or plea — the user asks something hard; render the response weighing duty against feeling.',
  honor: 'Frame this as an act of honoring — render the gesture (touching feet, offering, silent bow) and what it means to both.',
  follow: 'Frame this as following — the character moves and the user trails; render what is glimpsed along the way.',
  inspect: 'Frame this as close inspection of an object or detail — render what is noticed up close that was invisible from afar.',
  ask: 'Frame this as the user asking a question — render the answer with one vivid concrete detail.',
};

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  try {
    if (!isOpenAIConfigured() && !isGeminiConfigured()) {
      return NextResponse.json({ error: 'No AI configured' }, { status: 503 });
    }

    const body: EntityInteractRequest = await request.json();
    const { bookTitle, sceneId, sceneTitle, sceneNarration, entityId, entityType, entityLabel, characterNames } = body;
    // Normalise the action axis. Older clients won't send this — we
    // default to a sentinel ("auto") so the cache key shape is stable.
    const actionType = (body.actionType || 'auto').toLowerCase();
    const theme = body.theme;

    // Helper: any cached/pre-gen branch may have arrived without an
    // image (pregenerate-branches deliberately leaves `imageUrl: null`
    // to save cost). When that happens we still want the client to
    // poll for a freshly generated image — so attach a `branchId` and
    // set `imageStatus: 'pending'`, then kick off the background job
    // through `after()` exactly like the fresh-generation path does.
    const ensureImageJob = (
      base: { title: string; narration: string; sceneText: string; imagePrompt: string; imageUrl: string | null; nextActions: string[] },
    ) => {
      if (base.imageUrl) {
        // Already has an image — no polling needed.
        return { ...base, branchId: undefined, imageStatus: 'none' as const };
      }
      const branchId = `${sceneId}__${entityId}__${Date.now().toString(36)}`;
      if (base.imagePrompt) {
        const focusEntity = entityLabel;
        const canonCharacters = Array.from(new Set([focusEntity, ...characterNames]));
        after(async () => {
          // Return the promise so Vercel's waitUntil keeps the function
          // alive until image gen + Redis write both finish. Otherwise
          // the job entry stays "pending" forever in Redis.
          await startBranchImageJob(branchId, () => generateSceneImage(base.imagePrompt, {
            bookSlug: body.bookSlug,
            characters: canonCharacters,
            mood: 'serene',
            theme,
          }));
        });
        return { ...base, branchId, imageStatus: 'pending' as const };
      }
      return { ...base, branchId: undefined, imageStatus: 'none' as const };
    };

    // Check pre-generated branch cache (from brain or pregenerate-branches).
    // Look up by the user's chosen action so a "Talk Rama" hit doesn't
    // pull a "Move Rama" cached narration. Falls back to action='auto'
    // for compatibility with branches saved before per-action pre-gen.
    for (const sid of [sceneId, `brain-${body.bookSlug}`]) {
      const preGen = await getCachedBranch(sid, entityId, actionType)
        ?? await getCachedBranch(sid, entityId, 'auto');
      if (preGen && preGen.status === 'ready' && preGen.narration) {
        return NextResponse.json(ensureImageJob({
          title: preGen.title,
          narration: preGen.narration,
          sceneText: preGen.sceneText,
          imagePrompt: preGen.imagePrompt,
          imageUrl: preGen.imageUrl,
          nextActions: preGen.nextActions,
        }));
      }
      const manifest = await getManifest(sid);
      if (manifest) {
        const mb = manifest.branches.find(b => b.entityId === entityId && b.status === 'ready' && b.narration);
        if (mb) {
          return NextResponse.json(ensureImageJob({
            title: mb.title, narration: mb.narration, sceneText: mb.sceneText,
            imagePrompt: mb.imagePrompt, imageUrl: mb.imageUrl, nextActions: mb.nextActions,
          }));
        }
      }
    }

    // Also check the content-level cache (brain uses this key format)
    const brainKey = buildCacheKey({ type: 'entity-branch-content', book: body.bookTitle, scene: body.sceneTitle, entity: entityId });
    const brainCached = await getCachedResponse(brainKey);
    if (brainCached && typeof brainCached === 'object' && (brainCached as Record<string, unknown>).narration) {
      const bc = brainCached as Record<string, unknown>;
      return NextResponse.json(ensureImageJob({
        title: bc.title as string,
        narration: bc.narration as string,
        sceneText: bc.sceneText as string,
        imagePrompt: bc.imagePrompt as string,
        imageUrl: (bc.imageUrl as string | null) ?? null,
        nextActions: (bc.nextActions as string[]) ?? [],
      }));
    }

    // Check regular cache. Key now includes bookSlug + actionType +
    // theme so a "talk to Rama" hit doesn't collide with "fight Rama"
    // or with the same beat retold under a different motif. This is
    // what makes warm hits feel right — same intent → same cached
    // response — without bleeding semantics across actions.
    const cacheKey = buildCacheKey({
      type: 'entity',
      bookSlug: body.bookSlug,
      sceneId,
      entityId,
      entityType,
      actionType,
      theme: theme || 'none',
    });
    const cached = await getCachedResponse(cacheKey);
    if (cached) return NextResponse.json(cached);

    // Build prompt — base prompt by entity type, then layer the
    // action guidance so the user's verb actually shapes the output.
    const template = PROMPTS[entityType] || PROMPTS.background;
    const actionLine = ACTION_GUIDANCE[actionType];
    const prompt = [
      template
        .replace('{label}', entityLabel)
        .replace('{sceneTitle}', sceneTitle),
      actionLine ? `Action verb: "${actionType}". ${actionLine}` : '',
    ].filter(Boolean).join('\n\n');

    // Inject canonical context if this entity exists in the per-book
    // canon registry. For books without a canon file or for entities
    // not found, this returns '' and we fall back to scene context.
    const canonFragment = buildCanonPromptFragment(body.bookSlug, entityId)
      || buildCanonPromptFragment(body.bookSlug, entityLabel);

    const systemPrompt = `You are a living story engine for "${bookTitle}". The user is exploring an interactive scene.
Generate a short, vivid interactive moment. Respond with valid JSON:
{
  "title": "short title for this moment",
  "narration": "2-3 sentences spoken aloud by the narrator or character (warm, cinematic)",
  "sceneText": "1 paragraph of rich descriptive text",
  "imagePrompt": "detailed visual description for generating an illustration of this moment",
  "nextActions": ["3 short follow-up actions the user could take"]
}
Keep it respectful, age-appropriate, and grounded in the story's source material.
Characters present: ${characterNames.join(', ')}
Scene context: ${sceneNarration.slice(0, 300)}${canonFragment ? `\n\n${canonFragment}` : ''}`;

    let result: { title: string; narration: string; sceneText: string; imagePrompt: string; nextActions: string[] };

    // Try OpenAI
    if (isOpenAIConfigured()) {
      try {
        const client = getOpenAIClient();
        const completion = await client.chat.completions.create({
          model: getOpenAIModel(),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.8,
          max_tokens: 800,
        });
        result = JSON.parse(completion.choices[0]?.message?.content || '{}');
      } catch {
        // Fall through to Gemini
        result = await generateWithGemini(systemPrompt, prompt);
      }
    } else {
      result = await generateWithGemini(systemPrompt, prompt);
    }

    // Safety check
    const safety = checkContentSafety(result.narration + ' ' + result.sceneText);
    if (!safety.passed) {
      return NextResponse.json({ error: 'Content blocked by safety filter' }, { status: 422 });
    }

    // Branch ID — used by the client to poll /branch-image while
    // the gpt-image-1 call (~25s) runs in the background. The text
    // ships immediately so narration can start playing.
    const branchId = `${sceneId}__${entityId}__${Date.now().toString(36)}`;

    if (result.imagePrompt) {
      // Pass canon context so visualPromptBuilder injects the locked
      // appearance for every named character (Rama looks like Rama).
      const focusEntity = entityLabel; // the clicked thing — anchor it
      const canonCharacters = Array.from(new Set([focusEntity, ...characterNames]));
      // `after()` keeps the serverless function alive past the response
      // (Vercel routes this through waitUntil). On long-running Node
      // hosts it's a no-op wrapper — the promise just runs as before.
      // Must return the promise so waitUntil knows when we're done.
      after(async () => {
        await startBranchImageJob(branchId, () => generateSceneImage(result.imagePrompt, {
          bookSlug: body.bookSlug,
          characters: canonCharacters,
          mood: 'serene',
          theme,
        }));
      });
    }

    const response = {
      branchId,
      title: result.title || entityLabel,
      narration: result.narration || '',
      sceneText: result.sceneText || '',
      imagePrompt: result.imagePrompt || '',
      imageUrl: null as string | null,
      imageStatus: result.imagePrompt ? 'pending' : 'none',
      nextActions: result.nextActions || [],
    };

    // Cache the text-only response. The client refreshes the image
    // via /branch-image polling, so a cached text replay still feels
    // alive (it'll re-trigger image gen via a fresh branchId on miss).
    await setCachedResponse(cacheKey, response, 'entity-interact');

    return NextResponse.json(response);

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Entity Interact Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function generateWithGemini(systemPrompt: string, userPrompt: string) {
  const ai = getGeminiClient();
  const model = getTextModel();
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: { systemInstruction: systemPrompt, temperature: 0.8, maxOutputTokens: 1000, responseMimeType: 'application/json' },
  });
  return JSON.parse(res.text || '{}');
}
