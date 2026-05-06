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
}

export function AmbientFigure({ hotspot, index }: AmbientFigureProps) {
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
  // Stagger durations so adjacent figures feel organically out-of-sync.
  const breathSec = 3.4 + phase * 1.2;
  const swaySec   = 5.8 + phase * 1.6;
  const breathDelay = phase * breathSec;
  const swayDelay   = phase * swaySec;

  // Aura color: warm gold for characters (alive, present), cool amber
  // for objects (a tool gleaming in candlelight). Same vocabulary the
  // hotspot rings use, just pushed lower in opacity so it reads as
  // ambient rather than a callout.
  const auraColor = isCharacter
    ? 'rgba(255, 220, 140, 0.18)'
    : 'rgba(232, 170, 90, 0.10)';

  // Sway amplitude is small on purpose — bigger numbers cross from
  // "alive" into "wobbling cardboard cutout".
  const swayDeg = isCharacter ? 0.35 : 0.18;
  // Breath scale similarly subtle; 1.5% at peak is just enough that
  // the eye notices the chest rise without seeing the figure grow.
  const breathPeak = isCharacter ? 1.015 : 1.008;

  return (
    <div
      aria-hidden
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
    </div>
  );
}
