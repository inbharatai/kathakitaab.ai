// ============================================================
// KathaKitaab.ai — Visual Agent
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

import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient } from '@/lib/openai/client';
import { isGeminiConfigured } from '@/lib/openai/client';
import { buildVisualPrompt } from './visualPromptBuilder';

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
  /** Characters known to be in the scene (e.g., scene metadata). */
  characters?: string[];
  /** Mood tag from scene metadata. */
  mood?: string;
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
    characters: ctx.characters,
  });

  // Try OpenAI gpt-image-1 first
  if (isOpenAIConfigured()) {
    try {
      const client = getOpenAIClient();
      const response = await client.images.generate({
        model: 'gpt-image-1',
        prompt: built.prompt,
        size: '1536x1024', // 3:2 landscape, close to 16:9
        quality: 'medium',
      });

      const b64 = response.data?.[0]?.b64_json;
      if (b64) {
        return {
          imageUrl: `data:image/png;base64,${b64}`,
          source: 'openai',
          promptUsed: built.prompt,
          charactersLocked: built.charactersInjected,
        };
      }
    } catch (err) {
      console.error('[VisualAgent] OpenAI image generation failed, trying Gemini fallback:', err);
    }
  }

  // Fallback to Gemini Imagen
  if (isGeminiConfigured()) {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: built.prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: '16:9',
          outputMimeType: 'image/jpeg',
        },
      });

      const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
      if (imageBytes) {
        return {
          imageUrl: `data:image/jpeg;base64,${imageBytes}`,
          source: 'gemini',
          promptUsed: built.prompt,
          charactersLocked: built.charactersInjected,
        };
      }
    } catch (err) {
      console.error('[VisualAgent] Gemini image generation failed:', err);
    }
  }

  // No image generation available
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
): Promise<VisualGenerationResult> {
  const built = buildVisualPrompt({
    description: `Close-up devotional portrait of ${characterName}. ${visualDescription}. Centred, eye contact with viewer, clean neutral background, full identifying details visible.`,
    bookSlug,
    mood: 'sacred',
    characters: [characterName],
  });

  if (isOpenAIConfigured()) {
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
        return {
          imageUrl: `data:image/png;base64,${b64}`,
          source: 'openai',
          promptUsed: built.prompt,
          charactersLocked: built.charactersInjected,
        };
      }
    } catch (err) {
      console.error('[VisualAgent] Portrait generation failed:', err);
    }
  }

  return { imageUrl: '', source: 'fallback', promptUsed: built.prompt };
}
