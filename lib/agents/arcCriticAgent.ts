// ============================================================
// KathaKitaab — Whole-arc QA Critic
//
// Runs ONE gpt-4o-mini pass over the entire book (outline + every
// scene narration + every branch narration) to catch arc-level breaks
// the per-scene QA can't see:
//   - a setup in scene N that never pays off
//   - a character arc that flatlines (no change across the book)
//   - a contradiction between an early scene and a late one
//
// Returns { score: 0..100, issues: [...] }. The caller serialises
// issues into book.qaNotes when score < 80. It is NON-BLOCKING — it
// never triggers a regeneration; it only records notes for the
// operator / UI to surface.
//
// Degrade-to-skip: when no AI is configured, returns score=100 with
// no issues (mirrors lib/agents/branchQAAgent.ts:93-95) so a missing
// key means "skip the critic", never "fail the generation".
//
// Opt-in: the caller gates this on
//   process.env.KATHA_ARC_CRITIC_ENABLED === '1'
// (default OFF — mirrors canRenderMp4 in render-movie/route.ts).
// ============================================================

import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';

export interface ArcCritique {
  /** 0..100 overall arc coherence score. */
  score: number;
  /** One-line descriptions of each arc-level break found. Empty when
   *  the arc is coherent (or when the critic was skipped). */
  issues: string[];
}

interface ArcCritiqueBook {
  title: string;
  scenes: Array<{ scene_id: string; title: string; narration: string }>;
  characters?: Array<{ name: string; role: string; short_summary?: string }>;
}

const SYSTEM_PROMPT = `You are a strict whole-arc QA critic for an interactive storybook.
You read the ENTIRE book — outline titles + every scene narration — and look ONLY for arc-level breaks that a per-scene reader would miss:

  1. Setup without payoff — a promise made in an early scene (a foreshadowed object, a planted question, a stated goal) that is never resolved or referenced again.
  2. Flatlining character arc — a named character whose emotional state / understanding / situation never changes across the scenes they appear in.
  3. Cross-scene contradiction — an event, fact, or relationship stated in an early scene that a later scene contradicts.

Do NOT flag prose quality, vocabulary, or single-scene issues — those belong to per-scene QA. Only flag structural, whole-book problems.

Respond with valid JSON only:
{
  "score": 0-100,
  "issues": ["one-line description of each arc break found"]
}

score guide:
- 100: tight arc, every setup pays off, characters move, no contradictions.
- 80-99: minor loose thread, no contradictions.
- 50-79: one significant unresolved setup or a flat arc.
- below 50: a hard contradiction or multiple unresolved setups.`;

function buildUserPrompt(book: ArcCritiqueBook): string {
  const sceneBlock = book.scenes
    .map((s, i) => `Scene ${i + 1} — "${s.title}" (id: ${s.scene_id}):\n${(s.narration ?? '').trim()}`)
    .join('\n\n---\n\n');

  const charBlock = (book.characters && book.characters.length > 0)
    ? '\n\nCharacters:\n' + book.characters
        .map(c => `- ${c.name} (${c.role})${c.short_summary ? ` — ${c.short_summary}` : ''}`)
        .join('\n')
    : '';

  return `Book: "${book.title}"

Full scene narrations (in order):
${sceneBlock}${charBlock}

Score the whole arc.`;
}

/**
 * Critique the whole book arc. Returns {score:100, issues:[]} when no
 * AI is configured — callers treat that as "skip the critic, ship the
 * book". Network or parse failures degrade to score=100, issues=[]
 * as well: the critic is non-blocking and never fails a generation.
 */
export async function critiqueArc(book: ArcCritiqueBook): Promise<ArcCritique> {
  const SKIP: ArcCritique = { score: 100, issues: [] };
  if (!isOpenAIConfigured()) return SKIP;
  if (!book.scenes || book.scenes.length === 0) return SKIP;

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: getOpenAIModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(book) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw) as { score?: number; issues?: unknown };

    const score = clamp(Number(parsed.score), 0, 100);
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .map(i => (typeof i === 'string' ? i.trim() : ''))
          .filter(i => i.length > 0)
          .slice(0, 10)
      : [];

    return { score, issues };
  } catch (err) {
    // Non-blocking: a critic failure must never break generation.
    console.error('[ArcCritic] critique failed:', err instanceof Error ? err.message : err);
    return SKIP;
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return max;
  return Math.max(min, Math.min(max, n));
}