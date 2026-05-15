// ============================================================
// KathaKitaab — Vision Agent
//
// Analyzes generated scene images using GPT-4o vision to find
// where characters and objects actually are in the image.
// Replaces blind LLM-guessed hotspot positions with verified ones.
//
// Fallback: if vision fails, returns the target with found=false so
// the caller can keep its previous (hand-authored) coords intact.
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

// JSON Schema for OpenAI structured-output. Forces the model to emit
// a strict shape so we can't get markdown, prose, or missing fields —
// the response parses cleanly or the request errors out.
const TARGET_LOCATIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          found: { type: 'boolean' },
          x: { type: 'number', description: 'Left edge as 0-100 percent of image width' },
          y: { type: 'number', description: 'Top edge as 0-100 percent of image height' },
          width: { type: 'number', description: 'Width as 0-100 percent of image width' },
          height: { type: 'number', description: 'Height as 0-100 percent of image height' },
        },
        required: ['label', 'found', 'x', 'y', 'width', 'height'],
      },
    },
  },
  required: ['results'],
} as const;

/**
 * Analyze a generated image to find where characters/objects actually appear.
 * Returns verified positions for each target, or `found: false` if not visible.
 *
 * Design notes (lessons from the previous broken implementation):
 *   - gpt-4o-mini's vision is too weak for localisation in a 1536x1024
 *     photoreal image — it returns boilerplate snapped to round numbers.
 *     Using full gpt-4o.
 *   - `detail: 'low'` downsamples to a 512x512 tile. Useless for finding
 *     a specific person in a wide cinematic frame. Using `'high'`.
 *   - Unstructured json_object lets the model wander into prose or
 *     omit fields. Using structured json_schema so the response shape
 *     is enforced server-side.
 *   - The old prompt said "illustrated storybook scene" — biased the
 *     model away from photoreal frames. New prompt is neutral.
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

    const b64 = imageBase64.startsWith('data:')
      ? imageBase64.split(',')[1]
      : imageBase64;
    const mediaType = imageBase64.includes('image/png') ? 'image/png' : 'image/jpeg';

    const targetList = targets.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You locate specific characters, objects, and places inside a single image. ' +
            'You return TIGHT bounding boxes as percentages of the image dimensions — ' +
            'no padding, no default values. If a target is not visible, set found=false ' +
            'and leave x/y/width/height at 0. Never invent positions for absent targets.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Find these targets in the image:\n${targetList}\n\n` +
                'Coordinates are percentages 0-100 of the full image.\n' +
                ' - x: left edge of the bounding box\n' +
                ' - y: top edge\n' +
                ' - width: how wide the target is\n' +
                ' - height: how tall the target is\n\n' +
                'Be precise. If two characters stand next to each other, give them ' +
                'distinct non-overlapping boxes. If a target is partially off-frame, ' +
                'box only the visible part. If a target is not present, set found=false ' +
                'with all coordinates 0 — do not guess.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaType};base64,${b64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'target_locations',
          strict: true,
          schema: TARGET_LOCATIONS_SCHEMA,
        },
      },
      max_tokens: 1500,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback(targets);

    const parsed = JSON.parse(content) as { results?: VisionTarget[] };
    const results = parsed.results;
    if (!Array.isArray(results) || results.length === 0) return fallback(targets);

    // Match by label so the caller can rely on input/output alignment
    // even if the model reorders. Fall back to "not found" for any
    // target the model omitted entirely (shouldn't happen with strict
    // schema, but defensive).
    return targets.map(label => {
      const r = results.find(x =>
        (x.label ?? '').toLowerCase().trim() === label.toLowerCase().trim());
      if (!r || !r.found) {
        return { label, x: 0, y: 0, width: 0, height: 0, found: false };
      }
      // Clamp to image bounds but use a generous max so big characters
      // (battlefield Ravana, hero close-ups) can legitimately occupy a
      // big slice of the frame.
      return {
        label,
        x: clamp(r.x, 0, 100),
        y: clamp(r.y, 0, 100),
        width: clamp(r.width, 1, 80),
        height: clamp(r.height, 1, 90),
        found: true,
      };
    });
  } catch (err) {
    console.error('[VisionAgent] Image analysis failed:', err);
    return fallback(targets);
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val ?? min));
}

function fallback(targets: string[]): VisionTarget[] {
  return targets.map(label => ({ label, x: 0, y: 0, width: 0, height: 0, found: false }));
}
