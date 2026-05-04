// ============================================================
// KathaKitaab.ai — Unified Agent API Route
// POST /api/livebook/agent
//
// This single route handles ALL agent interactions:
//   - type: 'character' → speak as a character
//   - type: 'info'      → explain an object/place
//   - type: 'narrator'  → enrich scene narration
//   - type: 'quiz'      → generate a quiz question
//   - type: 'free'      → free-region click (future: image analysis)
//
// Every call checks the cache FIRST. Zero cost for repeated clicks.
// ============================================================

import { NextResponse } from 'next/server';
import { runAgent, AgentContext } from '@/lib/openai/orchestratorAgent';
import { getCharacterBySlug, getSceneById } from '@/lib/data/ramayanaSeed';
import { getScene, getCharacter } from '@/lib/data/bookRegistry';
import { buildCacheKey, getCachedResponse, setCachedResponse, getCacheStats } from '@/lib/cache/responseCache';
import { isGeminiConfigured, getTextModel } from '@/lib/openai/client';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    if (!isGeminiConfigured()) {
      return NextResponse.json({ error: 'AI engine not configured. Set GEMINI_API_KEY in .env.local.' }, { status: 503 });
    }

    const body = await request.json();
    const { type, bookSlug, sceneId, targetId, userInput, clickX, clickY } = body;

    if (!type || !sceneId) {
      return NextResponse.json({ error: 'Missing required fields: type, sceneId' }, { status: 400 });
    }

    // Support both seed (Ramayana) and AI-generated books
    let scene: any = getSceneById(sceneId);
    if (!scene && bookSlug) scene = getScene(bookSlug, sceneId);
    if (!scene) {
      return NextResponse.json({ error: `Scene not found: ${sceneId}` }, { status: 404 });
    }

    // ---- Build Cache Key ----
    const cacheKey = buildCacheKey({
      type,
      sceneId: scene.scene_id,
      targetId: targetId || 'none',
      input: userInput || 'explore',
      clickRegion: clickX && clickY ? `${Math.round(clickX / 10) * 10},${Math.round(clickY / 10) * 10}` : 'none',
    });

    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return NextResponse.json({ result: cached, cached: true, cacheKey });
    }

    // ---- Build Agent Context ----
    const ctx: AgentContext = {
      bookTitle: 'Ramayana LiveBook',
      sceneTitle: scene.title,
      sceneNarration: scene.narration,
      sourceNotes: scene.source_notes,
      agentType: type,
      userInput: userInput || `Tell me about ${targetId || 'this scene'}`,
    };

    // Enrich context based on type
    if (type === 'character' && targetId) {
      // Try Ramayana seed first, then generated book registry
      let character: any = getCharacterBySlug(targetId);
      if (!character && bookSlug) character = getCharacter(bookSlug, targetId);
      if (!character) {
        return NextResponse.json({ error: `Character not found: ${targetId}` }, { status: 404 });
      }
      ctx.agentName = character.name;
      ctx.characterBible = [
        `Role: ${character.role}`,
        `Traits: ${(character.traits || []).join(', ')}`,
        `Summary: ${character.short_summary}`,
        `Speech tone: ${character.character_bible?.speech_tone || character.speech_tone || 'wise and grounded'}`,
        `Source: ${character.source_notes}`,
      ].join('\n');
    }

    if (type === 'info' && targetId) {
      ctx.agentName = targetId;
    }

    // Free-region click — use scene context as the anchor
    if (type === 'free') {
      ctx.agentType = 'info';
      ctx.agentName = `Scene area at position (${clickX?.toFixed(0)}%, ${clickY?.toFixed(0)}%)`;
      ctx.userInput = userInput || `What is at this location in the scene?`;
    }

    // ---- Call Orchestrator ----
    const result = await runAgent(ctx);

    // ---- Cache & Return ----
    await setCachedResponse(cacheKey, result, getTextModel());

    // Include portrait URL for character interactions
    let portrait_url: string | undefined;
    if (type === 'character' && targetId) {
      const char: any = getCharacterBySlug(targetId) || (bookSlug ? getCharacter(bookSlug, targetId) : null);
      portrait_url = char?.image_url;
    }

    return NextResponse.json({ result, cached: false, cacheKey, portrait_url });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Agent API Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — cache stats (dev tool)
export async function GET() {
  const stats = getCacheStats();
  return NextResponse.json({ cache: stats });
}
