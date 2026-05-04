import { NextResponse } from 'next/server';
import { AskCharacterRequest } from '@/lib/types/livebook';
import { askCharacter } from '@/lib/openai/livebookAgent';
import { getCharacterBySlug, getSceneById, getBook } from '@/lib/data/ramayanaSeed';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { getTextModel, isGeminiConfigured } from '@/lib/openai/client';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { buildCanonPromptFragment } from '@/lib/data/canonLookup';

export async function POST(request: Request) {
  const limited = checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  try {
    const body: AskCharacterRequest = await request.json();
    const { bookSlug, sceneId, characterSlug, question, mode } = body;

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

    // Get data
    const book = getBook(bookSlug);
    const scene = getSceneById(sceneId);
    const character = getCharacterBySlug(characterSlug);

    if (!book || !scene || !character) {
      return NextResponse.json({ error: 'Book, scene, or character not found' }, { status: 404 });
    }

    // Check cache
    const cacheKey = buildCacheKey({
      type: 'character-qa',
      bookId: book.id,
      sceneId: scene.scene_id,
      characterId: character.slug,
      question,
      mode: safeMode,
    });

    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return NextResponse.json({ ...(cached as object), cached: true });
    }

    // Check if Gemini is configured
    if (!isGeminiConfigured()) {
      const fallback = {
        label: 'EXPLANATION' as const,
        answer: `As ${character.name}, I would love to answer your question, but the AI service is not configured yet. Please set your GEMINI_API_KEY in the .env.local file. In the meantime, you can explore my character profile and learn about the Ramayana through the scenes and narration.`,
        source_note: 'Fallback response — Gemini API key not configured.',
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

    // Call OpenAI
    const response = await askCharacter({
      book: { id: book.id, slug: book.slug, title: book.title },
      scene: { scene_id: scene.scene_id, title: scene.title, narration: scene.narration, source_notes: scene.source_notes },
      character: {
        name: character.name,
        role: character.role,
        traits: character.traits,
        speech_tone: character.character_bible.speech_tone,
        source_notes: character.source_notes,
      },
      userQuestion: question,
      mode: safeMode as 'canon' | 'explanation' | 'interpretation',
      sourceContext: sourceContextWithCanon,
    });

    // Cache the response
    setCachedResponse(cacheKey, response, getTextModel());

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error('Ask character error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
