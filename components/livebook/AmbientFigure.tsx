'use client';

// ============================================================
// KathaKitaab.ai — AmbientFigure
//
// Idle-life animation overlay that sits on top of each character
// (and to a lesser extent, object) hotspot bbox. Books arrive as
// flat illustrated PNGs with characters baked in — without any
// motion the scene feels static. AmbientFigure adds a subtle,
// universal presence layer:
//
//   • Breath — gentle scale pulse anchored to the figure's feet
//     (transform-origin 50% 100%) so the chest rises while the
//     ground stays put, the way a person actually breathes.
//   • Sway   — slow ±0.3° rotation around the same anchor; reads
//     as a body shifting weight or a head tilting.
//   • Blink  — quick brightness flicker every ~6s, only on
//     character hotspots, simulating an eye-blink moment.
//   • Aura   — a body-shaped soft radial glow that pulses with
//     the breath. Object hotspots get a slightly cooler aura
//     (no blink, slower sway).
//
// Universal: driven entirely by the hotspot bbox + a deterministic
// per-figure phase offset, so the same scene animates the same way
// every time. No book-specific code anywhere.
//
// Reduced-motion: renders nothing. Static figures already exist in
// the underlying image — the ambient layer is purely additive, so
// removing it is the right zero state for accessibility.
// ============================================================

import { motion } from 'framer-motion';
import type { SceneHotspot } from '@/lib/types/storyScene';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';
import type { CharacterState } from '@/lib/hooks/useCharacterStates';

// Stable hash → 0..1, used to phase-offset each figure so multiple
// characters don't breathe in lockstep. Tiny FNV-1a — deterministic
// across renders and across hosts (vs Math.random which would jitter).
function phaseFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h % 1000) / 1000;
}

interface AmbientFigureProps {
  hotspot: SceneHotspot;
  index: number;
  /** Optional puppet state — when set, the breath/sway timing
   *  intensifies for active states ('talk', 'fight', 'leap', etc.)
   *  and stays calm for 'idle'. Falls back to 'idle' when omitted. */
  state?: CharacterState;
}

export function AmbientFigure({ hotspot, index, state = 'idle' }: AmbientFigureProps) {
  // Each instance subscribes to prefers-reduced-motion via the shared hook.
  // useSyncExternalStore handles SSR safety and re-renders cleanly when the
  // user toggles their OS setting mid-session.
  const reducedMotion = usePrefersReducedMotion();
  if (reducedMotion) return null;

  const isCharacter = hotspot.type === 'character';
  const isObject = hotspot.type === 'object';
  // Skip places/backgrounds — they're not figures, animating them
  // would just be noise.
  if (!isCharacter && !isObject) return null;

  const phase = phaseFor(hotspot.id || `${hotspot.target_id}-${index}`);
  // Active states quicken the breath/sway timing so a character in
  // mid-fight visibly stirs faster than one at rest. The numbers are
  // small — we don't want to break the "subtle" promise of ambient.
  const stateMultiplier = state === 'idle' ? 1.0
    : state === 'talk'   ? 1.25  // chest rises a bit faster while speaking
    : state === 'fight'  ? 1.7
    : state === 'leap'   ? 1.6
    : state === 'animate'? 1.4
    : 1.15;                       // honor / observe / comfort — slight uplift
  // Stagger durations so adjacent figures feel organically out-of-sync.
  const breathSec = (3.4 + phase * 1.2) / stateMultiplier;
  const swaySec   = (5.8 + phase * 1.6) / stateMultiplier;
  const breathDelay = phase * breathSec;
  const swayDelay   = phase * swaySec;

  // Aura color: warm gold for characters (alive, present), cool amber
  // for objects (a tool gleaming in candlelight). Same vocabulary the
  // hotspot rings use, just pushed lower in opacity so it reads as
  // ambient rather than a callout.
  const auraColor = isCharacter
    ? 'rgba(255, 220, 140, 0.18)'
    : 'rgba(232, 170, 90, 0.10)';

  // Sway amplitude — visible enough that the figure clearly reads as
  // alive without crossing into "wobbling cardboard cutout". Earlier
  // values (0.35°) were below the threshold most users perceive on a
  // 1080p display; 1.2° is the sweet spot — readable at a glance,
  // never distracting.
  const swayDeg = isCharacter ? 1.2 : 0.6;
  // Breath scale — 4% at peak shows a clear chest rise. Anchored at
  // the feet (transformOrigin 50% 100%) so the figure breathes
  // upward without the silhouette appearing to grow.
  const breathPeak = isCharacter ? 1.04 : 1.02;

  return (
    <div
      aria-hidden
      data-character-state={state}
      data-character-target={hotspot.target_id}
      style={{
        position: 'absolute',
        left: `${hotspot.x}%`,
        top: `${hotspot.y}%`,
        width: `${hotspot.width}%`,
        height: `${hotspot.height}%`,
        pointerEvents: 'none',
        zIndex: 3,
      }}
    >
      {/* Idle look-around wrapper — head-pivoted rotation that
          animates only while state === 'idle'. Every ~8-14s the figure
          does a small head-tilt that reads as "checking the
          surroundings", then settles. Active states clamp the rotation
          back to 0 so the verb burst owns the motion. Anchored at
          top-center (head pivot) instead of feet so it reads as a
          head turn rather than a body lean. */}
      <motion.div
        animate={state === 'idle'
          ? { rotate: [0, 3.2, 0, -2.6, 0] }
          : { rotate: 0 }}
        transition={state === 'idle'
          ? {
              duration: 6 + phase * 4,
              times: [0, 0.18, 0.42, 0.62, 1],
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 1.0 + phase * 3,
            }
          : { duration: 0.4, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '50% 22%',
          pointerEvents: 'none',
        }}
      >
      {/* Outer wrapper: sway (slow rotation around feet) */}
      <motion.div
        animate={{ rotate: [-swayDeg, swayDeg, -swayDeg] }}
        transition={{
          duration: swaySec,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: swayDelay,
        }}
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: '50% 100%',
        }}
      >
        {/* Inner wrapper: breath (vertical-biased scale around feet).
            Splitting sway and breath onto separate motion.div nodes lets
            them run on independent timelines without interfering — one
            transform per layer, GPU-friendly. */}
        <motion.div
          animate={{ scale: [1, breathPeak, 1] }}
          transition={{
            duration: breathSec,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: breathDelay,
          }}
          style={{
            position: 'absolute',
            inset: 0,
            transformOrigin: '50% 100%',
          }}
        >
          {/* Body aura — vertical ellipse, breath-synced opacity */}
          <motion.div
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{
              duration: breathSec,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: breathDelay,
            }}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50% 50% 45% 45% / 60% 60% 40% 40%',
              background: `radial-gradient(ellipse at 50% 55%, ${auraColor} 0%, transparent 65%)`,
              filter: 'blur(6px)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Eye-blink flicker — characters only. A brief brightness
              spike every ~6s. The two-keyframe spike at the start of
              the cycle is what makes it read as a blink rather than a
              continuous shimmer. */}
          {isCharacter && (
            <motion.div
              animate={{ opacity: [0, 0, 0.42, 0, 0] }}
              transition={{
                duration: 6 + phase * 2,
                times: [0, 0.48, 0.5, 0.52, 1],
                repeat: Infinity,
                ease: 'linear',
                delay: 1.2 + phase * 3,
              }}
              style={{
                position: 'absolute',
                left: '20%',
                right: '20%',
                top: '8%',
                height: '14%',
                borderRadius: '50%',
                background: 'radial-gradient(ellipse, rgba(255,240,200,0.55) 0%, transparent 70%)',
                filter: 'blur(3px)',
                mixBlendMode: 'screen',
              }}
            />
          )}
        </motion.div>
      </motion.div>
      </motion.div>
    </div>
  );
}
