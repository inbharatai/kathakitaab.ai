// ============================================================
// KathaKitaab.ai — Universal topic tagger
//
// Maps narration text to a weighted topic vector. The vector drives
// effect recipes (which particles, glow, tint, shake, etc. should
// layer on a scene). Pure function, deterministic, dependency-free.
//
// Strategy: keyword-set matching with light scoring. For every topic
// we maintain a set of unambiguous trigger words. A scene scores on
// a topic when its narration (lowercased) contains the trigger; the
// score is the count of distinct triggers that hit, normalized by
// the count of triggers in the topic's word set.
//
// Why not embeddings or LLM tagging here?
//   - Build-time speed: every scene tags in <1ms.
//   - Deterministic: same narration → same topics → same effects.
//     CI / verifier can reason about output.
//   - Universal: no per-book dictionary. One word set covers Ramayana,
//     Mahabharata, Panchatantra, fantasy, sci-fi, history. New books
//     don't need a new tagger pass.
//   - Free: zero API cost during build.
//
// If a book wants richer tagging later, an LLM-based tagger can
// produce a strict superset of these topics — same shape, same
// recipes. This file is the floor, not the ceiling.
// ============================================================

import type { TopicWeight } from './types';

// ── Topic dictionary ────────────────────────────────────────
// Each topic lists its unambiguous trigger words. Triggers are
// matched as whole words or simple stems to avoid false positives
// ("battlement" doesn't trigger "battle"; "wind" doesn't trigger
// "wind" the topic, "sword" does).
//
// Triggers are intentionally conservative — we'd rather a scene
// score *no* topic than a wrong one (the recipe falls back to mood-
// derived effects in that case).

interface TopicSpec {
  triggers: string[];
}

const TOPICS: Record<string, TopicSpec> = {
  battle:   { triggers: ['battle', 'war', 'fight', 'sword', 'arrow', 'army', 'warrior', 'clash', 'attack', 'combat'] },
  divine:   { triggers: ['divine', 'sacred', 'god', 'goddess', 'temple', 'blessing', 'holy', 'celestial', 'heaven', 'pray', 'prayer', 'mantra'] },
  forest:   { triggers: ['forest', 'jungle', 'woods', 'tree', 'grove', 'wilderness', 'sage', 'hermitage', 'panchavati', 'dandaka'] },
  water:    { triggers: ['river', 'ocean', 'sea', 'lake', 'water', 'wave', 'shore', 'stream', 'rain'] },
  fire:     { triggers: ['fire', 'flame', 'burn', 'ember', 'pyre', 'torch', 'lit', 'kindle'] },
  night:    { triggers: ['night', 'dark', 'shadow', 'moon', 'midnight', 'gloom'] },
  joy:      { triggers: ['celebrate', 'celebration', 'rejoice', 'joy', 'crown', 'wedding', 'lamp', 'festival', 'return'] },
  exile:    { triggers: ['exile', 'farewell', 'parted', 'sorrow', 'grief', 'loss', 'wept', 'tears', 'banish'] },
  mystery:  { triggers: ['mystery', 'enchant', 'illusion', 'hidden', 'secret', 'disguised', 'cloak', 'stealth', 'magical', 'enchanting'] },
  magic:    { triggers: ['magic', 'spell', 'transform', 'vimana', 'chariot', 'soared', 'flew', 'leap'] },
  court:    { triggers: ['palace', 'throne', 'king', 'queen', 'kingdom', 'court', 'ruler', 'dasharatha', 'sandals'] },
  city:     { triggers: ['city', 'gate', 'street', 'crowd', 'lanka', 'ayodhya', 'mithila', 'marketplace'] },
  storm:    { triggers: ['storm', 'thunder', 'lightning', 'tempest', 'wind howled', 'gale'] },
  alliance: { triggers: ['ally', 'pact', 'oath', 'vow', 'pledge', 'devotion', 'loyalty', 'friendship'] },
};

// Normalize narration once — lowercase, strip non-letters except
// space/period/exclamation/question.
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\s.!?']/gu, ' ').replace(/\s+/g, ' ');
}

// Whole-word match — protects against substring false positives
// ("city" inside "publicity" shouldn't match).
function containsWord(haystack: string, needle: string): boolean {
  // Allow the needle to be either a single word or a short multi-word
  // phrase. For phrases we match as a substring with surrounding
  // whitespace boundaries.
  const re = needle.includes(' ')
    ? new RegExp(`(^|\\s)${escapeRegex(needle)}(\\s|$|[.!?])`, 'i')
    : new RegExp(`(^|\\s)${escapeRegex(needle)}s?(\\s|$|[.!?,;:])`, 'i');
  return re.test(haystack);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Score every topic's triggers against the narration. Returns the
 * topics that scored above a threshold, sorted by weight desc. Empty
 * array means the narration was too generic to tag — caller should
 * fall back to mood-derived effects.
 */
export function detectTopics(narration: string, opts: { threshold?: number; maxTopics?: number } = {}): TopicWeight[] {
  const threshold = opts.threshold ?? 0.15;
  const maxTopics = opts.maxTopics ?? 5;
  const text = ' ' + normalize(narration) + ' ';

  const scored: TopicWeight[] = [];
  for (const [topic, spec] of Object.entries(TOPICS)) {
    let hits = 0;
    for (const trigger of spec.triggers) {
      if (containsWord(text, trigger)) hits++;
    }
    if (hits === 0) continue;
    const weight = hits / spec.triggers.length;
    if (weight >= threshold) scored.push({ topic, weight });
  }

  scored.sort((a, b) => b.weight - a.weight);
  return scored.slice(0, maxTopics);
}

/**
 * Convenience — true if the topic vector contains a topic with at
 * least the given weight. Used by the recipe layer.
 */
export function hasTopic(vec: TopicWeight[], topic: string, minWeight = 0.1): boolean {
  return vec.some(t => t.topic === topic && t.weight >= minWeight);
}

/**
 * Public list of all topic names — used by the verifier and any
 * tooling that wants to enumerate.
 */
export function listTopics(): string[] {
  return Object.keys(TOPICS);
}
