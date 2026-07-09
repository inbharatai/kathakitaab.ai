// ============================================================
// KathaKitaab — Per-scene motion vocabulary
//
// Each scene declares a `motion` token in the manifest. The
// Remotion composition reads it and applies the matching camera
// behavior — no scene-id hardcoding, no alternating Ken-Burns
// pattern, no behavior baked inside the React component.
//
// Motions map to small parameter sets (zoom, pan, shake amplitude,
// glow opacity, tint) so a future book can add a new motion by
// adding a row here, not editing the composition.
//
// Sources:
//   - "slow_zoom_in"   : peaceful / introspective scenes
//   - "slow_zoom_out"  : closing / dénouement scenes
//   - "pan_left"       : exile / journey-away scenes
//   - "pan_right"      : approach / discovery scenes
//   - "divine_glow"    : sacred scenes — slow zoom + radial glow
//                        + golden particles
//   - "battle_push"    : dramatic scenes — stronger zoom-in with
//                        a tasteful low-amplitude camera shake
//   - "fade_only"      : reflective scenes — no pan/zoom, just a
//                        gentle vignette breath
// ============================================================

// NOTE: this module is imported SERVER-SIDE by the manifest synthesizer
// (lib/video/manifestSynthesizer.ts → motionForMood), which the
// /api/books/[slug] route pulls in during Next page-data collection. It
// MUST NOT import the `remotion` package at runtime — doing so evaluates
// remotion's React.createContext at module load, which is undefined in a
// React Server Component context and crashes the build. So the easing is
// exported as a SERIALIZABLE spec (a string key); the Remotion
// compositions resolve that spec to a real `Easing` curve client-side
// (see resolveEasing() in remotion/BookMovie.tsx + BookTrailer.tsx).

export type SceneMotion =
  | 'slow_zoom_in'
  | 'slow_zoom_out'
  | 'pan_left'
  | 'pan_right'
  | 'divine_glow'
  | 'battle_push'
  | 'fade_only';

export interface MotionParams {
  /** Start scale multiplier on the background image. */
  startScale: number;
  /** End scale multiplier — interpolated linearly across scene. */
  endScale: number;
  /** Horizontal drift in px from start to end. */
  panX: number;
  /** Vertical drift in px from start to end. */
  panY: number;
  /** If > 0, applies a low-amplitude shake (battle scenes). */
  shake: number;
  /** Whether to render the divine radial glow + particle layer. */
  glow: boolean;
  /** Optional color tint overlay (rgba). */
  tint?: string;
}

const MOTION_TABLE: Record<SceneMotion, MotionParams> = {
  slow_zoom_in:  { startScale: 1.02, endScale: 1.06, panX:   0, panY:  -4, shake: 0,    glow: false },
  slow_zoom_out: { startScale: 1.06, endScale: 1.02, panX:   0, panY:   0, shake: 0,    glow: false, tint: 'rgba(12,8,6,0.10)' },
  pan_left:      { startScale: 1.04, endScale: 1.06, panX:  -36, panY:  -4, shake: 0,    glow: false, tint: 'rgba(12,8,6,0.18)' },
  pan_right:     { startScale: 1.04, endScale: 1.06, panX:   36, panY:  -4, shake: 0,    glow: false },
  divine_glow:   { startScale: 1.03, endScale: 1.06, panX:   0, panY:  -3, shake: 0,    glow: true,  tint: 'rgba(255,200,90,0.08)' },
  battle_push:   { startScale: 1.04, endScale: 1.08, panX:   0, panY:   0, shake: 1.6,  glow: false, tint: 'rgba(120,20,10,0.10)' },
  fade_only:     { startScale: 1.02, endScale: 1.04, panX:   0, panY:   0, shake: 0,    glow: false },
};

export function motionParams(motion: SceneMotion): MotionParams {
  return MOTION_TABLE[motion] ?? MOTION_TABLE.slow_zoom_in;
}

// ── Easing per motion ───────────────────────────────────────
// Pairs each camera motion with a tasteful easing curve so the
// interpolation feels cinematic instead of metronomic. The `interpolate`
// call in BookMovie / BookTrailer passes `{ easing: resolveEasing(motionEasing(m)) }`
// and the curve shapes the 0..1 progress across the beat window.
//
// Exported as a SERIALIZABLE spec (string) — NOT a remotion Easing value
// — so this module stays server-safe (see the NOTE at the top). The
// compositions resolve the spec to a real `Easing` curve client-side.
//
//   slow_zoom_in   → inOutCubic : gentle settle into the close-up
//   slow_zoom_out  → inOutCubic : gentle pull back
//   pan_left/right → inOutQuad  : drift that eases at both ends
//   divine_glow    → inOutSin   : ethereal softness
//   battle_push    → outCubic   : aggressive slam that decelerates
//   fade_only      → linear     : no motion shape to ease
export type EasingSpec = 'inOutCubic' | 'inOutQuad' | 'inOutSin' | 'outCubic' | 'linear';

const MOTION_EASING: Record<SceneMotion, EasingSpec> = {
  slow_zoom_in:  'inOutCubic',
  slow_zoom_out: 'inOutCubic',
  pan_left:      'inOutQuad',
  pan_right:     'inOutQuad',
  divine_glow:   'inOutSin',
  battle_push:   'outCubic',
  fade_only:     'linear',
};

/** Resolve the easing spec for a motion token. Mirrors `motionParams`
 *  so the composition passes a single `{ easing }` arg to `interpolate`.
 *  Returns a serializable string, NOT a remotion Easing value — the
 *  composition maps it to `Easing` via resolveEasing(). */
export function motionEasing(motion: SceneMotion): EasingSpec {
  return MOTION_EASING[motion] ?? MOTION_EASING.slow_zoom_in;
}

// Mapping from mood → default motion when the manifest does not
// supply an explicit motion field. Keeps hand-authored manifests
// terse without losing per-scene variety.
const MOOD_TO_MOTION: Record<string, SceneMotion> = {
  serene:     'fade_only',
  joyful:     'slow_zoom_in',
  sacred:     'divine_glow',
  somber:     'pan_left',
  mysterious: 'pan_right',
  dramatic:   'battle_push',
};

export function motionForMood(mood: string | undefined): SceneMotion {
  if (!mood) return 'slow_zoom_in';
  return MOOD_TO_MOTION[mood] ?? 'slow_zoom_in';
}
