// ============================================================
// KathaKitaab — Lightweight Image Prompt Validator
//
// Validates assembled image prompts BEFORE they are sent to
// gpt-image-1 or cached. Runs synchronously — no I/O, no LLM.
//
// Phase 1 (now): prompt-level checks only.
// Phase 2 (later): optional vision-model validation of the
// generated image itself.
// ============================================================

export interface ImageValidationResult {
  passed: boolean;
  issues: string[];
  requiredCharactersPresent: boolean;
  forbiddenCharactersExcluded: boolean;
  promptGroundedToScene: boolean;
}

export interface ImageValidationInput {
  /** Final assembled positive prompt. */
  prompt: string;
  /** Characters who MUST appear in the prompt. */
  visibleCharacters?: string[];
  /** Characters who must NOT appear in the positive prompt. */
  forbiddenCharacters?: string[];
  /** The original scene description / event. */
  sceneDescription?: string;
}

/**
 * Normalise a name for fuzzy matching in prompts.
 *   - Replace hyphens/underscores with spaces ("wise-crow" → "wise crow")
 *   - Lowercase for case-insensitive comparison.
 * This handles the common case where character slugs use kebab-case
 * but the prompt uses natural language spacing.
 */
function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, ' ');
}

/**
 * Unicode-aware word containment check. `\b` only works for ASCII word
 * boundaries and fails for Devanagari and other scripts. This helper
 * splits on any non-letter/non-number Unicode characters and checks
 * for exact word presence — safe for Hindi, English, and mixed text.
 */
function containsWord(text: string, word: string): boolean {
  if (!word) return false;
  // Split on any sequence of characters that are NOT letters or numbers
  // (Unicode-aware so Devanagari, Tamil, etc. are treated as letters).
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.includes(word);
}

/**
 * Synchronous prompt-level validation. Catches the most common
 * pipeline bug — the full cast being injected into every scene.
 */
export function validateImagePrompt(input: ImageValidationInput): ImageValidationResult {
  const issues: string[] = [];
  const promptNormalised = normaliseName(input.prompt);

  // 1. Required characters must be mentioned as whole words in the prompt.
  //    We normalise both the prompt and the character name so kebab-case
  //    slugs like "wise-crow" still match "wise crow" in the prompt.
  let requiredCharactersPresent = true;
  if (input.visibleCharacters?.length) {
    for (const name of input.visibleCharacters) {
      if (!name) continue;
      const normalised = normaliseName(name);
      const parts = normalised.split(/\s+/).filter(Boolean);
      if (parts.length === 0) continue;
      // Every word part of the normalised name must appear somewhere
      // in the normalised prompt as a whole word.
      const allPartsFound = parts.every(part => containsWord(promptNormalised, part));
      if (!allPartsFound) {
        issues.push(`Prompt missing required character: ${name}`);
        requiredCharactersPresent = false;
      }
    }
  }

  // 2. Forbidden characters must NOT appear as whole words in the positive prompt
  //    (they may appear only inside the "Avoid:" negative block).
  let forbiddenCharactersExcluded = true;
  if (input.forbiddenCharacters?.length) {
    // Split prompt at "Avoid:" — everything before is the positive prompt.
    const positivePart = promptNormalised.split('avoid:')[0] ?? promptNormalised;
    for (const name of input.forbiddenCharacters) {
      if (!name) continue;
      const parts = normaliseName(name).split(/\s+/).filter(Boolean);
      const anyPartFound = parts.some(part => containsWord(positivePart, part));
      if (anyPartFound) {
        issues.push(`Forbidden character appears in positive prompt: ${name}`);
        forbiddenCharactersExcluded = false;
      }
    }
  }

  // 3. The prompt should contain the scene description or event words.
  let promptGroundedToScene = true;
  if (input.sceneDescription?.trim()) {
    const sceneWords = input.sceneDescription
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 6);
    const hits = sceneWords.filter(w => promptNormalised.includes(w)).length;
    if (hits < 2) {
      issues.push('Prompt may not be grounded in the scene description');
      promptGroundedToScene = false;
    }
  }

  // 4. Prompt length sanity check (gpt-image-1 limit ~4000 chars).
  if (input.prompt.length > 4000) {
    issues.push(`Prompt exceeds 4000 characters (${input.prompt.length}) — may be truncated by image model`);
  }
  if (input.prompt.length < 30) {
    issues.push('Prompt is suspiciously short (< 30 chars) — may not describe the scene adequately');
  }

  return {
    passed: issues.length === 0,
    issues,
    requiredCharactersPresent,
    forbiddenCharactersExcluded,
    promptGroundedToScene,
  };
}
