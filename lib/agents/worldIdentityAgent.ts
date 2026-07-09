// ============================================================
// KathaKitaab — World-Identity agent (universal World engine)
//
// The World engine's deterministic mood/biome/palette derivation is
// a UNIVERSAL lexicon (see lib/world/worldManifest.ts) — no key needed,
// works for any story. This agent is the OPT-IN refinement: ONE
// gpt-4o-mini call reads the book's actual prose (titles + scene
// descriptions) and assigns each scene a mood, biome, ambient tag, and
// picks a palette family for the whole book. The result is stored on
// the book as `worldIdentity` and OVERRIDES the deterministic lexicon
// inside `synthesizeWorldManifest` — so the world reads FROM the story.
//
// Why this is the universality lever: previously mood/biome were a
// Ramayana-tinted keyword list, so every non-Ramayana story collapsed to
// 'serene'/'wilds'. The deterministic lexicon fixes that for all
// stories with no key; THIS agent adds nuance a keyword match can't
// (reading actual prose tone + setting) when a key is present.
//
// Degrade-to-null: when no AI is configured, or on any network/parse
// error, returns `null` — the caller falls back to the deterministic
// `deriveWorldIdentity(scenes)`, so the no-key path is always real.
// (Mirrors lib/agents/branchQAAgent.ts:93-95 + arcCriticAgent.ts.)
//
// Opt-in: the caller gates this on
//   process.env.KATHA_WORLD_IDENTITY_ENABLED === '1'
// (default OFF — mirrors canRenderMp4 in render-movie/route.ts).
// ============================================================

import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import type { Biome, PaletteFamily, WorldIdentity, WorldIdentityNode } from '@/lib/world/worldManifest';

// Valid vocabularies — MUST stay in sync with worldManifest.ts
// (MOOD_EMOJI keys, the Biome union, the PaletteFamily union).
const MOODS = ['joyful', 'serene', 'tense', 'somber', 'sacred', 'mysterious', 'dramatic'] as const;
const BIOMES: readonly Biome[] = [
  'city', 'forest', 'river', 'temple', 'palace', 'battlefield', 'shore',
  'mountain', 'village', 'wilds', 'desert', 'snow', 'volcano', 'ocean', 'cave',
];
const PALETTE_FAMILIES: readonly PaletteFamily[] = [
  'warm_gold', 'blood', 'cold_desaturated', 'violet', 'verdant', 'twilight', 'dawn',
];
const AMBIENTS = ['birds', 'drone', 'bells', 'wind', 'crowd', 'water', 'fire', 'silence'] as const;

const MOOD_SET = new Set<string>(MOODS);
const BIOME_SET = new Set<string>(BIOMES as readonly string[]);
const PALETTE_SET = new Set<string>(PALETTE_FAMILIES as readonly string[]);
const AMBIENT_SET = new Set<string>(AMBIENTS);

interface WorldIdentityBook {
  title: string;
  scenes: Array<{ scene_id: string; title: string; visual_description?: string; short_summary?: string }>;
}

const SYSTEM_PROMPT = `You assign a "world identity" to an interactive storybook so its explorable 3D world reflects the story's actual tone and setting — not a generic template.

For EACH scene, choose:
- mood: one of ${MOODS.join(', ')}
- biome: one of ${BIOMES.join(', ')}
- ambient: one of ${AMBIENTS.join(', ')} (the background sound bed)

Then choose ONE paletteFamily for the WHOLE book that matches its dominant emotional color:
- ${PALETTE_FAMILIES.join(', ')}

Read the scene's title + visual_description + short_summary to decide. Be faithful to the ACTUAL setting the prose describes — if a scene is a desert, pick 'desert'; if a frozen north, pick 'snow'; if a battle, 'battlefield'. Do NOT default everything to 'serene'/'wilds'.

Respond with valid JSON only:
{
  "paletteFamily": "<one of the palette families>",
  "nodes": [
    { "sceneId": "<the scene id>", "mood": "<...>", "biome": "<...>", "ambient": "<...>" }
  ]
}`;

function buildUserPrompt(book: WorldIdentityBook): string {
  const sceneBlock = book.scenes
    .map(s => `id=${s.scene_id} | "${s.title}" | ${[s.visual_description, s.short_summary].filter(Boolean).join(' / ')}`)
    .join('\n');
  return `Book: "${book.title}"\n\nScenes:\n${sceneBlock}\n\nAssign the world identity.`;
}

/** Parse + validate the LLM response into a `WorldIdentity`, coercing
 *  any out-of-vocabulary value to a safe fallback so a hallucinated
 *  mood/biome can never crash the synthesizer. Drops scenes the model
 *  didn't return or returned with a bad id. */
function normalize(book: WorldIdentityBook, parsed: unknown): WorldIdentity | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as { paletteFamily?: unknown; nodes?: unknown };

  let paletteFamily: PaletteFamily = 'verdant';
  if (typeof p.paletteFamily === 'string' && PALETTE_SET.has(p.paletteFamily)) {
    paletteFamily = p.paletteFamily as PaletteFamily;
  }

  const knownScenes = new Set(book.scenes.map(s => s.scene_id));
  const nodes: WorldIdentityNode[] = [];
  if (Array.isArray(p.nodes)) {
    for (const raw of p.nodes) {
      if (!raw || typeof raw !== 'object') continue;
      const n = raw as { sceneId?: unknown; mood?: unknown; biome?: unknown; ambient?: unknown };
      const sceneId = typeof n.sceneId === 'string' ? n.sceneId : '';
      if (!sceneId || !knownScenes.has(sceneId)) continue;
      const mood = typeof n.mood === 'string' && MOOD_SET.has(n.mood) ? n.mood : 'serene';
      const biome = typeof n.biome === 'string' && BIOME_SET.has(n.biome) ? (n.biome as Biome) : 'wilds';
      const ambient = typeof n.ambient === 'string' && AMBIENT_SET.has(n.ambient) ? n.ambient : undefined;
      nodes.push({ sceneId, mood, biome, ambient });
    }
  }
  if (nodes.length === 0) return null;
  return { paletteFamily, nodes };
}

/**
 * Synthesize a `WorldIdentity` for the book via one gpt-4o-mini call.
 * Returns `null` when no AI is configured, the gate is off, or any
 * network/parse failure occurs — callers MUST then fall back to
 * `deriveWorldIdentity(scenes)` (the deterministic universal lexicon),
 * so the no-key path is always real and proven.
 */
export async function synthesizeWorldIdentity(book: WorldIdentityBook): Promise<WorldIdentity | null> {
  if (!isOpenAIConfigured()) return null;
  if (!book.scenes || book.scenes.length === 0) return null;

  try {
    const client = getOpenAIClient();
    // Cap the payload for very long books — the first ~24 scenes give
    // enough signal for a world identity; a 40-scene book would blow the
    // token budget for marginal gain.
    const payload: WorldIdentityBook = {
      title: book.title,
      scenes: book.scenes.slice(0, 24),
    };

    const completion = await client.chat.completions.create({
      model: getOpenAIModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(payload) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1600,
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    return normalize(book, parsed);
  } catch (err) {
    // Non-blocking: a world-identity failure must never break generation.
    console.error('[WorldIdentity] synthesis failed:', err instanceof Error ? err.message : err);
    return null;
  }
}