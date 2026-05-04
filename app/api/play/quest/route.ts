// ============================================================
// KathaKitaab.ai — Quest Generation API
// Uses OpenAI structured outputs to generate contextual
// quests for any scene/character combination.
// ============================================================

import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const limited = await checkRateLimit(req, { scope: 'default' });
  if (limited) return limited;

  try {
    const { bookSlug, sceneId, sceneTitle, sceneNarration, characters, playerCharacterClass, ageBand } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are the Quest Master AI for KathaKitaab.ai. 
Generate 1 main quest and 2 side quests for the given story scene.
Each quest must feel like a real game mission — specific, achievable, and story-meaningful.
Age band: ${ageBand ?? 'youth'}. Keep content appropriate.
Return valid JSON only.`,
        },
        {
          role: 'user',
          content: `Book: ${bookSlug}
Scene: ${sceneTitle} (${sceneId})
Narration: ${sceneNarration?.slice(0, 400)}
Characters present: ${(characters ?? []).join(', ')}
Player character class: ${playerCharacterClass ?? 'hero'}

Generate quests as JSON:
{
  "mainQuest": {
    "id": "quest-main-${sceneId}",
    "type": "MAIN",
    "title": "...",
    "description": "...",
    "loreText": "The Story Master reveals...",
    "objectives": [
      { "id": "obj-1", "description": "...", "completed": false, "optional": false }
    ],
    "reward": { "xp": 200, "coins": 50, "storyCardId": "card-${sceneId}" },
    "moralWeight": "neutral"
  },
  "sideQuests": [
    {
      "id": "quest-side-${sceneId}-1",
      "type": "DIALOGUE",
      "title": "...",
      "description": "...",
      "loreText": "...",
      "objectives": [...],
      "reward": { "xp": 100, "coins": 25 },
      "moralWeight": "light"
    }
  ]
}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1200,
    });

    const content = response.choices[0].message.content;
    if (!content) return NextResponse.json({ error: 'No content generated' }, { status: 500 });

    const quests = JSON.parse(content);
    return NextResponse.json(quests);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
