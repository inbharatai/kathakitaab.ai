// ============================================================
// KathaKitaab.ai — Branch Agent
//
// Generates a single interaction branch for one (entity, action)
// pair. Used by:
//   - LivingBookBrain (during scene preparation, pre-warms cache)
//   - /api/livebook/pregenerate-branches (fire-and-forget on load)
//
// Centralizing this here keeps the verb-to-narration contract in
// one place: any caller using the same (entity, action) gets the
// same shaped result, so cache keys and runtime behavior stay
// coherent across the brain and the API route.
// ============================================================

import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';
import { checkContentSafety } from '@/lib/agents/safetyAgent';
import type { PreGeneratedBranch } from '@/lib/engine/branchPreGenerator';

// ── Verb guidance ────────────────────────────────────────────
// Universal verb table. Same map the API route uses, lifted here
// so brain + API stay coherent. Adding a verb in one place is
// enough — both pre-gen paths consume it.
export const ACTION_GUIDANCE: Record<string, string> = {
  talk:    'They speak. Show inner thought, then a short cinematic line of dialogue, then a small physical beat.',
  move:    'They move — toward, away, or around. Show how the body shifts and what changes in the scene.',
  observe: 'A quiet moment of seeing. What does the user notice — light, posture, breath, a small detail others miss?',
  inspect: 'A close examination. Reveal a hidden detail, history, or unspoken meaning.',
  comfort: 'A gentle, protective moment. Care, reassurance, a steady hand.',
  fight:   'A burst of controlled action — strike, block, dodge. Stay within the canon\'s ethics; never gratuitous.',
  confront:'A standoff. Words sharper than swords. Posture, silence, and a single decisive line.',
  leap:    'A surge of motion — a vault, a charge, a dive across the space. Show the air, the landing.',
  ask:     'A question is voiced. The other party answers with one revealing line.',
  ally:    'A pact is offered or sealed. A name spoken, a hand extended.',
  guard:   'They stand watch — between someone and harm. Show the quiet readiness.',
  follow:  'They go where another leads. Show what catches their eye en route.',
  honor:   'A gesture of respect or reverence — a bow, a touched feet, a name spoken with weight.',
  petition:'A plea, formally framed. Show the asker\'s vulnerability and the listener\'s judgment.',
  counsel: 'Wisdom shared, not commanded. Show the listener absorbing.',
  learn:   'Something new dawns on them. Show the moment understanding arrives.',
  animate: 'A still thing stirs. Magic, breath, or sudden life — describe the awakening.',
  change:  'A transformation begins. Show the half-step between what was and what comes.',
};

export interface BranchAgentInput {
  bookTitle: string;
  sceneId: string;
  sceneTitle: string;
  sceneNarration: string;
  entityId: string;
  entityLabel: string;
  entityType: PreGeneratedBranch['entityType'];
  action: string;
}

interface RawBranch {
  title: string;
  narration: string;
  sceneText: string;
  imagePrompt: string;
  nextActions: string[];
}

/**
 * Generate a single (entity × action) branch. Returns a PreGeneratedBranch
 * with `status: 'ready'` on success, `status: 'failed'` if safety blocks
 * or generation throws. Never throws — callers can rely on the status
 * field for branching logic.
 */
export async function generateBranch(input: BranchAgentInput): Promise<PreGeneratedBranch> {
  const { bookTitle, sceneId, sceneTitle, sceneNarration, entityId, entityLabel, entityType, action } = input;

  const userPrompt = buildUserPrompt(entityType, entityLabel, action);
  const systemPrompt = buildSystemPrompt(bookTitle, sceneTitle, sceneNarration, action);

  let raw: RawBranch;
  try {
    raw = await callAI(systemPrompt, userPrompt);
  } catch (err) {
    return failedBranch(sceneId, entityId, entityLabel, entityType, action, err);
  }

  const safety = checkContentSafety((raw.narration || '') + ' ' + (raw.sceneText || ''));
  if (!safety.passed) {
    return {
      ...failedBranch(sceneId, entityId, entityLabel, entityType, action, 'safety blocked'),
      narration: 'This content is not available.',
    };
  }

  return {
    branchId: `branch-${sceneId}-${entityId}-${action}-${Date.now()}`,
    parentSceneId: sceneId,
    entityId,
    entityLabel,
    entityType,
    actionType: action,
    title: raw.title || entityLabel,
    narration: raw.narration || '',
    sceneText: raw.sceneText || '',
    imagePrompt: raw.imagePrompt || '',
    imageUrl: null,
    nextActions: raw.nextActions || [],
    status: raw.narration ? 'ready' : 'failed',
  };
}

// ── Internals ────────────────────────────────────────────────

function buildSystemPrompt(bookTitle: string, sceneTitle: string, sceneNarration: string, action: string): string {
  return `You are a Living Story Engine for "${bookTitle}". Generate a rich interactive moment for the scene "${sceneTitle}".
Context: ${sceneNarration.slice(0, 400)}

The user's chosen action is "${action}". The narration MUST reflect that specific verb — different actions on the same entity must feel meaningfully different.

Respond with valid JSON:
{
  "title": "short cinematic title that includes the verb's flavor",
  "narration": "2-3 sentences that TTS will speak aloud (warm, vivid, action-specific)",
  "sceneText": "1 paragraph of rich descriptive text",
  "imagePrompt": "detailed visual description for image generation",
  "nextActions": ["3 follow-up actions the user could take next"]
}`;
}

function buildUserPrompt(entityType: string, entityLabel: string, action: string): string {
  const guidance = ACTION_GUIDANCE[action] || 'Show what unfolds, faithful to the source.';
  const promptMap: Record<string, string> = {
    character: `Interaction with character "${entityLabel}". The user chose to ${action}. ${guidance} Keep it emotional and cinematic.`,
    object:    `Interaction with object "${entityLabel}". The user chose to ${action}. ${guidance}`,
    location:  `Interaction with location "${entityLabel}". The user chose to ${action}. ${guidance}`,
    animal:    `Interaction with animal "${entityLabel}". The user chose to ${action}. ${guidance}`,
    background:`Interaction with detail "${entityLabel}". The user chose to ${action}. ${guidance}`,
  };
  return promptMap[entityType] || promptMap.background;
}

function failedBranch(
  sceneId: string,
  entityId: string,
  entityLabel: string,
  entityType: PreGeneratedBranch['entityType'],
  action: string,
  reason: unknown,
): PreGeneratedBranch {
  if (reason) console.error(`[BranchAgent] Failed for ${entityLabel} × ${action}:`, reason);
  return {
    branchId: `branch-${sceneId}-${entityId}-${action}-failed`,
    parentSceneId: sceneId,
    entityId,
    entityLabel,
    entityType,
    actionType: action,
    title: entityLabel,
    narration: '',
    sceneText: '',
    imagePrompt: '',
    imageUrl: null,
    nextActions: [],
    status: 'failed',
  };
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<RawBranch> {
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
        temperature: 0.8,
        max_tokens: 600,
      });
      return JSON.parse(completion.choices[0]?.message?.content || '{}');
    } catch {
      // Fall through to Gemini
    }
  }

  if (isGeminiConfigured()) {
    const ai = getGeminiClient();
    const model = getTextModel();
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: { systemInstruction: systemPrompt, temperature: 0.8, maxOutputTokens: 800, responseMimeType: 'application/json' },
    });
    return JSON.parse(res.text || '{}');
  }

  throw new Error('No AI configured for branch generation');
}
