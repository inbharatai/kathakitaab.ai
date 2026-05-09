import { NextResponse } from 'next/server';
import { generateInfo } from '@/lib/openai/infoAgent';
import { getSceneById } from '@/lib/data/ramayanaSeed';
import { getScene as getRegistryScene } from '@/lib/data/bookRegistry';
import { getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { isGeminiConfigured } from '@/lib/openai/client';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { buildCanonPromptFragment } from '@/lib/data/canonLookup';

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    if (!isGeminiConfigured()) {
      return NextResponse.json({ error: 'Gemini API is not configured' }, { status: 500 });
    }

    const { sceneId, clickedItem, question, bookSlug, bookTitle } = await request.json();

    if (!sceneId || !clickedItem) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Universal scene lookup: Ramayana seed first, then bookRegistry.
    let sceneTitle = '';
    let sceneNarration = '';
    const seedScene = getSceneById(sceneId);
    if (seedScene) {
      sceneTitle = seedScene.title;
      sceneNarration = seedScene.narration;
    } else if (bookSlug) {
      const registryScene = await getRegistryScene(bookSlug, sceneId);
      if (registryScene) {
        sceneTitle = registryScene.title;
        sceneNarration = registryScene.narration;
      }
    }
    if (!sceneTitle) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const cacheKey = `info:${sceneId}:${clickedItem}:${question || 'default'}`;
    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return NextResponse.json({ response: cached, cached: true });
    }

    // Inject canon context if the book has a canon file and the
    // clicked item is a known canonical entity. Empty string when
    // not found — generateInfo handles that gracefully.
    const canonContext = bookSlug ? buildCanonPromptFragment(bookSlug, clickedItem) : '';

    const aiResponse = await generateInfo(
      sceneTitle,
      sceneNarration,
      clickedItem,
      question,
      canonContext || undefined,
      bookTitle,
    );
    
    await setCachedResponse(cacheKey, aiResponse);
    return NextResponse.json({ response: aiResponse, cached: false });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating info:', message);
    return NextResponse.json(
      { error: 'Failed to generate info', details: message },
      { status: 500 }
    );
  }
}
