// ============================================================
// KathaKitaab.ai — Universal Effects DSL
//
// One vocabulary for "what's happening on top of this scene image",
// shared between:
//
//   - the live reader (SceneCanvas in components/livebook)
//   - the Remotion BookMovie composition
//   - the Remotion BookTrailer composition
//
// Each effect is a tagged union with its own params. The reader and
// the renderer each maintain a mapping from `type` to a small React
// component. Adding a new effect is a row in the type union + a row
// in two registries.
//
// Why a DSL and not "more motions":
//   - motions move the *camera*; effects layer *over* the scene
//   - a scene can have multiple effects (e.g., divine glow + dust shaft
//     + golden particles) but only one motion
//   - effects are derived from narration topics at build time, so the
//     manifest is the single source of "what makes this scene feel
//     like a battle" or "what makes this scene feel sacred"
// ============================================================

// ── Particle kinds ───────────────────────────────────────────
// Each kind has a built-in set of physics defaults (rise vs fall vs
// drift, color palette, size range) so the effect declaration can
// stay terse. Override fields are optional.
export type ParticleKind =
  | 'ember'       // upward, warm orange/red, small
  | 'gold_dust'   // gentle drift, gold/cream, sparkles
  | 'leaf'        // falling, green/yellow, larger flat shapes
  | 'petal'       // falling spiral, pink/white
  | 'snow'        // slow fall, white, drift
  | 'rain'        // fast fall, slight angle, blue-grey lines
  | 'spark'       // burst-y, white/yellow, short-lived
  | 'firefly'     // drift + blink, yellow-green, glowing
  | 'mist'        // slow horizontal drift, white-grey, soft
  | 'dust';       // ambient drift, sandy, tiny

export interface ParticleEffect {
  type: 'particles';
  kind: ParticleKind;
  /** 0..1 overall density. 0.3 = sparse, 1.0 = heavy. */
  density?: number;
  /** Optional hex color override. */
  color?: string;
  /** Optional size multiplier. 1.0 = default, 2.0 = double size. */
  scale?: number;
}

// ── Light & color ────────────────────────────────────────────

export interface GlowEffect {
  type: 'glow';
  /** Optional rgba/hex. Default golden warm. */
  color?: string;
  /** 0..1, how big the radial reaches. */
  radius?: number;
  /** Slow LFO frequency for breathing. Default 0.04. */
  breathHz?: number;
}

export interface FlashEffect {
  type: 'flash';
  /** How often the flash fires per second (e.g., 0.3 = once every 3.3s). */
  rateHz?: number;
  /** Optional rgba. Default white-ish. */
  color?: string;
  /** Frames the peak holds. Default 3. */
  durationFrames?: number;
}

export interface TintEffect {
  type: 'tint';
  /** rgba — the alpha controls how visible the tint is. */
  color: string;
  /** CSS blend mode. Default 'multiply'. */
  blendMode?: 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'normal';
}

export interface VignetteEffect {
  type: 'vignette';
  /** 0..1 darkness at edges. */
  intensity?: number;
  /** Optional rgba override. Default black. */
  color?: string;
}

export interface RimLightEffect {
  type: 'rim_light';
  /** Angle of the back-light direction in degrees, 0 = top. */
  angle?: number;
  /** rgba. Default warm gold. */
  color?: string;
}

export interface DustShaftEffect {
  type: 'dust_shaft';
  /** Angle of the shaft in degrees, 0 = vertical. */
  angle?: number;
  /** rgba color of the visible light. */
  color?: string;
  /** 0..1 density of dust motes inside the shaft. */
  density?: number;
}

// ── Motion-aux effects (layered with the camera motion) ──────

export interface ShakeEffect {
  type: 'shake';
  /** Amplitude in px on the underlying image translation. */
  amplitude?: number;
  /** Optional carrier frequency. Default 0.41. */
  freq?: number;
}

export interface RippleEffect {
  type: 'ripple';
  /** Origin x/y as 0..1. */
  originX?: number;
  originY?: number;
  /** Wave frequency Hz. */
  freq?: number;
  /** Wave amplitude in px. */
  amplitude?: number;
}

export interface ParallaxEffect {
  type: 'parallax';
  /** Foreground translate factor on pointer move. 0 = none, 1 = full. */
  factor?: number;
}

// ── Color treatment ──────────────────────────────────────────

export interface DesaturationEffect {
  type: 'desaturation';
  /** 0 = full color, 1 = greyscale. */
  level?: number;
}

export interface BloomEffect {
  type: 'bloom';
  /** Brightness threshold above which to bloom (0..1). Default 0.7. */
  threshold?: number;
  /** Bloom intensity multiplier. Default 1.2. */
  intensity?: number;
}

// ── Discriminated union ──────────────────────────────────────

export type SceneEffect =
  | ParticleEffect
  | GlowEffect
  | FlashEffect
  | TintEffect
  | VignetteEffect
  | RimLightEffect
  | DustShaftEffect
  | ShakeEffect
  | RippleEffect
  | ParallaxEffect
  | DesaturationEffect
  | BloomEffect;

export const EFFECT_TYPES: SceneEffect['type'][] = [
  'particles', 'glow', 'flash', 'tint', 'vignette', 'rim_light',
  'dust_shaft', 'shake', 'ripple', 'parallax', 'desaturation', 'bloom',
];

// ── Topic vector ────────────────────────────────────────────
// Topics are universal categories — battle, sacred, forest, water,
// fire, night, joy, exile, mystery, magic, prayer, court — plus the
// long tail of book-specific tags that derive from these. Effects
// are derived from the topic vector via `effectRecipes.ts`.

export interface TopicWeight {
  topic: string;
  weight: number;
}
