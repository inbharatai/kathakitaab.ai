// ============================================================
// lib/safety/moderation.ts
//
// Wraps OpenAI's omni-moderation-latest model with two simple
// helpers — moderatePrompt() for user-supplied input, and
// moderateOutput() for AI-generated narration.
//
// Design principles:
//   • Fail-OPEN by default. If the moderation API is unreachable
//     or the OpenAI key is missing, we don't block legitimate
//     creation. The risk is letting through one bad request, not
//     bricking the whole generator.
//   • Single network call per check. No chaining of multiple
//     classifiers — that's a separate, paid-tier feature.
//   • Model-agnostic shape. The caller gets a stable
//     ModerationResult regardless of which provider answers.
//
// Categories OpenAI returns: 'sexual', 'sexual/minors', 'hate',
// 'hate/threatening', 'self-harm', 'self-harm/intent',
// 'self-harm/instructions', 'harassment', 'harassment/threatening',
// 'violence', 'violence/graphic', 'illicit', 'illicit/violent'.
//
// We treat 'sexual/minors' and 'self-harm/intent' as auto-block
// even if the overall flag is false — those categories are not
// negotiable for a children's product.
// ============================================================

import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai/openaiClient';

export interface ModerationResult {
  /** True when the content should be blocked. */
  flagged: boolean;
  /** Top categories that triggered the flag (highest score first).
   *  Empty when not flagged. Useful for logging without leaking the
   *  original text. */
  categories: string[];
  /** Plain-language reason the caller can show the user. Generic
   *  on purpose — we don't echo back the user's prompt. */
  reason: string;
  /** True when moderation could not run (no API key, network error,
   *  etc). Caller should treat as "passed" to avoid blocking real
   *  users on transient failures, but may want to log the bypass. */
  bypassed: boolean;
}

const ALWAYS_BLOCK = new Set<string>([
  'sexual/minors',
  'self-harm/intent',
  'self-harm/instructions',
]);

const PASS: ModerationResult = { flagged: false, categories: [], reason: '', bypassed: false };

async function callOpenAIModeration(text: string): Promise<ModerationResult> {
  if (!isOpenAIConfigured()) {
    return { ...PASS, bypassed: true };
  }
  try {
    const client = getOpenAIClient();
    // omni-moderation-latest accepts up to ~32k tokens of text. We
    // truncate generously to keep one call cheap; the categories the
    // policy cares about (sexual/minors, violence/graphic, etc.)
    // surface in the first few hundred characters of any real prompt.
    const res = await client.moderations.create({
      model: 'omni-moderation-latest',
      input: text.slice(0, 4000),
    });
    const r = res.results?.[0];
    if (!r) return PASS;

    // Hard-block list overrides the overall `flagged` boolean for
    // categories that are non-negotiable on a children's product.
    const triggered = Object.entries(r.categories ?? {})
      .filter(([, on]) => on === true)
      .map(([k]) => k);

    const hardBlocked = triggered.some(c => ALWAYS_BLOCK.has(c));
    const flagged = hardBlocked || r.flagged === true;
    if (!flagged) return PASS;

    // Sort by score (highest first) so logs lead with the strongest
    // signal. Score map and category map share the same keys, but
    // CategoryScores doesn't carry a string index signature in the
    // SDK types so we read through `unknown` first.
    const scores = (r.category_scores ?? {}) as unknown as Record<string, number>;
    const sorted = triggered.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));

    return {
      flagged: true,
      categories: sorted,
      reason: hardBlocked
        ? 'This content was blocked because it touches a category we never allow in a children’s product.'
        : 'This content didn’t pass our safety check. Try a different phrasing or topic.',
      bypassed: false,
    };
  } catch (err) {
    // Network / key / rate-limit failure: log and bypass. The audit
    // log captures this so a sustained outage is visible, but a
    // transient blip never blocks legitimate users.
    console.warn('[moderation] OpenAI moderation failed, bypassing:', err instanceof Error ? err.message : err);
    return { ...PASS, bypassed: true };
  }
}

/** Pre-generation check on user-supplied input (story title, prompt,
 *  child name, etc). Returns flagged=true to short-circuit generation
 *  with a 400 response. */
export async function moderatePrompt(text: string): Promise<ModerationResult> {
  if (!text || text.trim().length === 0) return PASS;
  return callOpenAIModeration(text);
}

/** Post-generation check on AI-produced narration / dialogue. Use
 *  before persisting to Redis or surfacing to the client. */
export async function moderateOutput(text: string): Promise<ModerationResult> {
  if (!text || text.trim().length === 0) return PASS;
  return callOpenAIModeration(text);
}
