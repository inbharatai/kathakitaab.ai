// ============================================================
// KathaKitaab — Prompt Injection Guard
//
// Sanitises user-supplied text before it reaches any LLM prompt,
// image prompt, or database field.
//
// Threats blocked:
//   • Instruction override ("ignore previous instructions")
//   • System prompt extraction ("reveal your system prompt")
//   • Safety bypass ("bypass moderation", "disable filter")
//   • Inappropriate content targeting children
//   • Canon override ("override canon rules")
//   • API key extraction
//   • Delimiters that break JSON mode
//
// Design:
//   • Pure functions — no I/O, deterministic, safe.
//   • Whitelist-first for child-mode names.
//   • Pattern-based blocklist for injection attempts.
//   • Neutralisation: escape dangerous characters, strip override phrases,
//     truncate to safe lengths.
// ============================================================

export interface SanitiseResult {
  /** Clean text safe to embed in a prompt. */
  clean: string;
  /** True if the input was modified. */
  wasModified: boolean;
  /** True if the input contained a likely injection attempt. */
  flagged: boolean;
  /** Human-readable reason(s) if flagged. */
  reasons: string[];
  /** True if the text should be rejected outright (hard block). */
  blocked: boolean;
}

// ── Blocklist patterns ───────────────────────────────────────

// Patterns that attempt to override instructions or extract secrets.
// Each entry: [regex, human-readable label, isHardBlock]
const INJECTION_PATTERNS: Array<[RegExp, string, boolean]> = [
  [/ignore\s+(all\s+)?previous\s+instructions?/gi, 'Instruction override attempt', true],
  [/ignore\s+(the\s+)?system\s+prompt/gi, 'System prompt override attempt', true],
  [/reveal\s+(your\s+)?system\s+prompt/gi, 'System prompt extraction attempt', true],
  [/show\s+(me\s+)?(your\s+)?(system\s+)?prompt/gi, 'Prompt extraction attempt', true],
  [/bypass\s+(moderation|safety|filter|content policy)/gi, 'Safety bypass attempt', true],
  [/disable\s+(moderation|safety|filter|content policy)/gi, 'Safety bypass attempt', true],
  [/turn\s+off\s+(moderation|safety|filter)/gi, 'Safety bypass attempt', true],
  [/override\s+canon\s+rules?/gi, 'Canon override attempt', true],
  [/ignore\s+canon/gi, 'Canon override attempt', true],
  [/as\s+an\s+ai\s+language\s+model/gi, 'Jailbreak framing', true],
  [/you\s+are\s+not\s+(an\s+)?ai/gi, 'Jailbreak framing', true],
  [/you\s+are\s+now\s+in\s+developer\s+mode/gi, 'Jailbreak framing', true],
  [/d[a<]?n\s+mode/gi, 'Jailbreak framing', true], // DAN mode variants
  [/jailbreak/gi, 'Jailbreak attempt', true],
  [/prompt\s+injection/gi, 'Self-referencing injection', true],
  [/\/\/\s*BEGIN\s+INSTRUCTIONS?/gi, 'Delimiter injection', true],
  [/\[\[SYSTEM\]\]/gi, 'Fake system tag injection', true],
  [/\{\{\s*system\s*\}\}/gi, 'Template injection', true],
  [/<\/?system>/gi, 'XML system tag injection', true],
  [/expose\s+(your\s+)?api\s+key/gi, 'API key extraction attempt', true],
  [/reveal\s+(your\s+)?api\s+key/gi, 'API key extraction attempt', true],
  [/show\s+(me\s+)?(your\s+)?(openai|gemini|sarvam)\s+key/gi, 'API key extraction attempt', true],
  [/generate\s+(adult|sexual|explicit|pornographic)\s+content/gi, 'Inappropriate content request', true],
  [/write\s+(a\s+)?(sex|erotic)\s+story/gi, 'Inappropriate content request', true],
  [/describe\s+(a\s+)?(sexual|explicit)\s+scene/gi, 'Inappropriate content request', true],
  [/i'm\s+over\s+18/gi, 'Age-gate bypass attempt', false],
  [/pretend\s+i'm\s+an\s+adult/gi, 'Age-gate bypass attempt', false],
];

// Characters / substrings that can break JSON mode or prompt structure.
const DANGEROUS_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

// Delimiters that might escape the user-content envelope.
const DELIMITER_PATTERNS = [
  /"""/g,
  /```/g,
  /\{\{\{/g,
  /\}\}\}/g,
  /\[\[\[/g,
  /\]\]\]/g,
  /\<\<\</g,
  /\>\>\>/g,
];

// ── Helpers ────────────────────────────────────────────────

function stripOverrides(text: string): string {
  let cleaned = text;
  for (const [pattern] of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[blocked]');
  }
  return cleaned;
}

function stripDelimiters(text: string): string {
  let cleaned = text;
  for (const pattern of DELIMITER_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

function stripDangerousChars(text: string): string {
  return text.replace(DANGEROUS_CHARS, '');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

// ── Public API ─────────────────────────────────────────────

const DEFAULT_MAX_LEN = 2000;

/**
 * Sanitise user text for safe embedding in LLM prompts.
 *
 * @param text   Raw user input.
 * @param opts   Optional limits and strictness.
 */
export function sanitisePromptInput(
  text: string,
  opts: {
    /** Max allowed length. Default 2000 chars. */
    maxLength?: number;
    /** When true, reject the input entirely if any injection pattern matches. */
    strict?: boolean;
    /** Context label for logging (e.g. 'story_title', 'custom_prompt'). */
    context?: string;
  } = {},
): SanitiseResult {
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LEN;
  const strict = opts.strict ?? false;
  const reasons: string[] = [];
  let flagged = false;
  let blocked = false;

  // Null-safety
  if (text == null) {
    return { clean: '', wasModified: true, flagged: true, reasons: ['Input was null or undefined'], blocked: strict };
  }

  let clean = String(text);

  // 1. Check injection patterns
  for (const [pattern, label, isHardBlock] of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      flagged = true;
      reasons.push(`${label} detected${opts.context ? ` in ${opts.context}` : ''}`);
      if (isHardBlock || strict) {
        blocked = true;
      }
    }
  }

  // 2. Strip control characters
  const beforeChars = clean;
  clean = stripDangerousChars(clean);
  if (clean !== beforeChars) {
    flagged = true;
    reasons.push('Control characters removed');
  }

  // 3. Strip override phrases and delimiters
  const beforeStrip = clean;
  clean = stripOverrides(clean);
  clean = stripDelimiters(clean);
  if (clean !== beforeStrip) {
    flagged = true;
    // Only add reason if not already flagged for injection
    if (!reasons.some(r => r.includes('override') || r.includes('injection') || r.includes('bypass'))) {
      reasons.push('Prompt delimiters / override phrases neutralised');
    }
  }

  // 4. Trim and truncate
  clean = clean.trim();
  const beforeTruncate = clean;
  clean = truncate(clean, maxLength);
  if (clean !== beforeTruncate) {
    reasons.push(`Truncated to ${maxLength} characters`);
  }

  // 5. Collapse excessive whitespace
  clean = clean.replace(/\s+/g, ' ');

  const wasModified = clean !== String(text).trim();

  return {
    clean,
    wasModified,
    flagged,
    reasons,
    blocked,
  };
}

/**
 * Convenience guard for API route handlers.
 * Returns a standard error response object when the input is blocked.
 */
export function guardPromptInput(
  text: string,
  opts?: Parameters<typeof sanitisePromptInput>[1],
): { ok: true; clean: string } | { ok: false; error: string; status: number } {
  const result = sanitisePromptInput(text, opts);
  if (result.blocked) {
    return {
      ok: false,
      error: `Input blocked: ${result.reasons.join('; ')}`,
      status: 400,
    };
  }
  return { ok: true, clean: result.clean };
}

/**
 * Batch sanitise multiple fields (e.g. a request body).
 * Returns the first blocked result, or all clean values.
 */
export function sanitiseFields(
  fields: Record<string, string | undefined>,
  opts?: Parameters<typeof sanitisePromptInput>[1],
): { ok: true; cleaned: Record<string, string> } | { ok: false; field: string; error: string; status: number } {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const guard = guardPromptInput(value, { ...opts, context: key });
    if (!guard.ok) {
      return { ok: false, field: key, error: guard.error, status: guard.status };
    }
    cleaned[key] = guard.clean;
  }
  return { ok: true, cleaned };
}
