// ============================================================
// KathaKitaab — Click-Anywhere Scene Understanding
//
// When user clicks a spot that has no pre-defined hotspot:
//   1. Send image + click coordinates to GPT-4o vision
//   2. Classify what was clicked (character/object/location/background)
//   3. If meaningful → generate interaction
//   4. If not → show "nothing here" toast
//
// Results are cached so the same spot is never re-classified.
// ============================================================

import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';

export interface ClickClassification {
  meaningful: boolean;
  entityType: 'character' | 'object' | 'location' | 'background' | 'unknown';
  label: string;
  confidence: number;
  reason: string;
  suggestedAction: 'generate_character_interaction' | 'inspect_object' | 'generate_new_scene' | 'show_info_card' | 'ignore';
}

/**
 * Classify what the user clicked on in the scene image.
 * Uses GPT-4o vision (primary) or Gemini (fallback via text-only guess).
 */
export async function classifyImageClick(
  sceneTitle: string,
  sceneNarration: string,
  characters: string[],
  imageUrl: string | null,
  xPercent: number,
  yPercent: number,
): Promise<ClickClassification> {
  // Round coordinates to nearest 5% for cache dedup
  const rx = Math.round(xPercent / 5) * 5;
  const ry = Math.round(yPercent / 5) * 5;

  // Check cache
  const cacheKey = buildCacheKey({ type: 'click-classify', sceneTitle, x: String(rx), y: String(ry) });
  const cached = (await getCachedResponse(cacheKey)) as ClickClassification | null;
  if (cached) return cached;

  const prompt = `The user clicked at position (${Math.round(xPercent)}%, ${Math.round(yPercent)}%) on an illustrated scene.

Scene: "${sceneTitle}"
Context: ${sceneNarration.slice(0, 300)}
Known characters in scene: ${characters.join(', ')}

Based on the scene context and click position, determine what the user likely clicked on.

Position guide (percentage-based, 0,0 is top-left):
- Top area (0-30% y): usually sky, ceiling, upper walls, treetops
- Middle area (30-70% y): usually characters, objects, main scene elements
- Bottom area (70-100% y): usually ground, floor, water, foreground
- Left/right edges: usually scenery, architecture, side elements

Respond with JSON:
{
  "meaningful": boolean (false if just empty sky/ground with nothing interesting),
  "entityType": "character" | "object" | "location" | "background" | "unknown",
  "label": "what was clicked (e.g., 'Sacred River', 'Ancient Tree', 'Rama', 'Palace Wall')",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation",
  "suggestedAction": "generate_character_interaction" | "inspect_object" | "generate_new_scene" | "show_info_card" | "ignore"
}`;

  let result: ClickClassification;

  // Try GPT-4o vision if image available
  if (isOpenAIConfigured() && imageUrl && !imageUrl.startsWith('data:')) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
          ],
        }],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.3,
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as ClickClassification;
      result = normalizeClassification(parsed);
      await setCachedResponse(cacheKey, result, 'click-classify');
      return result;
    } catch {
      // Fall through
    }
  }

  // Try OpenAI text-only (no image)
  if (isOpenAIConfigured()) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.3,
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}') as ClickClassification;
      result = normalizeClassification(parsed);
      await setCachedResponse(cacheKey, result, 'click-classify');
      return result;
    } catch {
      // Fall through
    }
  }

  // Gemini fallback
  if (isGeminiConfigured()) {
    try {
      const ai = getGeminiClient();
      const model = getTextModel();
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0.3, maxOutputTokens: 300, responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(res.text || '{}') as ClickClassification;
      result = normalizeClassification(parsed);
      await setCachedResponse(cacheKey, result, 'click-classify');
      return result;
    } catch {
      // Fall through
    }
  }

  // No AI available — use position heuristic
  return positionHeuristic(xPercent, yPercent, characters);
}

/**
 * Simple position-based guess when no AI is available.
 */
function normalizeClassification(raw: unknown): ClickClassification {
  const r = raw as Record<string, unknown>;
  const validEntityType = (v: unknown): ClickClassification['entityType'] => {
    const s = String(v);
    return ['character', 'object', 'location', 'background', 'unknown'].includes(s) ? (s as ClickClassification['entityType']) : 'unknown';
  };
  const validAction = (v: unknown): ClickClassification['suggestedAction'] => {
    const s = String(v);
    const actions: ClickClassification['suggestedAction'][] = ['generate_character_interaction', 'inspect_object', 'generate_new_scene', 'show_info_card', 'ignore'];
    return actions.includes(s as ClickClassification['suggestedAction']) ? (s as ClickClassification['suggestedAction']) : 'ignore';
  };
  return {
    meaningful: Boolean(r?.meaningful),
    entityType: validEntityType(r?.entityType),
    label: typeof r?.label === 'string' && r.label ? r.label : 'Unknown',
    confidence: Number.isFinite(Number(r?.confidence)) ? Math.max(0, Math.min(1, Number(r.confidence))) : 0,
    reason: typeof r?.reason === 'string' && r.reason ? r.reason : 'No reason provided.',
    suggestedAction: validAction(r?.suggestedAction),
  };
}

function positionHeuristic(x: number, y: number, characters: string[]): ClickClassification {
  // Top = sky/atmosphere
  if (y < 20) {
    return { meaningful: true, entityType: 'background', label: 'Sky', confidence: 0.4, reason: 'Top of scene — likely sky or atmosphere', suggestedAction: 'show_info_card' };
  }
  // Middle center = likely characters
  if (y > 25 && y < 70 && x > 20 && x < 80) {
    const charGuess = characters[Math.floor((x / 100) * characters.length)] || 'Scene Element';
    return { meaningful: true, entityType: 'character', label: charGuess, confidence: 0.5, reason: 'Center of scene — likely a character or key element', suggestedAction: 'generate_character_interaction' };
  }
  // Bottom = ground/path
  if (y > 75) {
    return { meaningful: true, entityType: 'location', label: 'Path', confidence: 0.4, reason: 'Bottom of scene — likely ground or path', suggestedAction: 'generate_new_scene' };
  }
  // Edges = scenery
  return { meaningful: true, entityType: 'location', label: 'Scenery', confidence: 0.3, reason: 'Edge of scene — likely environment', suggestedAction: 'show_info_card' };
}
