// ============================================================
// KathaKitaab — Dynamic Scene Generator
// POST /api/livebook/generate-scene
//
// Pipeline:
//   1. Check prefetch cache (instant if pre-generated)
//   2. Research Agent → web-grounded source material
//   3. Story Director → narrative + visual description + hotspots
//   4. Safety Agent → content validation
//   5. Visual Agent → scene background image
//   6. Vision Agent → verify hotspot positions against image
//   7. Assemble StoryScene with verified hotspots
// ============================================================

import { NextResponse } from 'next/server';
import { generateScene, type StoryDirectorContext } from '@/lib/agents/storyDirector';
import { getCanonEntry } from '@/lib/data/canonLookup';
import type { HotspotClickAction, CharacterClickAction, ObjectClickAction } from '@/lib/types/storyScene';
import { generateSceneImage } from '@/lib/agents/visualAgent';
import { analyzeImageForTargets } from '@/lib/agents/visionAgent';
import { checkContentSafety } from '@/lib/agents/safetyAgent';
import { researchTopic } from '@/lib/agents/researchAgent';
import { isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { isGeminiConfigured } from '@/lib/openai/client';
import { getCachedResponse, setCachedResponse, buildCacheKey } from '@/lib/cache/responseCache';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getBookStylePreset } from '@/lib/data/bookStyle';
import { sanitiseFields } from '@/lib/safety/promptInjectionGuard';
import type { StoryScene, SceneHotspot, SceneCharacter, SceneObject } from '@/lib/types/storyScene';

interface GenerateSceneRequest {
  bookSlug: string;
  bookTitle: string;
  bookDescription?: string;
  previousSceneId?: string;
  previousSceneTitle?: string;
  previousSceneText?: string;
  previousSceneSummary?: string;
  characterNames?: string[];
  userInstruction?: string;
  actionType?: 'continue' | 'change' | 'branch' | 'generate';
  worldStateSummary?: string;
  sceneIndex?: number;
  /** Optional narrative motif (duty / courage / sacrifice / devotion /
   * loss / love / betrayal / hope / wonder / fear / redemption, plus
   * tradition-specific aliases like dharma / bhakti / karma / hubris).
   * Universal — any book may pass any string. Unrecognised values are
   * silently ignored at the visual layer. */
  theme?: string;
  // Game loop fields
  characterBonds?: Record<string, { level: number; label: string }>;
  userChoices?: string[];
  previousActions?: string[];
  // Visual consistency
  visualBible?: {
    art_style?: string;
    character_descriptions?: Record<string, string>;
    color_palette?: string[];
  };
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  // Generating fresh scenes runs gpt-4o-mini + gpt-image-1 + safety
  // checks — all paid OpenAI calls. Anonymous reading is free; any
  // dynamic generation requires sign-in regardless of which book.
  const session = await getSessionFromRouteRequest(request);
  if (!session) {
    return NextResponse.json({
      error: 'Sign in to extend the story. Reading existing scenes stays free.',
      reason: 'auth_required',
    }, { status: 401 });
  }

  try {
    if (!isOpenAIConfigured() && !isGeminiConfigured()) {
      return NextResponse.json(
        { error: 'No AI API configured. Set OPENAI_API_KEY or GEMINI_API_KEY.' },
        { status: 503 },
      );
    }

    const body: GenerateSceneRequest = await request.json();

    const fieldGuard = sanitiseFields({
      bookTitle: body.bookTitle,
      bookDescription: body.bookDescription,
      previousSceneTitle: body.previousSceneTitle,
      previousSceneText: body.previousSceneText,
      previousSceneSummary: body.previousSceneSummary,
      userInstruction: body.userInstruction,
      theme: body.theme,
      worldStateSummary: body.worldStateSummary,
    });
    if (!fieldGuard.ok) {
      return NextResponse.json({ error: fieldGuard.error }, { status: fieldGuard.status });
    }
    const {
      bookTitle, bookDescription, previousSceneTitle, previousSceneText,
      previousSceneSummary, userInstruction, theme, worldStateSummary,
    } = fieldGuard.cleaned;

    const {
      bookSlug,
      previousSceneId,
      characterNames,
      actionType = 'continue',
      sceneIndex,
      characterBonds,
      userChoices,
      previousActions,
      visualBible,
    } = body;

    if (!bookTitle) {
      return NextResponse.json({ error: 'bookTitle is required' }, { status: 400 });
    }

    // ── Step 0: Check prefetch cache. Cache identity now includes the
    // theme so the same scene with a different motif (duty vs loss,
    // bhakti vs hubris) doesn't collide on the same key.
    const cacheKey = buildCacheKey({
      type: 'scene',
      bookSlug,
      previousSceneId: previousSceneId || 'start',
      actionType,
      instruction: userInstruction || 'continue',
      theme: theme || 'none',
    });
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // ── Step 1: Research (web grounding). Failures are no longer
    // silent — we surface an "unverified" badge to the reader so
    // they know the scene is an AI interpretation, not verified canon.
    const researchProviderConfigured = isOpenAIConfigured() || isGeminiConfigured();
    let sourceContext: string | undefined;
    let researchError: string | undefined;
    try {
      sourceContext = await researchTopic(bookTitle, previousSceneTitle || bookTitle);
      if (!sourceContext) researchError = 'Research returned no usable grounding.';
    } catch (err) {
      researchError = err instanceof Error ? err.message : 'Research call threw.';
    }
    const unverified = !sourceContext;
    const verificationNote = unverified
      ? (researchProviderConfigured
          ? `AI interpretation — generated without verified source material. ${researchError ?? ''}`.trim()
          : 'AI interpretation — no research provider configured. Set OPENAI_API_KEY for web-grounded scenes.')
      : undefined;

    // ── Step 2: Build consequence context from game state ──
    let consequenceContext = '';
    if (characterBonds && Object.keys(characterBonds).length > 0) {
      const bondLines = Object.entries(characterBonds)
        .filter(([, b]) => b.level > 0)
        .map(([name, b]) => `${name} (bond level ${b.level}: ${b.label})`);
      if (bondLines.length > 0) {
        consequenceContext += `Character bonds: ${bondLines.join(', ')}. Characters with stronger bonds should appear more prominently.\n`;
      }
    }
    if (userChoices && userChoices.length > 0) {
      consequenceContext += `User's recent choices: ${userChoices.slice(-5).join('; ')}. The story should reflect consequences of these choices.\n`;
    }
    if (previousActions && previousActions.length > 0) {
      consequenceContext += `Actions in previous scene: ${previousActions.slice(-5).join('; ')}.\n`;
    }

    // Merge consequence context into world state summary
    const fullWorldState = [worldStateSummary, consequenceContext, previousSceneSummary]
      .filter(Boolean)
      .join('\n');

    // ── Step 3: Story Director generates narrative ──
    const directorCtx: StoryDirectorContext = {
      bookTitle,
      bookDescription,
      previousSceneTitle,
      previousSceneText,
      previousSceneSummary,
      characterNames,
      userInstruction,
      actionType,
      worldStateSummary: fullWorldState || undefined,
      sceneIndex,
      sourceContext,
      theme,
    };

    const narrative = await generateScene(directorCtx);

    // ── Step 4: Safety check ──
    const safety = checkContentSafety(narrative.story_text + ' ' + narrative.visual_description);
    if (!safety.passed) {
      return NextResponse.json(
        { error: 'Generated content did not pass safety check', issues: safety.issues },
        { status: 422 },
      );
    }

    // ── Step 5: Generate scene image ──
    // Build visual prompt with consistency bible if available
    let visualPrompt = narrative.visual_description;
    if (visualBible?.art_style) {
      visualPrompt = `Style: ${visualBible.art_style}. ${visualPrompt}`;
    }
    if (visualBible?.color_palette?.length) {
      visualPrompt += ` Color palette: ${visualBible.color_palette.join(', ')}.`;
    }

    // Pass canon context so character appearance + book style auto-inject.
    // Resolve the book's stylePreset so on-demand scene images stay
    // coherent with the rest of the book — a comic book's mid-read
    // regen needs to come back as a comic panel, not a film still.
    const stylePreset = await getBookStylePreset(bookSlug);
    const imageResult = await generateSceneImage(visualPrompt, {
      bookSlug,
      // Use scene-specific presence list; fall back to scanning the
      // prompt only if the director didn't emit presence fields.
      characters: narrative.characters_present?.length
        ? narrative.characters_present
        : (characterNames ?? []),
      forbiddenCharacters: narrative.characters_absent,
      mood: narrative.mood,
      theme,
      stylePreset,
    });

    // ── Step 6: Vision-verify hotspot positions ──
    let verifiedPositions: Map<string, { x: number; y: number; width: number; height: number }> | null = null;

    if (imageResult.imageUrl && imageResult.source !== 'fallback') {
      try {
        const targetLabels = narrative.hotspots.map(h => h.label);
        const visionResults = await analyzeImageForTargets(imageResult.imageUrl, targetLabels);

        verifiedPositions = new Map();
        for (const result of visionResults) {
          if (result.found) {
            verifiedPositions.set(result.label.toLowerCase(), {
              x: result.x,
              y: result.y,
              width: result.width,
              height: result.height,
            });
          }
        }
      } catch {
        // Vision failed — use LLM positions as fallback
      }
    }

    // ── Step 7: Assemble StoryScene ──
    const sceneId = `gen-${bookSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Default action menus per hotspot kind. Canon `allowed_actions`
    // (when present for the entity) override these so role-locked
    // characters get role-appropriate menus universally — Hanuman gets
    // talk/leap/fight/continue, Ravana gets confront/observe/continue,
    // any book that ships canon roles gets the same treatment.
    const DEFAULT_CHAR_ACTIONS: CharacterClickAction[] = ['talk', 'move', 'change', 'continue'];
    const DEFAULT_OBJ_ACTIONS: ObjectClickAction[] = ['ask', 'inspect', 'change', 'animate', 'continue'];

    const resolveActions = (kind: 'character' | 'object' | 'place', targetId: string, label: string): HotspotClickAction[] => {
      const fallback: HotspotClickAction[] = kind === 'character'
        ? [...DEFAULT_CHAR_ACTIONS]
        : [...DEFAULT_OBJ_ACTIONS];
      const canon = getCanonEntry(bookSlug, targetId) ?? getCanonEntry(bookSlug, label);
      const locked = canon?.allowed_actions;
      if (!locked || locked.length === 0) return fallback;
      // Trust canon vocabulary even if it includes verbs the type
      // doesn't list — the menu UI labels unknown verbs gracefully.
      return locked as HotspotClickAction[];
    };

    // Apply vision-verified positions (or keep LLM-guessed ones)
    const hotspots: SceneHotspot[] = narrative.hotspots.map((h, idx) => {
      const verified = verifiedPositions?.get(h.label.toLowerCase());
      const pos = verified || { x: h.x, y: h.y, width: h.width, height: h.height };
      const kind = h.hotspot_type === 'character' ? 'character' as const : h.hotspot_type === 'object' ? 'object' as const : 'place' as const;

      return {
        id: `${sceneId}-hs-${idx}`,
        target_id: h.target_id,
        label: h.label,
        type: kind,
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
        allowed_actions: resolveActions(kind, h.target_id, h.label),
        tooltip: h.tooltip,
        quick_speak: h.quick_speak,
      };
    });

    const characters: SceneCharacter[] = narrative.hotspots
      .filter(h => h.hotspot_type === 'character')
      .map(h => {
        const verified = verifiedPositions?.get(h.label.toLowerCase());
        const pos = verified || { x: h.x, y: h.y, width: h.width, height: h.height };
        // CharacterClickAction is a strict subset of HotspotClickAction,
        // so canon-locked actions slot in with a safe cast.
        const resolved = resolveActions('character', h.target_id, h.label) as unknown as CharacterClickAction[];
        return {
          id: h.target_id, name: h.label,
          x: pos.x, y: pos.y, width: pos.width, height: pos.height,
          image_url: null, pose: 'standing', mood: narrative.mood,
          animation: 'breathe' as const,
          click_actions: resolved,
          character_slug: h.target_id,
        };
      });

    const objects: SceneObject[] = narrative.hotspots
      .filter(h => h.hotspot_type !== 'character')
      .map(h => {
        const verified = verifiedPositions?.get(h.label.toLowerCase());
        const pos = verified || { x: h.x, y: h.y, width: h.width, height: h.height };
        return {
          id: h.target_id, label: h.label,
          x: pos.x, y: pos.y, width: pos.width, height: pos.height,
          image_url: null, state: 'default',
          animation: h.hotspot_type === 'object' ? 'glow' as const : 'none' as const,
          click_actions: ['ask' as const, 'inspect' as const, 'change' as const, 'animate' as const, 'continue' as const],
        };
      });

    const storyScene: StoryScene = {
      scene_id: sceneId,
      story_id: bookSlug,
      page_title: narrative.page_title,
      story_text: narrative.story_text,
      background: { image_url: imageResult.imageUrl || null, prompt: narrative.visual_description },
      characters, objects, effects: [], hotspots,
      choices: [],
      world_state: {
        continuity_summary: narrative.continuity_summary,
        characters_present: narrative.characters_present,
        mood: narrative.mood,
      },
      previous_actions: [],
      safety_rating: safety.rating,
      learning_points: narrative.learning_points,
      source_notes: narrative.source_notes,
      order_index: sceneIndex ?? 0,
      previous_scene_id: previousSceneId ?? null,
      next_scene_id: null,
      visual_description: narrative.visual_description,
      quiz_questions: [],
      unverified,
      verification_note: verificationNote,
    };

    // Cache for prefetch
    const result = {
      scene: storyScene,
      imageSource: imageResult.source,
      continuity_summary: narrative.continuity_summary,
      visionVerified: !!verifiedPositions,
      webGrounded: !!sourceContext,
    };
    await setCachedResponse(cacheKey, result, 'scene-gen');

    return NextResponse.json(result);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Generate Scene Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
