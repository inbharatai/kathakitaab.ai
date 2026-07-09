import { NextResponse } from 'next/server';
import { AskCharacterRequest } from '@/lib/types/livebook';
import { askCharacter } from '@/lib/openai/livebookAgent';
import { getCharacterBySlug, getSceneById, getBook as getSeedBook } from '@/lib/data/ramayanaSeed';
import { getBook as getRegistryBook, getScene as getRegistryScene, getCharacter as getRegistryCharacter } from '@/lib/data/bookRegistry';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { buildCanonPromptFragment } from '@/lib/data/canonLookup';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { resolveBookVisibility } from '@/lib/auth/bookAccess';
// S1 — persistent character memory thread (Aurora durable, Redis fallback).
import { isAuroraEnabled, getCharacterThread, appendCharacterTurn } from '@/lib/db/aurora';
import { getRedis } from '@/lib/redis';

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    const body: AskCharacterRequest = await request.json();
    const { bookSlug, sceneId, characterSlug, question, mode, threadId } = body;

    // Validate input
    if (!bookSlug || !sceneId || !characterSlug || !question) {
      return NextResponse.json(
        { error: 'Missing required fields: bookSlug, sceneId, characterSlug, question' },
        { status: 400 }
      );
    }

    // Validate mode
    const validModes = ['canon', 'explanation', 'interpretation', 'creative'];
    const safeMode = validModes.includes(mode) ? mode : 'explanation';

    // Block creative mode by default
    if (safeMode === 'creative') {
      return NextResponse.json({
        label: 'EXPLANATION',
        answer: 'Creative mode is currently disabled by default. All responses are grounded in source material.',
        source_note: 'System policy',
        next_options: ['Ask a factual question', 'Explore another character', 'Continue the story'],
        safety_note: 'Creative mode can be enabled via feature flags.'
      });
    }

    // Universal lookup: try the curated Ramayana seed first, fall
    // back to the bookRegistry for any AI-generated book. The two
    // sources have slightly different shapes — we normalise to the
    // fields askCharacter actually consumes (id, slug, title; scene
    // id/title/narration/source_notes; character name/role/traits/
    // speech_tone/source_notes).
    const seedBook = getSeedBook(bookSlug);
    const seedScene = getSceneById(sceneId);
    const seedChar = getCharacterBySlug(characterSlug);

    let book: { id: string; slug: string; title: string } | null = null;
    let scene: { scene_id: string; title: string; narration: string; source_notes: string } | null = null;
    let character: { name: string; role: string; traits: string[]; speech_tone: string; source_notes: string; short_summary: string; slug: string } | null = null;

    if (seedBook) book = { id: seedBook.id, slug: seedBook.slug, title: seedBook.title };
    if (seedScene) scene = { scene_id: seedScene.scene_id, title: seedScene.title, narration: seedScene.narration, source_notes: seedScene.source_notes };
    if (seedChar) character = {
      name: seedChar.name, role: seedChar.role, traits: seedChar.traits,
      speech_tone: seedChar.character_bible?.speech_tone ?? 'wise and grounded',
      source_notes: seedChar.source_notes, short_summary: seedChar.short_summary, slug: seedChar.slug,
    };

    let registryBook: Awaited<ReturnType<typeof getRegistryBook>> = null;
    if (!book) {
      registryBook = await getRegistryBook(bookSlug);
      if (registryBook) book = { id: registryBook.id, slug: registryBook.slug, title: registryBook.title };
    }

    // Visibility check for generated books.
    if (registryBook && resolveBookVisibility(registryBook) === 'private') {
      const ownerId = getOwnerIdFromRequest(request);
      const session = await getSessionFromRouteRequest(request);
      const isAdmin = isAdminSession(session);
      const callerId = session?.userId ?? ownerId;
      if (!isAdmin && registryBook.ownerId !== callerId) {
        return NextResponse.json({ error: 'Book, scene, or character not found' }, { status: 404 });
      }
    }

    if (!scene) {
      const registryScene = await getRegistryScene(bookSlug, sceneId);
      if (registryScene) scene = {
        scene_id: registryScene.scene_id, title: registryScene.title,
        narration: registryScene.narration, source_notes: registryScene.source_notes,
      };
    }
    if (!character) {
      const registryChar = await getRegistryCharacter(bookSlug, characterSlug);
      if (registryChar) character = {
        name: registryChar.name, role: registryChar.role, traits: registryChar.traits,
        speech_tone: registryChar.speech_tone ?? 'warm and grounded',
        source_notes: registryChar.source_notes, short_summary: registryChar.short_summary, slug: registryChar.slug,
      };
    }

    if (!book || !scene || !character) {
      return NextResponse.json({ error: 'Book, scene, or character not found' }, { status: 404 });
    }

    // Check cache — include threadId (S1) so two threads for the same
    // (book, scene, character, question, mode) don't collide. Absent
    // threadId keeps the legacy cache key byte-identical.
    const cacheKey = buildCacheKey({
      type: 'character-qa',
      bookId: book.id,
      sceneId: scene.scene_id,
      characterId: character.slug,
      question,
      mode: safeMode,
      threadId: threadId ?? '',
    });

    const cached = await getCachedResponse(cacheKey);
    if (cached) {
      return NextResponse.json({ ...(cached as object), cached: true });
    }

    // Check if OpenAI is configured
    if (!isOpenAIConfigured()) {
      const fallback = {
        label: 'EXPLANATION' as const,
        answer: `As ${character.name}, I would love to answer your question, but the AI service is not configured yet. Please set your OPENAI_API_KEY in the .env.local file. In the meantime, you can explore my character profile and learn about the Ramayana through the scenes and narration.`,
        source_note: 'Fallback response — OpenAI API key not configured.',
        next_options: ['Explore my character profile', 'Read the scene narration', 'Continue to the next scene'],
        safety_note: 'This is a fallback response because the AI is not configured.'
      };
      return NextResponse.json(fallback);
    }

    // Pull canon context for the character if the book has a canon
    // file. For unknown books or characters, this returns '' and we
    // rely on the existing scene + character bible context.
    const canonFragment = buildCanonPromptFragment(bookSlug, character.slug)
      || buildCanonPromptFragment(bookSlug, character.name);

    const baseSourceContext = `${scene.narration}\n\nCharacter: ${character.short_summary}\n\nSource: ${character.source_notes}`;
    const sourceContextWithCanon = canonFragment
      ? `${canonFragment}\n\n---\n\n${baseSourceContext}`
      : baseSourceContext;

    // S1 — load prior conversation thread for this (owner, book, character).
    // Aurora is the durable store (migration 0004); when Aurora is off we
    // fall back to a Redis JSON array; when neither is configured (or no
    // threadId was sent) we stay stateless — today's behaviour. The history
    // is prepended between the system prompt and the new user question inside
    // askCharacter so the character answers with memory.
    const threadOwnerId = getOwnerIdFromRequest(request);
    let history: { role: string; content: string }[] | undefined;
    const useThread = !!threadId && !!threadOwnerId;
    const redisThreadKey = useThread
      ? `kk:charthread:${threadOwnerId}:${bookSlug}:${characterSlug}`
      : '';

    if (useThread) {
      if (isAuroraEnabled()) {
        try {
          history = await getCharacterThread(threadOwnerId!, bookSlug, characterSlug);
        } catch (err) {
          console.warn('[ask-character] thread load failed (Aurora):', err instanceof Error ? err.message : err);
          history = undefined;
        }
      } else {
        const r = getRedis();
        if (r) {
          try {
            const existing = await r.get<{ role: string; content: string }[]>(redisThreadKey);
            if (Array.isArray(existing)) history = existing;
          } catch (err) {
            console.warn('[ask-character] thread load failed (Redis):', err instanceof Error ? err.message : err);
          }
        }
      }
    }

    // S4 — route the answer to Hindi when the book is a Hindi book. The
    // Movie build / TTS path already threads language; askCharacter only
    // needs it to tell the model which script to answer in.
    const bookLanguage = registryBook?.language;

    // Call OpenAI
    const response = await askCharacter({
      book: { id: book.id, slug: book.slug, title: book.title },
      scene: { scene_id: scene.scene_id, title: scene.title, narration: scene.narration, source_notes: scene.source_notes },
      character: {
        name: character.name,
        role: character.role,
        traits: character.traits,
        speech_tone: character.speech_tone,
        source_notes: character.source_notes,
      },
      userQuestion: question,
      mode: safeMode as 'canon' | 'explanation' | 'interpretation',
      sourceContext: sourceContextWithCanon,
    }, history, bookLanguage);

    // S1 — append the (user, question) + (assistant, answer) turns to the
    // thread so the next turn sees them. Best-effort: a write failure never
    // costs the user their answer — we already have `response`.
    if (useThread) {
      const answer = response.answer ?? '';
      if (isAuroraEnabled()) {
        try {
          await appendCharacterTurn(threadOwnerId!, bookSlug, characterSlug, 'user', question);
          if (answer) await appendCharacterTurn(threadOwnerId!, bookSlug, characterSlug, 'assistant', answer);
        } catch (err) {
          console.warn('[ask-character] thread append failed (Aurora):', err instanceof Error ? err.message : err);
        }
      } else {
        const r = getRedis();
        if (r) {
          try {
            const existing = (await r.get<{ role: string; content: string }[]>(redisThreadKey)) ?? [];
            existing.push({ role: 'user', content: question });
            if (answer) existing.push({ role: 'assistant', content: answer });
            // Cap the thread at 40 turns so a runaway conversation stays cheap.
            const trimmed = existing.slice(-40);
            await r.set(redisThreadKey, trimmed, { ex: 60 * 60 * 24 * 30 });
          } catch (err) {
            console.warn('[ask-character] thread append failed (Redis):', err instanceof Error ? err.message : err);
          }
        }
      }
      // Echo the thread id so the client can store + reuse it.
      response.threadId = threadId;
    }

    // Cache the response
    await setCachedResponse(cacheKey, response, getOpenAIModel());

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('Ask character error:', error);
    return NextResponse.json({ error: "We're having trouble with that request. Please try again." }, { status: 500 });
  }
}
