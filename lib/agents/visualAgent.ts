// ============================================================
// KathaKitaab — Visual Agent
//
// Generates cinematic illustrations for story scenes.
// Uses OpenAI gpt-image-1 as primary, Gemini Imagen as fallback.
//
// Character consistency is enforced by visualPromptBuilder, which
// auto-injects each canonical character's locked appearance + the
// per-book style bible into every prompt. Without that, faces drift
// between scenes — with it, the same Rama looks like the same Rama
// in every scene of every book.
// ============================================================

import { createHash } from 'node:crypto';
import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, isGeminiConfigured } from '@/lib/openai/client';
import { buildVisualPrompt } from './visualPromptBuilder';
import { uploadGeneratedImage } from '@/lib/storage/imageStorage';
import { getCanonEntry } from '@/lib/data/canonLookup';
import { getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { validateImagePrompt } from './imageValidator';
import type { StylePreset } from '@/lib/types/style';
import { toFile } from 'openai';

// 90 days. gpt-image-1 calls cost ~$0.04 each — a cache hit on a
// scene that was previously generated saves the call, the upload,
// and the latency. Identical prompts re-resolve to the URL of the
// first generation, which is exactly what we want when a book is
// regenerated or two books happen to converge on the same prompt.
const IMAGE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function imageCacheKey(
  prompt: string,
  bookSlug: string | undefined,
  sceneId: string | undefined,
  stylePreset: string | undefined,
  anchorIds: string[],
): string {
  const h = createHash('sha256')
    .update(prompt)
    .update('|')
    .update(bookSlug ?? '')
    .update('|')
    .update(sceneId ?? '')
    .update('|')
    .update(stylePreset ?? '')
    .update('|')
    .update([...anchorIds].sort().join(','))
    .digest('hex')
    .slice(0, 32);
  return `image:scene:${h}`;
}

// ── Anchor Reference Resolution ──────────────────────────────

/**
 * Collect pre-baked anchor portraits for the canon characters present
 * in the scene. Universal — works for any book whose canon entries
 * have `anchor_image_url`. Prefers `divine: true` entries when there
 * are more candidates than gpt-image-1's reference cap (4).
 *
 * Returns an empty array on any failure path (no canon, no anchors,
 * fetch errors) so the caller silently falls back to free generation.
 */
async function collectAnchorReferences(
  bookSlug: string,
  characters: string[],
): Promise<Array<{ id: string; file: Awaited<ReturnType<typeof toFile>> }>> {
  if (!characters?.length) return [];

  // Resolve each name through canon and collect those with anchors.
  const seen = new Set<string>();
  const candidates: { id: string; url: string; divine: boolean }[] = [];
  for (const name of characters) {
    const entry = getCanonEntry(bookSlug, name);
    if (!entry || !entry.anchor_image_url || seen.has(entry.id)) continue;
    seen.add(entry.id);
    candidates.push({ id: entry.id, url: entry.anchor_image_url, divine: !!entry.divine });
  }
  if (candidates.length === 0) return [];

  // gpt-image-1 accepts up to 4 reference images. When over the cap,
  // keep divine entries first (those are the highest-stakes for face
  // consistency), then truncate.
  candidates.sort((a, b) => Number(b.divine) - Number(a.divine));
  const top = candidates.slice(0, 4);

  const out: Array<{ id: string; file: Awaited<ReturnType<typeof toFile>> }> = [];
  for (const c of top) {
    try {
      const res = await fetch(c.url);
      if (!res.ok) {
        console.warn(`[VisualAgent] anchor fetch failed for ${c.id}: ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const file = await toFile(buf, `${c.id}.png`, { type: 'image/png' });
      out.push({ id: c.id, file });
    } catch (err) {
      console.warn(`[VisualAgent] anchor fetch error for ${c.id}:`, err);
    }
  }
  return out;
}

// ── Image Generation ─────────────────────────────────────────

export interface VisualGenerationResult {
  imageUrl: string;
  source: 'openai' | 'gemini' | 'fallback';
  /** The full assembled prompt that was sent (after canon injection). */
  promptUsed?: string;
  /** Which canonical characters had their appearance locked into the prompt. */
  charactersLocked?: string[];
}

export interface SceneImageContext {
  /** Book slug for canon lookup. Falls back to generic style if absent. */
  bookSlug?: string;
  /** Scene identifier for cache key and status tracking. */
  sceneId?: string;
  /** Characters known to be in the scene (e.g., scene metadata). */
  characters?: string[];
  /** Characters who must NOT appear in this scene image. */
  forbiddenCharacters?: string[];
  /** Mood tag from scene metadata. */
  mood?: string;
  /** Narrative theme (universal: courage / sacrifice / love / loss / …
   *  + tradition aliases dharma / bhakti / karma / hubris). Optional. */
  theme?: string;
  /** Visual style preset — overrides the per-book canon style and
   *  the universal default. Lets the user pick photoreal vs storybook
   *  vs animation at generation time without touching canon files. */
  stylePreset?: StylePreset;
}

/**
 * Generate a scene image. The first arg is the LLM's raw visual
 * description; the second can be either a mood string (legacy) or a
 * SceneImageContext object (new — recommended).
 *
 * Legacy callers still passing a mood string keep working — we wrap
 * it into a context. New callers should pass `{ bookSlug, characters,
 * mood }` so character appearance + book style get auto-injected.
 */
export async function generateSceneImage(
  visualDescription: string,
  contextOrMood: string | SceneImageContext = 'serene',
): Promise<VisualGenerationResult> {
  const ctx: SceneImageContext = typeof contextOrMood === 'string'
    ? { mood: contextOrMood }
    : contextOrMood;

  const built = buildVisualPrompt({
    description: visualDescription,
    bookSlug: ctx.bookSlug,
    mood: ctx.mood,
    theme: ctx.theme,
    characters: ctx.characters,
    forbiddenCharacters: ctx.forbiddenCharacters,
    stylePreset: ctx.stylePreset,
  });

  // ── Prompt-level validation ─────────────────────────────────
  // Catches the most common pipeline bug: the full cast being
  // injected into a scene where some characters should be absent.
  const validation = validateImagePrompt({
    prompt: built.prompt,
    visibleCharacters: ctx.characters,
    forbiddenCharacters: ctx.forbiddenCharacters,
    sceneDescription: visualDescription,
  });
  if (!validation.passed) {
    console.warn('[visualAgent] Prompt validation failed:', validation.issues);
    // Do NOT cache a failed prompt as final. We still proceed to
    // generation so the user isn't blocked, but the issue is logged
    // for admin review and future auto-regeneration.
  }

  // Resolve anchor references for any canon character in the scene
  // that has a pre-baked portrait. This is universal — any book that
  // ships canon with `anchor_image_url` gets face-locked generation
  // for free. We cap at 4 anchors (gpt-image-1 limit) and prefer
  // `divine: true` entries when there are too many candidates.
  const anchorRefs = ctx.bookSlug
    ? await collectAnchorReferences(ctx.bookSlug, ctx.characters ?? [])
    : [];

  // Prompt-level cache. The fingerprint is (full prompt, book,
  // scene, style, anchor IDs) — exactly the inputs to the image model.
  const cacheKey = imageCacheKey(built.prompt, ctx.bookSlug, ctx.sceneId, ctx.stylePreset, anchorRefs.map(a => a.id));
  const cached = await getCachedResponse(cacheKey) as VisualGenerationResult | null;
  if (cached?.imageUrl) {
    return cached;
  }

  // Try OpenAI gpt-image-1 with exponential-backoff retries.
  const maxRetries = 3;
  let lastErr: unknown;
  if (isOpenAIConfigured()) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = getOpenAIClient();
        let b64: string | undefined;
        if (anchorRefs.length > 0) {
          try {
            const edited = await client.images.edit({
              model: 'gpt-image-1',
              image: anchorRefs.map(r => r.file),
              prompt: built.prompt,
              size: '1536x1024',
              quality: 'medium',
              input_fidelity: 'high',
            });
            b64 = edited.data?.[0]?.b64_json;
          } catch (editErr) {
            console.error('[VisualAgent] images.edit with anchors failed, falling back to generate:', editErr);
          }
        }
        if (!b64) {
          const response = await client.images.generate({
            model: 'gpt-image-1',
            prompt: built.prompt,
            size: '1536x1024',
            quality: 'medium',
          });
          b64 = response.data?.[0]?.b64_json;
        }

        if (b64) {
          const imageUrl = await uploadGeneratedImage(`data:image/png;base64,${b64}`, {
            mimeType: 'image/png',
            pathHint: ctx.bookSlug,
          });
          const result: VisualGenerationResult = {
            imageUrl,
            source: 'openai',
            promptUsed: built.prompt,
            charactersLocked: built.charactersInjected,
          };
          await setCachedResponse(cacheKey, result, 'gpt-image-1', IMAGE_CACHE_TTL_MS);
          return result;
        }
      } catch (err) {
        lastErr = err;
        const delayMs = attempt < maxRetries ? Math.min(2000 * Math.pow(2, attempt - 1), 15000) : 0;
        console.error(`[VisualAgent] OpenAI image generation attempt ${attempt}/${maxRetries} failed:`,
          err instanceof Error ? err.message : err);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }
  }

  // ── Gemini Imagen fallback ──
  // Only when OpenAI fails entirely and Gemini is configured.
  if (isGeminiConfigured()) {
    try {
      const gemini = getGeminiClient();
      const response = await gemini.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: built.prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: '16:9',
        },
      });
      const generated = response?.generatedImages?.[0];
      if (generated?.image?.imageBytes) {
        const b64 = generated.image.imageBytes;
        const imageUrl = await uploadGeneratedImage(`data:image/png;base64,${b64}`, {
          mimeType: 'image/png',
          pathHint: ctx.bookSlug,
        });
        const result: VisualGenerationResult = {
          imageUrl,
          source: 'gemini',
          promptUsed: built.prompt,
          charactersLocked: built.charactersInjected,
        };
        await setCachedResponse(cacheKey, result, 'gemini-imagen', IMAGE_CACHE_TTL_MS);
        return result;
      }
    } catch (geminiErr) {
      console.error('[VisualAgent] Gemini Imagen fallback failed:', geminiErr instanceof Error ? geminiErr.message : geminiErr);
    }
  }

  console.error('[VisualAgent] All image generation attempts failed. Last error:', lastErr instanceof Error ? lastErr.message : lastErr);
  return { imageUrl: '', source: 'fallback', promptUsed: built.prompt, charactersLocked: built.charactersInjected };
}

// ── Character Portrait Generation ────────────────────────────

/**
 * Generate a single canonical portrait of a character. Useful for
 * pre-baking reference portraits that can later anchor scene images.
 * Uses the canon appearance directly via the prompt builder.
 */
export async function generateCharacterPortrait(
  characterName: string,
  visualDescription: string,
  bookSlug?: string,
  stylePreset?: StylePreset,
): Promise<VisualGenerationResult> {
  const built = buildVisualPrompt({
    description: `Close-up devotional portrait of ${characterName}. ${visualDescription}. Centred, eye contact with viewer, clean neutral background, full identifying details visible.`,
    bookSlug,
    mood: 'sacred',
    characters: [characterName],
    stylePreset,
  });

  const maxRetries = 3;
  let lastErr: unknown;
  if (isOpenAIConfigured()) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = getOpenAIClient();
        const response = await client.images.generate({
          model: 'gpt-image-1',
          prompt: built.prompt,
          size: '1024x1024',
          quality: 'medium',
        });

        const b64 = response.data?.[0]?.b64_json;
        if (b64) {
          const imageUrl = await uploadGeneratedImage(`data:image/png;base64,${b64}`, {
            mimeType: 'image/png',
            pathHint: bookSlug ? `${bookSlug}/portraits` : 'portraits',
          });
          return {
            imageUrl,
            source: 'openai',
            promptUsed: built.prompt,
            charactersLocked: built.charactersInjected,
          };
        }
      } catch (err) {
        lastErr = err;
        const delayMs = attempt < maxRetries ? Math.min(2000 * Math.pow(2, attempt - 1), 15000) : 0;
        console.error(`[VisualAgent] Portrait generation attempt ${attempt}/${maxRetries} failed:`, err instanceof Error ? err.message : err);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }
  }

  console.error('[VisualAgent] All portrait generation attempts failed. Last error:', lastErr instanceof Error ? lastErr.message : lastErr);
  return { imageUrl: '', source: 'fallback', promptUsed: built.prompt };
}
