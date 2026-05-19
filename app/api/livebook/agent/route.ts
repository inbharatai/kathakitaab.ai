// ============================================================
// KathaKitaab — Unified Agent API Route
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
import { resolveBookVisibility } from '@/lib/auth/bookAccess';
import { runAgent, AgentContext } from '@/lib/openai/orchestratorAgent';
import { getCharacterBySlug, getSceneById } from '@/lib/data/ramayanaSeed';
import { getBook, getScene, getCharacter } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';

// Turn a slug like "akbar-and-birbal-stories" into a display title
// "Akbar And Birbal Stories" when we don't have a registered book to
// quote a title from. Used as a last-ditch fallback so the agent
// prompt never claims the user is reading "Ramayana LiveBook" when
// they're actually on a different book.
function slugToTitle(slug: string): string {
  if (!slug) return 'LiveBook';
  return slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// The agent route accepts both the seed (Ramayana) and the registry
// (AI-generated) shapes. They share the fields the route actually
// reads, so we describe the intersection here rather than forcing a
// brittle cast between the two unrelated types. character_bible is
// optional because only the seed Character carries it.
interface SceneLike {
  scene_id: string;
  title: string;
  narration: string;
  source_notes: string;
}
interface CharacterLike {
  name: string;
  role: string;
  traits: string[];
  short_summary: string;
  speech_tone?: string;
  source_notes: string;
  image_url?: string;
  character_bible?: { speech_tone?: string };
}
import { buildCacheKey, getCachedResponse, setCachedResponse, getCacheStats } from '@/lib/cache/responseCache';
import { isOpenAIConfigured, getOpenAIModel } from '@/lib/openai/openaiClient';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    if (!isOpenAIConfigured()) {
      return NextResponse.json({ error: 'AI engine not configured. Set OPENAI_API_KEY in .env.local.' }, { status: 503 });
    }

    const body = await request.json();
    const { type, bookSlug, sceneId, targetId, userInput, clickX, clickY } = body;

    if (!type || !sceneId) {
      return NextResponse.json({ error: 'Missing required fields: type, sceneId' }, { status: 400 });
    }

    // Support both seed (Ramayana) and AI-generated books
    let scene: SceneLike | undefined = getSceneById(sceneId);
    if (!scene && bookSlug) scene = (await getScene(bookSlug, sceneId)) ?? undefined;
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

    // Resolve the book title from the registry first, then fall back
    // to a slug-derived title. The seed Ramayana path keeps its
    // historical "Ramayana LiveBook" string only when bookSlug is
    // empty *and* the seed scene was used — otherwise the agent
    // prompt would claim the user is reading the wrong book.
    let bookTitle = 'LiveBook';
    let registeredBook: Awaited<ReturnType<typeof getBook>> = null;
    if (bookSlug) {
      registeredBook = await getBook(bookSlug);
      bookTitle = registeredBook?.title ?? slugToTitle(bookSlug);
    } else if (getSceneById(sceneId)) {
      bookTitle = 'Ramayana LiveBook';
    }

    // Visibility check for generated books.
    if (registeredBook && resolveBookVisibility(registeredBook) === 'private') {
      const ownerId = getOwnerIdFromRequest(request);
      const session = await getSessionFromRouteRequest(request);
      const isAdmin = isAdminSession(session);
      const callerId = session?.userId ?? ownerId;
      if (!isAdmin && registeredBook.ownerId !== callerId) {
        return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
      }
    }

    // ---- Build Agent Context ----
    const ctx: AgentContext = {
      bookTitle,
      sceneTitle: scene.title,
      sceneNarration: scene.narration,
      sourceNotes: scene.source_notes,
      agentType: type,
      userInput: userInput || `Tell me about ${targetId || 'this scene'}`,
    };

    // Enrich context based on type
    if (type === 'character' && targetId) {
      // Try Ramayana seed first, then generated book registry
      let character: CharacterLike | undefined = getCharacterBySlug(targetId);
      if (!character && bookSlug) character = (await getCharacter(bookSlug, targetId)) ?? undefined;
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
    await setCachedResponse(cacheKey, result, getOpenAIModel());

    // Include portrait URL for character interactions
    let portrait_url: string | undefined;
    if (type === 'character' && targetId) {
      const char: CharacterLike | undefined =
        getCharacterBySlug(targetId)
        || (bookSlug ? ((await getCharacter(bookSlug, targetId)) ?? undefined) : undefined);
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
