// ============================================================
// KathaKitaab.ai — Verb → character-layer motion
//
// When a verb fires on a hotspot in the live reader, the camera
// burst (verbCamera.ts) reacts on the whole canvas. This file
// adds the *figure-level* reaction: the character cutout layer
// translates / scales / rotates relative to its bbox, so a leap
// looks like a leap, a fight like a lunge, a bow like a bow.
//
// Universal: book-agnostic verb mapping. Same shape works for
// any character whose bbox we know.
//
// Used by SceneLayers (Wave 2.2) which holds the cutout layer
// and applies the motion via framer-motion's `animate` prop.
// ============================================================

import type { HotspotClickAction } from '@/lib/types/storyScene';
import type { CharacterMotion } from '@/components/livebook/SceneLayers';

const REST: CharacterMotion = {
  dx: 0, dy: 0, scale: 1, rotate: 0,
  durationMs: 400,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

// Per-verb figure motion. Numbers in % of the figure's own bbox.
// These are deliberately small accents — the goal is "this character
// moved" not "the character translated across the screen". Pair with
// the camera burst (verbCamera.ts) for the combined game-feel.
const VERB_MOTION: Partial<Record<HotspotClickAction, CharacterMotion>> = {
  // Quiet, intimate — figure tilts in toward the listener.
  talk: { dx:  2, dy:  0, scale: 1.02, rotate:  1, durationMs: 700, ease: [0.22, 1, 0.36, 1] },
  ask:  { dx:  0, dy:  0, scale: 1.02, rotate:  0, durationMs: 600 },

  // Watching / examining — figure leans forward.
  observe: { dx: 0, dy: -1, scale: 1.03, rotate: 0, durationMs: 700 },
  inspect: { dx: 0, dy: -2, scale: 1.06, rotate: 0, durationMs: 700 },

  // Attack — quick lunge forward and back.
  fight: { dx:  6, dy:  0, scale: 1.04, rotate: -2, durationMs: 480, ease: [0.55, 0, 0.1, 1] },
  // Standoff — chest-up + slight rotate as a defiant posture.
  confront: { dx: 0, dy: -2, scale: 1.04, rotate: 2, durationMs: 520 },

  // Vault — vertical leap with a slight forward-arc landing pose.
  // Note: framer-motion can't sequence dx/dy mid-animation here;
  // we just settle on a peak-of-arc pose; the camera burst handles
  // the actual arc feel.
  leap: { dx:  4, dy: -22, scale: 1.06, rotate: -4, durationMs: 540, ease: [0.34, 1.56, 0.64, 1] },

  // Walking — drift sideways.
  move:   { dx:  8, dy: 0, scale: 1.0,  rotate: 0, durationMs: 700 },
  follow: { dx: 12, dy: 0, scale: 0.98, rotate: 0, durationMs: 800 },

  // Care — small bend toward the recipient.
  comfort: { dx: 0, dy: 1, scale: 1.0, rotate: 2, durationMs: 750 },

  // Watch — squared stance.
  guard:   { dx: 0, dy: -1, scale: 1.02, rotate: 0, durationMs: 600 },

  // Wisdom shared — measured, slight forward tilt.
  counsel: { dx: 0, dy: 0, scale: 1.02, rotate: 1, durationMs: 800 },

  // Reverence — figure bows: shift down + rotate forward.
  honor: { dx: 0, dy:  6, scale: 0.98, rotate:  4, durationMs: 800, ease: [0.45, 0, 0.55, 1] },

  // Pact — slight forward extension.
  ally: { dx: 3, dy: 0, scale: 1.02, rotate: 0, durationMs: 650 },

  // Plea — bow forward and down.
  petition: { dx: 0, dy: 4, scale: 0.98, rotate: 3, durationMs: 700 },

  // Insight — small pulse of scale, no translation.
  learn: { dx: 0, dy: 0, scale: 1.04, rotate: 0, durationMs: 650 },

  // Magic awakening — small shake then settle. Modeled as scale-up.
  animate: { dx: 0, dy: -1, scale: 1.05, rotate: 0, durationMs: 700 },

  // Transformation — slight pull-back as the form shifts.
  change: { dx: 0, dy: 0, scale: 0.98, rotate: 0, durationMs: 700 },

  // Story-onward — figure barely moves; camera does the work.
  continue: { dx: 0, dy: 0, scale: 1.0, rotate: 0, durationMs: 400 },
};

/** Resolve the figure motion for a verb. Unknown verbs return the
 *  rest pose so callers can drive the same animator without a
 *  special case. */
export function motionForVerb(verb: HotspotClickAction): CharacterMotion {
  return VERB_MOTION[verb] ?? REST;
}
