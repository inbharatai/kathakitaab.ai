// ============================================================
// KathaKitaab.ai — Hotspot Agent
//
// Generates interactive hotspot positions for a scene based on
// the scene's narrative and visual description.
// Uses OpenAI JSON mode.
// ============================================================

import { getOpenAIClient, getOpenAIModel } from '@/lib/openai/openaiClient';

export interface HotspotLayout {
  hotspots: Array<{
    label: string;
    hotspot_type: 'character' | 'object' | 'place';
    target_type: 'character' | 'info';
    target_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    tooltip: string;
    quick_speak?: string;
  }>;
}

export async function generateHotspots(
  sceneTitle: string,
  sceneNarration: string,
  visualDescription: string,
  characterNames: string[],
): Promise<HotspotLayout> {
  const client = getOpenAIClient();
  const model = getOpenAIModel();

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a hotspot placement agent for an interactive storybook.
Given a scene description, place 2-5 clickable hotspots on a 16:9 scene canvas.

Rules:
- x, y are percentages (0-100) representing position in the scene
- Characters should be placed where they would naturally stand
- Objects/places positioned logically in the scene composition
- Each character hotspot should have quick_speak: a short in-character one-liner
- target_id: lowercase slug for characters (e.g., "rama"), snake_case for objects (e.g., "golden_deer")
- Ensure hotspots don't overlap significantly
- Width/height proportional to visual importance (5-25%)

Respond with valid JSON: { "hotspots": [...] }`,
      },
      {
        role: 'user',
        content: `Scene: "${sceneTitle}"
Narration: ${sceneNarration.slice(0, 500)}
Visual: ${visualDescription}
Characters: ${characterNames.join(', ') || 'none specified'}

Place interactive hotspots.`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5,
    max_tokens: 1000,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return { hotspots: [] };

  try {
    const parsed = JSON.parse(content) as HotspotLayout;
    return { hotspots: parsed.hotspots ?? [] };
  } catch {
    return { hotspots: [] };
  }
}
