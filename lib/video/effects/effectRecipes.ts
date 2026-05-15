// ============================================================
// KathaKitaab — Universal effect recipes
//
// Maps a topic vector + a mood tag to a concrete effects[] array
// that the renderer can apply directly. The output is the value
// that gets baked into manifest scenes — the renderer doesn't have
// to know about topics, only about effect primitives.
//
// Layering rule: recipes accumulate. A scene tagged with both
// `battle` and `fire` gets shake + crimson tint + sparks (battle)
// PLUS embers + warm tint + bloom (fire). Duplicate primitives are
// deduped by `type` keeping the first one — recipes that should
// take priority are added first.
//
// Mood is the floor. If the topic vector is empty (generic scene),
// the mood alone produces a sensible recipe (sacred → divine glow,
// dramatic → battle push effects, somber → desaturation, etc.).
// ============================================================

import type { SceneEffect, TopicWeight } from './types';
import { hasTopic } from './topicTagger';

// ── Topic recipes ───────────────────────────────────────────
// Each topic adds a stack of effects. Designed to compose with
// other topics — keep them tight (3-5 effects each) so the union
// of two topics doesn't bloat to 12+ layers.

function topicEffects(topic: string): SceneEffect[] {
  switch (topic) {
    case 'battle':
      return [
        { type: 'shake', amplitude: 1.6, freq: 0.41 },
        { type: 'tint', color: 'rgba(120,20,10,0.10)' },
        { type: 'particles', kind: 'spark', density: 0.4 },
        { type: 'flash', rateHz: 0.3, color: 'rgba(255,240,210,0.45)' },
        { type: 'vignette', intensity: 0.35 },
      ];
    case 'divine':
      return [
        { type: 'glow', color: 'rgba(255,215,0,0.6)', radius: 0.6, breathHz: 0.04 },
        { type: 'particles', kind: 'gold_dust', density: 0.55 },
        { type: 'dust_shaft', angle: 35, color: 'rgba(255,225,140,0.18)', density: 0.5 },
        { type: 'rim_light', angle: 65, color: 'rgba(255,225,140,0.28)' },
        { type: 'tint', color: 'rgba(255,200,90,0.06)', blendMode: 'screen' },
      ];
    case 'forest':
      return [
        { type: 'particles', kind: 'leaf', density: 0.4 },
        { type: 'dust_shaft', angle: 55, color: 'rgba(180,210,140,0.14)', density: 0.45 },
        { type: 'tint', color: 'rgba(60,120,40,0.06)' },
        // Low ground mist threading between trees adds the "alive
        // forest" feel without any extra asset cost.
        { type: 'fog', intensity: 0.18, color: 'rgba(220,230,210,1)', speed: 0.7 },
      ];
    case 'water':
      return [
        { type: 'ripple', freq: 0.06, amplitude: 1.4, originX: 0.5, originY: 0.7 },
        { type: 'tint', color: 'rgba(70,130,180,0.06)' },
        { type: 'parallax', factor: 0.2 },
        // Wide, low-lying river mist over the surface — distinct from
        // the leaf-particle motes used in forest.
        { type: 'fog', intensity: 0.22, color: 'rgba(200,220,235,1)', speed: 1.1 },
      ];
    case 'fire':
      return [
        { type: 'particles', kind: 'ember', density: 0.65 },
        { type: 'tint', color: 'rgba(255,120,40,0.12)' },
        { type: 'bloom', threshold: 0.65, intensity: 1.4 },
        { type: 'flash', rateHz: 0.15, color: 'rgba(255,180,80,0.3)' },
      ];
    case 'night':
      return [
        { type: 'vignette', intensity: 0.45, color: 'rgba(2,4,16,0.7)' },
        { type: 'tint', color: 'rgba(40,60,120,0.18)' },
      ];
    case 'joy':
      return [
        { type: 'bloom', threshold: 0.7, intensity: 1.5 },
        { type: 'particles', kind: 'spark', density: 0.25 },
        { type: 'tint', color: 'rgba(255,200,120,0.05)', blendMode: 'screen' },
      ];
    case 'exile':
      return [
        { type: 'desaturation', level: 0.4 },
        { type: 'tint', color: 'rgba(40,50,70,0.12)' },
        { type: 'vignette', intensity: 0.3 },
      ];
    case 'mystery':
      return [
        { type: 'particles', kind: 'mist', density: 0.6 },
        { type: 'vignette', intensity: 0.35 },
        { type: 'tint', color: 'rgba(80,60,120,0.06)' },
        // Heavy, slow fog turns "mystery" from "particles + vignette"
        // into a real cinematic atmosphere.
        { type: 'fog', intensity: 0.30, color: 'rgba(190,180,210,1)', speed: 0.5 },
        { type: 'parallax', factor: 0.18 },
      ];
    case 'magic':
      return [
        { type: 'flash', rateHz: 0.5, color: 'rgba(180,140,255,0.4)' },
        { type: 'particles', kind: 'spark', density: 0.5, color: '#C8A0FF' },
        { type: 'glow', color: 'rgba(180,140,255,0.4)', radius: 0.5 },
      ];
    case 'court':
      return [
        { type: 'rim_light', angle: 60, color: 'rgba(255,210,140,0.22)' },
        { type: 'tint', color: 'rgba(120,80,30,0.05)' },
        { type: 'parallax', factor: 0.15 },
      ];
    case 'city':
      return [
        { type: 'particles', kind: 'dust', density: 0.25 },
        { type: 'tint', color: 'rgba(140,100,60,0.05)' },
      ];
    case 'storm':
      return [
        { type: 'flash', rateHz: 0.4, color: 'rgba(220,230,255,0.6)' },
        { type: 'particles', kind: 'rain', density: 0.7 },
        { type: 'vignette', intensity: 0.4 },
        { type: 'tint', color: 'rgba(40,60,90,0.18)' },
      ];
    case 'alliance':
      return [
        { type: 'glow', color: 'rgba(255,215,0,0.32)', radius: 0.4 },
        { type: 'rim_light', angle: 50, color: 'rgba(255,210,140,0.22)' },
      ];
    default:
      return [];
  }
}

// ── Mood floor ──────────────────────────────────────────────
// When the topic vector is empty (or weak), mood alone provides a
// baseline so every scene gets *some* layered effect.

function moodFloor(mood: string | undefined): SceneEffect[] {
  switch (mood) {
    case 'sacred':     return topicEffects('divine');
    case 'dramatic':   return topicEffects('battle').slice(0, 3); // skip flash + vignette to keep dramatic non-battle scenes calm
    case 'somber':     return topicEffects('exile');
    case 'mysterious': return topicEffects('mystery');
    case 'joyful':     return topicEffects('joy');
    case 'serene':     return [{ type: 'particles', kind: 'gold_dust', density: 0.18 }, { type: 'glow', color: 'rgba(255,215,0,0.18)', radius: 0.3, breathHz: 0.03 }];
    default:           return [{ type: 'particles', kind: 'dust', density: 0.18 }];
  }
}

// ── Compose ─────────────────────────────────────────────────

const TYPE_PRIORITY: Record<SceneEffect['type'], number> = {
  // Visual base layers go first (depth/tint).
  desaturation: 1, tint: 2, vignette: 3,
  // Atmospheric particles + dust shaft + rim_light + fog.
  // Fog renders BEFORE particles so motes appear in front of the mist.
  dust_shaft: 4, rim_light: 5, fog: 6, particles: 7,
  // Punctuation: glow / flash / shake / ripple / parallax / bloom.
  glow: 8, flash: 9, shake: 10, ripple: 11, parallax: 12, bloom: 13,
};

/**
 * Build the effects[] array for a scene. Topics drive the bulk; mood
 * is the floor. Effects of the same `type` are deduped — the first
 * occurrence wins, so caller can prepend overrides.
 *
 * Scene-specific overrides (e.g., a hand-authored manifest entry)
 * can be passed as `existing` and will take priority over derived ones.
 */
export function buildSceneEffects(
  topics: TopicWeight[],
  mood: string | undefined,
  existing: SceneEffect[] = [],
): SceneEffect[] {
  const layers: SceneEffect[] = [...existing];

  // Strong-topic recipes first.
  const strong = topics.filter(t => t.weight >= 0.2).map(t => t.topic);
  for (const topic of strong) layers.push(...topicEffects(topic));

  // Weaker topics contribute lighter accents (dedupe will keep priors).
  const weak = topics.filter(t => t.weight < 0.2).map(t => t.topic);
  for (const topic of weak) layers.push(...topicEffects(topic));

  // Mood floor for any uncovered slot.
  layers.push(...moodFloor(mood));

  // Dedupe by type — first occurrence wins.
  const seen = new Set<string>();
  const uniq: SceneEffect[] = [];
  for (const eff of layers) {
    if (seen.has(eff.type)) continue;
    seen.add(eff.type);
    uniq.push(eff);
  }

  // Sort by render priority so the renderer doesn't have to think
  // about layer order. Lower priority = drawn first (further back).
  uniq.sort((a, b) => (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99));

  return uniq;
}

/**
 * Diagnostics — render the topic + mood + effect summary as a single
 * line for the build script log.
 */
export function describeRecipe(topics: TopicWeight[], mood: string | undefined, effects: SceneEffect[]): string {
  const t = topics.length === 0 ? '(none)' : topics.map(x => `${x.topic}:${x.weight.toFixed(2)}`).join(' ');
  const e = effects.map(x => x.type).join(' + ');
  return `topics=[${t}] mood=${mood ?? '?'} → ${e}`;
}

// Re-export the universal hasTopic helper so consumers can do their
// own targeted "is this scene a battle?" checks without re-implementing.
export { hasTopic };
