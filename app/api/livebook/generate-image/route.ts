// ============================================================
// KathaKitaab.ai — Visual Page Image Generator
// POST /api/livebook/generate-image
//
// Generates cinematic illustrations using:
//   1. OpenAI gpt-image-1 (primary)
//   2. Gemini Imagen (fallback)
//
// Called per unique hotspot click, then cached server-side.
// ============================================================

import { NextResponse } from 'next/server';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { generateSceneImage } from '@/lib/agents/visualAgent';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getBookStylePreset } from '@/lib/data/bookStyle';

// Character visual prompts — carefully crafted for consistency
const CHARACTER_VISUAL_PROMPTS: Record<string, string> = {
  rama: 'Noble Indian prince Rama with serene expression, traditional saffron and gold royal attire, divine bow, warm golden sunrise light',
  sita: 'Graceful Indian princess Sita, deep red and gold sari, lotus flowers, inner strength and serenity',
  lakshmana: 'Alert young warrior prince Lakshmana, Indian armor and bow, fierce loyal expression, forest background',
  hanuman: 'Mighty golden vanara hero Hanuman, devotional expression, saffron cloth, divine glow',
  ravana: 'Powerful ten-headed demon king Ravana, dark royal attire, elaborate crown, commanding presence',
  dasharatha: 'Aged wise king Dasharatha of Ayodhya, royal crown, sorrowful dignity, palace background',
  bharata: 'Humble prince Bharata of Ayodhya, simple attire, holding Rama\'s sandals, devoted expression',
  jatayu: 'Majestic golden eagle Jatayu, heroic battle stance, dramatic sky background',
  sugriva: 'Vanara king Sugriva, noble bearing, golden brown fur, forest mountain background',
  vibhishana: 'Noble righteous Vibhishana from Lanka, white and gold attire, peaceful dignified expression',
};

// Info/object visual prompts
const INFO_VISUAL_PROMPTS: Record<string, string> = {
  ayodhya_palace: 'The golden palace of Ayodhya at sunset, grand ornate architecture, royal elephants, divine light rays',
  shiva_bow: 'The mighty bow of Shiva, enormous divine weapon on a grand pedestal, sacred glow, assembly hall of Mithila',
  golden_deer: 'The enchanted golden deer of the Ramayana, magical creature glowing in a forest clearing, ethereal and beautiful',
};

interface GenerateImageRequest {
  targetType: 'character' | 'info' | 'free';
  targetId?: string;
  sceneId: string;
  sceneTitle: string;
  label?: string;
  promptHint?: string;
  /** Book slug for canon-aware character + style injection. Optional. */
  bookSlug?: string;
  /** Characters that should be visually locked in this image. */
  characters?: string[];
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  // Every fresh image generation requires sign-in — even Ramayana
  // hotspot clicks. Cached returns below still work for any cookie
  // owner since they don't spend money. This matches the project
  // directive that any *generation* (story or image) is gated.
  const session = await getSessionFromRouteRequest(request);
  if (!session) {
    return NextResponse.json({
      error: 'Sign in to unlock interactive image generation.',
      reason: 'auth_required',
    }, { status: 401 });
  }

  try {
    const body: GenerateImageRequest = await request.json();
    const { targetType, targetId, sceneId, sceneTitle, label, promptHint, bookSlug, characters } = body;
    const resolvedTargetId = targetId || label || sceneId;

    // Build cache key
    const cacheKey = buildCacheKey({
      type: 'visual',
      targetType,
      targetId: resolvedTargetId,
      sceneId,
      hint: promptHint ? promptHint.slice(0, 80) : 'base',
    });

    // Return cached image URL if exists
    const cached = (await getCachedResponse(cacheKey)) as string | null;
    if (cached) {
      return NextResponse.json({ imageUrl: cached, cached: true });
    }

    // Build visual prompt
    let prompt: string;
    if (targetType === 'character' && targetId && CHARACTER_VISUAL_PROMPTS[targetId]) {
      prompt = CHARACTER_VISUAL_PROMPTS[targetId];
    } else if (targetType !== 'character' && targetId && INFO_VISUAL_PROMPTS[targetId]) {
      prompt = INFO_VISUAL_PROMPTS[targetId];
    } else {
      const subject = label || resolvedTargetId.replace(/_/g, ' ');
      prompt = `"${subject}" from the scene "${sceneTitle}". Rich detailed setting with characters and objects.`;
    }

    if (promptHint) {
      prompt = `${prompt} Focus on: ${promptHint}.`;
    }

    // Generate image using Visual Agent (OpenAI primary, Gemini fallback).
    // bookSlug + characters opt-in to canon-locked appearance + style.
    // Resolve the book's style preset so the branch image renders in
    // the same visual world as the rest of the book. Without this, a
    // comic-book reader who clicks a hotspot would get a photoreal
    // branch image — preset coherence breaks. Universal: same call
    // for every preset, undefined falls through to the default.
    const stylePreset = await getBookStylePreset(bookSlug);
    const result = await generateSceneImage(prompt, {
      bookSlug,
      characters: characters ?? (label ? [label] : undefined),
      mood: 'serene',
      stylePreset,
    });

    if (!result.imageUrl) {
      return NextResponse.json({ error: 'No image generated', fallback: true }, { status: 200 });
    }

    // Cache for 24h
    await setCachedResponse(cacheKey, result.imageUrl, result.source);

    return NextResponse.json({ imageUrl: result.imageUrl, cached: false, source: result.source });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Generate Image Error]', message);
    return NextResponse.json({ error: message, fallback: true }, { status: 200 });
  }
}
