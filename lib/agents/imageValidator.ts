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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
 * Synchronous prompt-level validation. Catches the most common
 * pipeline bug — the full cast being injected into every scene.
 */
export function validateImagePrompt(input: ImageValidationInput): ImageValidationResult {
  const issues: string[] = [];
  const promptLower = input.prompt.toLowerCase();

  // 1. Required characters must be mentioned as whole words in the prompt.
  let requiredCharactersPresent = true;
  if (input.visibleCharacters?.length) {
    for (const name of input.visibleCharacters) {
      if (!name) continue;
      const re = new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`);
      if (!re.test(promptLower)) {
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
    const positivePart = promptLower.split('avoid:')[0] ?? promptLower;
    for (const name of input.forbiddenCharacters) {
      if (!name) continue;
      const re = new RegExp(`\\b${escapeRegex(name.toLowerCase())}\\b`);
      if (re.test(positivePart)) {
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
    const hits = sceneWords.filter(w => promptLower.includes(w)).length;
    if (hits < 2) {
      issues.push('Prompt may not be grounded in the scene description');
      promptGroundedToScene = false;
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    requiredCharactersPresent,
    forbiddenCharactersExcluded,
    promptGroundedToScene,
  };
}
