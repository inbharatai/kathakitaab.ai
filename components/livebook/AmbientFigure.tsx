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
//   • Blink  — quick brightness flicker, only on character
//     hotspots, simulating an eye-blink moment. The point in the
//     cycle when the blink fires is independently phase-offset so
//     adjacent figures don't blink in lockstep.
//   • Aura   — a body-shaped soft radial glow that pulses with
//     the breath. Sized + positioned to the lower 60% of the bbox
//     (where the figure's body actually sits) so it doesn't halo
//     empty bg above the head.
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
function phaseFor(id: string, salt = ''): number {
  let h = 2166136261;
  const s = salt + id;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
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
  const reducedMotion = usePrefersReducedMotion();
  if (reducedMotion) return null;

  const isCharacter = hotspot.type === 'character';
  const isObject = hotspot.type === 'object';
  if (!isCharacter && !isObject) return null;

  const baseId = hotspot.id || `${hotspot.target_id}-${index}`;
  const phase = phaseFor(baseId);
  // Independent phase for blink — without this, every figure blinks
  // at the same fraction of its breath cycle and adjacent figures
  // sync visually. The 'blink' salt produces an uncorrelated value.
  const blinkPhase = phaseFor(baseId, 'blink');
  // Active states quicken the breath/sway timing so a character in
  // mid-fight visibly stirs faster than one at rest. The numbers are
  // small — we don't want to break the "subtle" promise of ambient.
  const stateMultiplier = state === 'idle' ? 1.0
    : state === 'talk'   ? 1.25
    : state === 'fight'  ? 1.7
    : state === 'leap'   ? 1.6
    : state === 'animate'? 1.4
    : 1.15;
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

  const swayDeg = isCharacter ? 1.2 : 0.6;
  const breathPeak = isCharacter ? 1.04 : 1.02;

  // Blink fires at an independently-phased fraction of its own cycle.
  // Without the second phase term, every character flashes at the
  // same midpoint of their breath cycle. Now characters with
  // close breath phases will still blink at different times.
  const blinkAt = 0.18 + blinkPhase * 0.64;        // 0.18..0.82 of cycle
  const blinkCycle = 5.0 + blinkPhase * 3.0;        // 5..8s per blink

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
          {/* Body aura — narrower vertical ellipse positioned over the
              lower 60% of the bbox where the figure's torso/legs sit.
              Painted character figures rarely fill the upper third of
              their hotspot (head + headroom), so a full-bbox aura
              halos empty sky above the head. Tightening to the lower
              60% keeps the glow on the body. */}
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
              left: '12%',
              right: '12%',
              top: '38%',
              bottom: '2%',
              borderRadius: '50% 50% 45% 45% / 60% 60% 40% 40%',
              background: `radial-gradient(ellipse at 50% 50%, ${auraColor} 0%, transparent 70%)`,
              filter: 'blur(8px)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Eye-blink flicker — characters only. Two-keyframe spike
              at `blinkAt` of the cycle (independently phased per
              character so neighbours don't blink in lockstep). */}
          {isCharacter && (
            <motion.div
              animate={{ opacity: [0, 0, 0.42, 0, 0] }}
              transition={{
                duration: blinkCycle,
                times: [0, Math.max(0.001, blinkAt - 0.02), blinkAt, Math.min(0.999, blinkAt + 0.02), 1],
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
