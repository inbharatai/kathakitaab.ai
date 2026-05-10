// ============================================================
// lib/safety/moderation.ts
//
// Wraps OpenAI's omni-moderation-latest model with two simple
// helpers — moderatePrompt() for user-supplied input, and
// moderateOutput() for AI-generated narration.
//
// Design principles:
//   • Fail-policy is per-call.
//      - World mode: fail-OPEN. A moderation outage shouldn't break
//        legitimate adult-facing creation; the risk is letting through
//        one bad request, not bricking the whole generator.
//      - Personalized / Classroom / any child-related mode: fail-CLOSED.
//        If the safety check can't run, we cannot honestly call the
//        result safe. Block and surface a retry message to the user.
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
// We treat 'sexual/minors', 'self-harm/intent', and
// 'self-harm/instructions' as auto-block even if the overall flag is
// false — those categories are not negotiable for a children's product.
// ============================================================

import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { scrubError } from '@/lib/safety/scrub';

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
   *  etc). For fail-CLOSED callers this is paired with flagged=true.
   *  For fail-OPEN callers it's paired with flagged=false. Always
   *  inspect both fields. */
  bypassed: boolean;
}

export interface ModerateOptions {
  /** When true, an infrastructure failure (no API key, network error,
   *  unexpected response shape) returns flagged=true with a retry
   *  message — i.e. fail-CLOSED. Use for ANY flow that touches a
   *  child profile, child photo, or classroom mode. Default is
   *  fail-OPEN, which is appropriate only for adult-facing world
   *  generation. */
  failClosed?: boolean;
}

const ALWAYS_BLOCK = new Set<string>([
  'sexual/minors',
  'self-harm/intent',
  'self-harm/instructions',
]);

const PASS: ModerationResult = { flagged: false, categories: [], reason: '', bypassed: false };

/** Returned when fail-CLOSED moderation can't reach the upstream
 *  service. The user-facing message is the literal copy decided in
 *  the V0 honesty pass — short, retryable, no detail leakage. */
function failClosedResult(): ModerationResult {
  return {
    flagged: true,
    categories: ['__safety_check_unavailable'],
    reason: 'Safety check could not complete. Please try again.',
    bypassed: true,
  };
}

async function callOpenAIModeration(text: string, opts: ModerateOptions): Promise<ModerationResult> {
  const failClosed = opts.failClosed === true;

  if (!isOpenAIConfigured()) {
    if (failClosed) {
      console.warn('[moderation] OpenAI not configured — fail-CLOSED block on child-mode request');
      return failClosedResult();
    }
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
    // Unexpected response shape. Fail-closed treats this as an
    // infrastructure failure (we cannot affirm "safe"). Fail-open
    // treats it as a non-event.
    if (!r) {
      if (failClosed) {
        console.warn('[moderation] empty response from OpenAI — fail-CLOSED block on child-mode request');
        return failClosedResult();
      }
      return PASS;
    }

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
    // Network / key / rate-limit failure. Behaviour depends on the
    // caller's policy — see docstring above. We log only the scrubbed
    // error message because the moderation input may contain a child
    // name or prompt that an upstream provider echoed in their error.
    console.warn('[moderation] OpenAI moderation failed:', scrubError(err).message);
    if (failClosed) {
      return failClosedResult();
    }
    return { ...PASS, bypassed: true };
  }
}

/** Pre-generation check on user-supplied input (story title, prompt,
 *  child name, etc). Returns flagged=true to short-circuit generation
 *  with a 400 response.
 *
 *  Pass `{ failClosed: true }` for any flow that involves a child
 *  profile, classroom mode, or photo upload. Default is fail-OPEN,
 *  appropriate only for adult-facing world story creation.
 */
export async function moderatePrompt(text: string, opts: ModerateOptions = {}): Promise<ModerationResult> {
  if (!text || text.trim().length === 0) return PASS;
  return callOpenAIModeration(text, opts);
}

/** Post-generation check on AI-produced narration / dialogue. Use
 *  before persisting to Redis or surfacing to the client.
 *
 *  Pass `{ failClosed: true }` for any output that will be shown to
 *  a child or that was generated from a child-mode prompt.
 */
export async function moderateOutput(text: string, opts: ModerateOptions = {}): Promise<ModerationResult> {
  if (!text || text.trim().length === 0) return PASS;
  return callOpenAIModeration(text, opts);
}
