// ============================================================
// KathaKitaab.ai — Vision Agent
//
// Analyzes generated scene images using GPT-4o vision to find
// where characters and objects actually are in the image.
// Replaces blind LLM-guessed hotspot positions with verified ones.
//
// Fallback: if vision fails, returns original positions unchanged.
// Cost: ~$0.01-0.03 per image analysis.
// ============================================================

import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai/openaiClient';

export interface VisionTarget {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  found: boolean;
}

/**
 * Analyze a generated image to find where characters/objects actually appear.
 * Returns verified positions for each target, or `found: false` if not visible.
 */
export async function analyzeImageForTargets(
  imageBase64: string,
  targets: string[],
): Promise<VisionTarget[]> {
  if (!isOpenAIConfigured() || !imageBase64 || targets.length === 0) {
    return targets.map(label => ({ label, x: 50, y: 50, width: 15, height: 20, found: false }));
  }

  try {
    const client = getOpenAIClient();

    // Strip data URL prefix if present
    const b64 = imageBase64.startsWith('data:')
      ? imageBase64.split(',')[1]
      : imageBase64;

    const mediaType = imageBase64.includes('image/png') ? 'image/png' : 'image/jpeg';

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this illustrated storybook scene. Find these elements: ${targets.join(', ')}

For each element, return its bounding box as percentages of the full image (0-100).
- x = left edge percentage
- y = top edge percentage
- width = width percentage
- height = height percentage

If an element is not clearly visible, set found to false.

Return ONLY a valid JSON array, no markdown:
[{"label":"name","x":number,"y":number,"width":number,"height":number,"found":boolean}]`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaType};base64,${b64}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback(targets);

    const parsed = JSON.parse(content);
    // Handle both { targets: [...] } and direct array
    const results: VisionTarget[] = Array.isArray(parsed) ? parsed : (parsed.targets || parsed.elements || parsed.hotspots || []);

    if (!Array.isArray(results) || results.length === 0) return fallback(targets);

    // Validate and clamp values
    return results.map(r => ({
      label: r.label || 'unknown',
      x: clamp(r.x, 0, 95),
      y: clamp(r.y, 0, 95),
      width: clamp(r.width, 5, 30),
      height: clamp(r.height, 5, 40),
      found: r.found !== false,
    }));

  } catch (err) {
    console.error('[VisionAgent] Image analysis failed:', err);
    return fallback(targets);
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val ?? min));
}

function fallback(targets: string[]): VisionTarget[] {
  return targets.map(label => ({ label, x: 50, y: 50, width: 15, height: 20, found: false }));
}
