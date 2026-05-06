// ============================================================
// KathaKitaab.ai — Verb-keyed camera moves
//
// When a user picks an action verb on a hotspot (Talk, Fight,
// Leap, Comfort, Honor, …), the camera reacts. This is the
// "game-feel" lever — instead of every interaction beginning
// with the same flat fade-in, the camera dollies, pushes,
// shakes, or arcs to match what the verb means.
//
// Universal: book-agnostic verb vocabulary (matches the same
// HotspotClickAction set the QA agent + branch agent already
// share). New verb? Add a row, both Remotion + the live reader
// pick it up.
//
// Output is small — start/end transforms + a duration. The
// caller animates from start to end over duration milliseconds,
// then snaps back to identity (or hands off to FlipbookPage).
// ============================================================

import type { HotspotClickAction } from '@/lib/types/storyScene';

export interface CameraBurst {
  /** Initial transform applied immediately when the burst starts. */
  fromScale: number;
  fromX: number;          // px relative to scene canvas
  fromY: number;
  /** Final transform reached at the end of the burst. */
  toScale: number;
  toX: number;
  toY: number;
  /** Optional camera shake amplitude in px. 0 disables. */
  shake: number;
  /** Total burst duration in ms. Caller's animator targets this. */
  durationMs: number;
  /** CSS easing curve. Different verbs deserve different feels:
   *  ease-out for quick-arrivals, ease-in-out for measured beats. */
  ease: string;
  /** Optional post-flash overlay color (rgba). Reads as an impact
   *  beat. Ignored when undefined. */
  flash?: string;
}

const NEUTRAL: CameraBurst = {
  fromScale: 1.0,
  fromX: 0,
  fromY: 0,
  toScale: 1.0,
  toX: 0,
  toY: 0,
  shake: 0,
  durationMs: 500,
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
};

// Per-verb camera intent. The numbers are deliberately small — these
// are accents on top of the existing Ken Burns drift, not full camera
// rigs. A reader will perceive the verb instantly without feeling like
// the page jolts.
const VERB_CAMERA: Partial<Record<HotspotClickAction, CameraBurst>> = {
  // Quiet, intimate. Slow dolly-in toward the speaker.
  talk: {
    ...NEUTRAL,
    fromScale: 1.0, toScale: 1.05,
    durationMs: 650,
    ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  // Prompted question. Same dolly as talk but slightly less intense
  // — the user is asking, not being addressed.
  ask: {
    ...NEUTRAL,
    toScale: 1.04,
    durationMs: 600,
  },
  // Thoughtful look. Tiny pull-in + slight downward tilt.
  observe: {
    ...NEUTRAL,
    toScale: 1.06,
    toY: -8,
    durationMs: 700,
  },
  // Close examination. Stronger pull-in, no shake — focused.
  inspect: {
    ...NEUTRAL,
    toScale: 1.12,
    durationMs: 700,
    ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  // Action push. Fast, low-amplitude shake, slight side-jog.
  fight: {
    ...NEUTRAL,
    toScale: 1.10,
    toX: -6,
    shake: 3,
    durationMs: 480,
    ease: 'cubic-bezier(0.55, 0, 0.1, 1)',
    flash: 'rgba(255, 200, 60, 0.18)',
  },
  // Standoff — sharp pull-in, no shake, slight tint via flash.
  confront: {
    ...NEUTRAL,
    toScale: 1.08,
    durationMs: 520,
    ease: 'cubic-bezier(0.6, 0, 0.2, 1)',
    flash: 'rgba(120, 20, 10, 0.12)',
  },
  // Vault / charge — vertical arc. Up first then settle.
  leap: {
    fromScale: 1.0, toScale: 1.06,
    fromX: 0, fromY: 0,
    toX: 0, toY: -22,
    shake: 1.4,
    durationMs: 550,
    ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // overshoot like a jump
  },
  // Movement. Side-tracking pan toward the destination.
  move: {
    ...NEUTRAL,
    toScale: 1.04,
    toX: 14,
    durationMs: 600,
  },
  // Following someone. Same shape as move but tracks the leader's
  // implied direction — the reader supplies the direction by their
  // tap location, the renderer just biases the move.
  follow: {
    ...NEUTRAL,
    toScale: 1.05,
    toX: 18,
    durationMs: 700,
  },
  // Gentle care. Soft pull-in, no shake, eased in/out.
  comfort: {
    ...NEUTRAL,
    toScale: 1.04,
    durationMs: 750,
    ease: 'cubic-bezier(0.45, 0, 0.55, 1)',
  },
  // Watchful protection. Tiny pull-in, no shake.
  guard: {
    ...NEUTRAL,
    toScale: 1.03,
    durationMs: 600,
  },
  // Wisdom shared. Slow, dignified zoom.
  counsel: {
    ...NEUTRAL,
    toScale: 1.05,
    durationMs: 800,
    ease: 'cubic-bezier(0.45, 0, 0.55, 1)',
  },
  // Reverence. Slow downward pan + dim flash like a ceremonial light.
  honor: {
    ...NEUTRAL,
    toScale: 1.04,
    toY: 10,
    durationMs: 750,
    ease: 'cubic-bezier(0.45, 0, 0.55, 1)',
    flash: 'rgba(255, 200, 90, 0.10)',
  },
  // Sealing a pact. Steady push-in, no movement.
  ally: {
    ...NEUTRAL,
    toScale: 1.05,
    durationMs: 650,
  },
  // Plea. Slight downward pull (asker low) and drift toward listener.
  petition: {
    ...NEUTRAL,
    toScale: 1.05,
    toY: 6,
    toX: 8,
    durationMs: 700,
  },
  // Insight. Small pulse — pull-in then gentle pull-back ½ way.
  learn: {
    ...NEUTRAL,
    toScale: 1.06,
    durationMs: 700,
    flash: 'rgba(255, 240, 200, 0.12)',
  },
  // Magic / awakening. Brief flash + scale wobble.
  animate: {
    ...NEUTRAL,
    toScale: 1.07,
    durationMs: 700,
    flash: 'rgba(180, 220, 255, 0.20)',
  },
  // Transformation. Slow widening as something shifts.
  change: {
    fromScale: 1.0, toScale: 0.97,  // slight pull-back
    fromX: 0, fromY: 0,
    toX: 0, toY: 0,
    shake: 0,
    durationMs: 700,
    ease: 'cubic-bezier(0.45, 0, 0.55, 1)',
    flash: 'rgba(255, 200, 90, 0.10)',
  },
  // Story onward. Soft fade-forward push.
  continue: {
    ...NEUTRAL,
    toScale: 1.03,
    durationMs: 500,
  },
};

/**
 * Resolve the camera burst for a verb. Unknown verbs return the neutral
 * shape so callers can drive the same animator without a special case.
 */
export function cameraForVerb(verb: HotspotClickAction): CameraBurst {
  return VERB_CAMERA[verb] ?? NEUTRAL;
}

/**
 * Bias the burst's pan delta so it points toward a target hotspot's
 * center. Used by SceneCanvas to make Talk dolly *into* the speaker
 * instead of always pulling toward scene-center. Coordinates in
 * percent (0..100); returns a CameraBurst with toX/toY adjusted in px.
 *
 * Caller passes the canvas size so the percentage delta resolves to
 * the actual pixel offset. If size is missing, the original burst is
 * returned unchanged.
 */
export function aimBurstAtTarget(
  burst: CameraBurst,
  targetXPct: number,
  targetYPct: number,
  canvasW: number,
  canvasH: number,
): CameraBurst {
  if (!canvasW || !canvasH) return burst;
  // Distance from canvas center to target, in pixels. Negate so a
  // target on the right makes the camera pan LEFT (drawing the
  // viewport toward the right).
  const dx = ((targetXPct - 50) / 100) * canvasW;
  const dy = ((targetYPct - 50) / 100) * canvasH;
  // Bias the existing toX/toY by a fraction of the delta, scaled by
  // the burst's intended movement magnitude. This way a "tiny dolly"
  // verb still mostly stays put, while a "side-tracking move" really
  // tracks the target.
  const bias = 0.35;
  return {
    ...burst,
    toX: burst.toX + -dx * bias,
    toY: burst.toY + -dy * bias,
  };
}
