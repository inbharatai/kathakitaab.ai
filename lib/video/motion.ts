// ============================================================
// KathaKitaab.ai — Per-scene motion vocabulary
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
  slow_zoom_in:  { startScale: 1.04, endScale: 1.14, panX:   0, panY:  -6, shake: 0,    glow: false },
  slow_zoom_out: { startScale: 1.14, endScale: 1.04, panX:   0, panY:   0, shake: 0,    glow: false, tint: 'rgba(12,8,6,0.10)' },
  pan_left:      { startScale: 1.08, endScale: 1.10, panX:  -36, panY:  -4, shake: 0,    glow: false, tint: 'rgba(12,8,6,0.18)' },
  pan_right:     { startScale: 1.08, endScale: 1.10, panX:   36, panY:  -4, shake: 0,    glow: false },
  divine_glow:   { startScale: 1.05, endScale: 1.13, panX:   0, panY:  -3, shake: 0,    glow: true,  tint: 'rgba(255,200,90,0.08)' },
  battle_push:   { startScale: 1.06, endScale: 1.18, panX:   0, panY:   0, shake: 1.6,  glow: false, tint: 'rgba(120,20,10,0.10)' },
  fade_only:     { startScale: 1.05, endScale: 1.07, panX:   0, panY:   0, shake: 0,    glow: false },
};

export function motionParams(motion: SceneMotion): MotionParams {
  return MOTION_TABLE[motion] ?? MOTION_TABLE.slow_zoom_in;
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
