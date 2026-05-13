// ============================================================
// lib/openai/dialogueTagger.ts
//
// Backfills SceneDialogue[] for books that don't have it yet —
// the seed Ramayana, every book generated before the dialogue
// schema landed, and any imported source where dialogue can't be
// recovered from the outline LLM.
//
// One LLM pass per scene takes (narration + roster of character
// slugs/names) and returns a 2-5 entry dialogue track tagged with
// speaker slug + kind. The tagger is universal — same prompt works
// for any genre because it only relies on the scene's own narration
// and the book's own character list.
//
// Run via scripts/backfill-dialogue.ts. Cheap: gpt-4o-mini, ~$0.005
// per scene, ~$0.05 for a 10-scene book.
// ============================================================

import OpenAI from 'openai';
import { getOpenAIClient } from './openaiClient';
import type { SceneDialogue } from '@/lib/types/livebook';

const VALID_KINDS = new Set<NonNullable<SceneDialogue['kind']>>([
  'speech',
  'thought',
  'caption',
  'shout',
]);

export interface TaggerCharacter {
  /** Slug used to anchor speech bubbles to hotspots. Must match the
   *  speaker field of the SceneDialogue entries we produce. */
  slug: string;
  /** Display name — gives the LLM something to match in narration. */
  name: string;
  /** Optional role (e.g. "warrior prince", "antagonist"). Helps the
   *  tagger disambiguate when two characters share a first name. */
  role?: string;
  /** Optional aliases / titles the narration may use instead of name. */
  aliases?: string[];
}

export interface TaggerSceneInput {
  scene_id: string;
  title: string;
  /** Full narration block. The tagger reads this to find lines that
   *  read as spoken or thought, then attributes them. */
  narration: string;
}

export interface TaggerSceneOutput {
  scene_id: string;
  dialogue: SceneDialogue[];
}

/**
 * Run the tagger over every scene in a book in parallel batches.
 * Returns one result per scene in input order. Failed scenes return
 * an empty dialogue array so the caller can decide whether to keep
 * the existing scene unchanged or skip the write.
 */
export async function tagBookDialogue(
  scenes: TaggerSceneInput[],
  characters: TaggerCharacter[],
  opts: { concurrency?: number } = {},
): Promise<TaggerSceneOutput[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 6));
  const client = getOpenAIClient();
  const out: TaggerSceneOutput[] = new Array(scenes.length);
  let cursor = 0;

  async function worker() {
    while (cursor < scenes.length) {
      const i = cursor++;
      try {
        const dialogue = await tagSingleScene(client, scenes[i], characters);
        out[i] = { scene_id: scenes[i].scene_id, dialogue };
      } catch (err) {
        console.warn(
          `[dialogueTagger] scene ${scenes[i].scene_id} failed: ${err instanceof Error ? err.message : err}`,
        );
        out[i] = { scene_id: scenes[i].scene_id, dialogue: [] };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

/**
 * Tag a single scene. Exposed for callers that want one-shot
 * tagging (e.g. an admin re-tag button in the future) without the
 * batch overhead.
 */
export async function tagSingleScene(
  client: OpenAI,
  scene: TaggerSceneInput,
  characters: TaggerCharacter[],
): Promise<SceneDialogue[]> {
  const rosterLines = characters.map(c => {
    const aliasFrag = c.aliases?.length ? `; aliases: ${c.aliases.join(', ')}` : '';
    const roleFrag = c.role ? ` (${c.role})` : '';
    return `  - slug: "${c.slug}" | name: ${c.name}${roleFrag}${aliasFrag}`;
  }).join('\n');

  const sys =
    'You are a comic-book script editor. Given a scene narration and the cast roster, ' +
    'you extract 2-5 spoken (or thought, or narrated-caption) beats that capture the ' +
    "scene's energy in punchy in-character lines. Each line is attributed to a speaker " +
    'slug from the roster. You DO NOT invent characters, you DO NOT paraphrase prose ' +
    'into more prose — you produce the lines a comic letterer would put in bubbles.';

  const user = `Scene: "${scene.title}" (scene_id: ${scene.scene_id})

Cast roster (use these slugs exactly):
${rosterLines || '  (no characters; use empty slug for all captions)'}

Narration:
"""
${scene.narration}
"""

Return ONLY a JSON object:
{
  "dialogue": [
    {
      "speaker": "slug from roster, OR empty string '' for a narrator caption",
      "text": "the actual line a comic bubble would carry — under 140 chars, in-character, NO third-person attribution like 'Rama said'",
      "kind": "speech | thought | caption | shout"
    }
  ]
}

Rules:
- 2 to 5 entries. Skip if the scene genuinely has no spoken content.
- Open with a 'caption' if the scene shifts time/place ("Years later, in Lanka...").
- 'speech' is the default for spoken lines.
- 'shout' for battle cries, ultimatums, dramatic exclamations.
- 'thought' only for clearly internal monologue.
- Speaker slug MUST exactly match one of the roster slugs, OR be empty string.
- DO NOT make up new slugs. If a character isn't in the roster, attribute to '' as a caption.
- Lines must read as words actually spoken/thought — quote, not summary.`;

  const r = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.55,
    max_tokens: 900,
  });

  const raw = r.choices[0]?.message?.content ?? '{}';
  let parsed: { dialogue?: Array<{ speaker?: string; text?: string; kind?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const rosterSlugs = new Set(characters.map(c => c.slug));
  const out: SceneDialogue[] = [];
  for (const entry of parsed.dialogue ?? []) {
    if (!entry || typeof entry !== 'object') continue;
    const text = (entry.text ?? '').toString().trim();
    if (text.length === 0) continue;
    const kindRaw = (entry.kind ?? '').toString().trim().toLowerCase();
    const kind: SceneDialogue['kind'] = VALID_KINDS.has(kindRaw as NonNullable<SceneDialogue['kind']>)
      ? (kindRaw as NonNullable<SceneDialogue['kind']>)
      : 'speech';
    // Speaker must either exist in the roster or be empty (caption /
    // unattributed). Anything else collapses to '' so the renderer
    // doesn't try to anchor to a hotspot that won't be found.
    let speaker = (entry.speaker ?? '').toString().trim();
    if (speaker && !rosterSlugs.has(speaker)) speaker = '';
    // A non-caption with no speaker is meaningless — drop it.
    if (!speaker && kind !== 'caption') continue;
    out.push({ speaker, text, kind });
    if (out.length >= 5) break;
  }
  return out;
}
