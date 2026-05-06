// ============================================================
// KathaKitaab.ai — Branch QA Validator
//
// Catches the failure mode where the LLM generates a generic branch
// that ignores the user's chosen verb. After branchAgent produces a
// candidate branch, the QA agent rates it on three axes:
//
//   1. Verb alignment — does the narration actually reflect "talk"
//      vs "fight" vs "leap"?
//   2. Entity grounding — does it actually involve the named entity?
//   3. Canon faithfulness — no contradictions with character bible.
//
// Score is 0..100. Below threshold → caller can retry, log, or
// degrade. Costs ~$0.0002 per branch (gpt-4o-mini, ~150 tokens in,
// ~30 tokens out).
//
// This is universal — it doesn't know about specific books. The
// validator uses the verb token itself to score alignment, which
// works for any book that uses the same verb vocabulary.
// ============================================================

import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';

export interface QAResult {
  /** 0..100 overall confidence the branch matches the verb intent. */
  score: number;
  /** Three sub-scores so callers can diagnose. */
  verb: number;
  entity: number;
  canon: number;
  /** One-line explanation when score < threshold. */
  note?: string;
}

export interface QAInput {
  bookTitle: string;
  entityLabel: string;
  entityType: string;
  action: string;
  narration: string;
  sceneText?: string;
}

const SYSTEM_PROMPT = `You are a strict QA validator for an interactive storybook.
A "branch" is a short narration (2-3 sentences) generated when a user clicks an entity and selects an action verb.
You must rate the branch on three 0-100 scales:

  1. verb     — does the narration's content match the verb's intent?
                Talk → speech / dialogue / inner voice.
                Move → physical relocation, walking, leaping.
                Fight → conflict, strike, defense.
                Observe → noticing, looking, sensing.
                Inspect → close examination, detail revealed.
                Comfort → care, reassurance, gentleness.
                Leap → vault / charge / dive.
                Honor → bow, reverence, gesture.
                Other verbs follow the dictionary meaning.
  2. entity   — does the branch actually involve the named entity?
                If the entity is a character, do they speak / act / appear?
                If it's an object, is the object present and meaningful?
  3. canon    — is the content faithful to the book's source material
                without obvious contradictions? Generic neutrality is OK;
                hallucinated factual claims that contradict canon are NOT.

Respond with valid JSON only:
{
  "verb": 0-100,
  "entity": 0-100,
  "canon": 0-100,
  "note": "one-line summary, only required if any score < 70"
}`;

function buildUserPrompt(input: QAInput): string {
  return `Book: "${input.bookTitle}"
Entity: ${input.entityLabel} (${input.entityType})
User action: ${input.action}

Branch narration:
"${input.narration.trim()}"

${input.sceneText ? `Scene text:\n"${input.sceneText.slice(0, 400).trim()}"\n\n` : ''}Score the branch.`;
}

/**
 * Validate a branch. Returns 100/100/100 with no note when no AI is
 * configured — callers should treat that as "skip QA, ship the branch".
 *
 * Network or parse failures degrade to score=70, note="qa unavailable".
 * They never throw.
 */
export async function validateBranch(input: QAInput): Promise<QAResult> {
  if (!isOpenAIConfigured() && !isGeminiConfigured()) {
    return { score: 100, verb: 100, entity: 100, canon: 100 };
  }
  if (!input.narration?.trim()) {
    return { score: 0, verb: 0, entity: 0, canon: 0, note: 'empty narration' };
  }

  const userPrompt = buildUserPrompt(input);

  let raw: { verb?: number; entity?: number; canon?: number; note?: string } = {};
  try {
    raw = await callQA(SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    return { score: 70, verb: 70, entity: 70, canon: 70, note: `qa unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const verb = clamp(Number(raw.verb), 0, 100);
  const entity = clamp(Number(raw.entity), 0, 100);
  const canon = clamp(Number(raw.canon), 0, 100);
  // Overall score weights verb heaviest — that's the actual product
  // bug we're trying to catch (LLM ignored the verb).
  const score = Math.round(verb * 0.5 + entity * 0.3 + canon * 0.2);
  return { score, verb, entity, canon, note: raw.note };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

async function callQA(systemPrompt: string, userPrompt: string): Promise<{ verb?: number; entity?: number; canon?: number; note?: string }> {
  // gpt-4o-mini is cheap enough for a per-branch QA pass. We use
  // response_format=json_object so a malformed model response can't
  // break the validator path.
  if (isOpenAIConfigured()) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: getOpenAIModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 120,
      });
      return JSON.parse(completion.choices[0]?.message?.content || '{}');
    } catch {
      // fall through to Gemini
    }
  }
  if (isGeminiConfigured()) {
    const ai = getGeminiClient();
    const model = getTextModel();
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: { systemInstruction: systemPrompt, temperature: 0.1, maxOutputTokens: 200, responseMimeType: 'application/json' },
    });
    return JSON.parse(res.text || '{}');
  }
  throw new Error('No AI configured for branch QA');
}
