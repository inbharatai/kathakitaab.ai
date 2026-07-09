// ============================================================
// KathaKitaab — Universal effect layers
//
// One React layer per effect type. Each component takes a `frame`
// number (current frame at fps) and renders a deterministic visual
// for that frame. Same components are used by:
//
//   - the live reader (SceneCanvas): `frame` is incremented by a
//     requestAnimationFrame loop pinned to performance.now().
//   - Remotion BookMovie/BookTrailer: `frame` is `useCurrentFrame()`.
//
// Critical constraint: NO Remotion-specific imports here. Remotion's
// `random()` is replaced with a small deterministic hash so the same
// seed produces the same number in any host.
// ============================================================

import React from 'react';
import type {
  SceneEffect, ParticleEffect, ParticleKind,
} from './types';

// Deterministic random — small mulberry32-like hash so seed strings
// produce consistent values in both reader and Remotion contexts.
function seededRandom(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295);
}

// ── Particle palette + physics ──────────────────────────────

interface ParticleStyle {
  count: number;
  baseColor: string;
  glow: string;
  sizeMin: number;
  sizeMax: number;
  /** rise (-y) | fall (+y) | drift (slow horizontal). */
  motion: 'rise' | 'fall' | 'drift' | 'spiral';
  /** speed multiplier. Smaller = slower. */
  speed: number;
}

const PARTICLE_STYLES: Record<ParticleKind, ParticleStyle> = {
  ember:     { count: 24, baseColor: '#FFA040', glow: 'rgba(255,160,80,0.85)',  sizeMin: 2, sizeMax: 6,  motion: 'rise',   speed: 0.9 },
  gold_dust: { count: 28, baseColor: '#FFE7A6', glow: 'rgba(255,231,166,0.9)',  sizeMin: 2, sizeMax: 5,  motion: 'drift',  speed: 0.4 },
  leaf:      { count: 16, baseColor: '#A8C770', glow: 'rgba(168,199,112,0.6)',  sizeMin: 6, sizeMax: 10, motion: 'fall',   speed: 0.6 },
  petal:     { count: 18, baseColor: '#FFC1D6', glow: 'rgba(255,193,214,0.7)',  sizeMin: 5, sizeMax: 9,  motion: 'spiral', speed: 0.5 },
  snow:      { count: 32, baseColor: '#FFFFFF', glow: 'rgba(255,255,255,0.55)', sizeMin: 2, sizeMax: 5,  motion: 'fall',   speed: 0.5 },
  rain:      { count: 40, baseColor: '#9ECDE6', glow: 'rgba(158,205,230,0.4)',  sizeMin: 1, sizeMax: 2,  motion: 'fall',   speed: 1.7 },
  spark:     { count: 22, baseColor: '#FFEFAF', glow: 'rgba(255,239,175,0.95)', sizeMin: 1, sizeMax: 3,  motion: 'rise',   speed: 1.4 },
  firefly:   { count: 14, baseColor: '#E8FF9A', glow: 'rgba(232,255,154,0.95)', sizeMin: 3, sizeMax: 5,  motion: 'drift',  speed: 0.3 },
  mist:      { count: 18, baseColor: '#E8E8F4', glow: 'rgba(232,232,244,0.45)', sizeMin: 14, sizeMax: 32, motion: 'drift', speed: 0.25 },
  dust:      { count: 22, baseColor: '#D4B988', glow: 'rgba(212,185,136,0.6)',  sizeMin: 1, sizeMax: 3,  motion: 'drift',  speed: 0.3 },
};

// Stage size — particles position relative to a 1920×1080 canvas
// and the wrapper scales them via percentage layout. Both reader
// and Remotion use the same logical size, so coordinates port.
const STAGE_W = 1920;
const STAGE_H = 1080;

// ── Layer components ────────────────────────────────────────

interface LayerProps { frame: number; fps: number }

const Particles: React.FC<LayerProps & { effect: ParticleEffect; seedPrefix: string }> = ({ frame, fps, effect, seedPrefix }) => {
  const style = PARTICLE_STYLES[effect.kind];
  const density = effect.density ?? 0.7;
  const count = Math.max(4, Math.round(style.count * density));
  const color = effect.color ?? style.baseColor;
  const scale = effect.scale ?? 1;

  // Particle list is stable for the layer's lifetime — we precompute
  // each particle's seeds. Per-frame work is just the position math.
  const particles = React.useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      id: i,
      sx: seededRandom(`${seedPrefix}-${effect.kind}-x-${i}`),
      sy: seededRandom(`${seedPrefix}-${effect.kind}-y-${i}`),
      sd: seededRandom(`${seedPrefix}-${effect.kind}-d-${i}`),
      ss: seededRandom(`${seedPrefix}-${effect.kind}-s-${i}`),
    })),
    [count, effect.kind, seedPrefix],
  );

  const tSec = frame / fps;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      {particles.map(p => {
        const sizeBase = style.sizeMin + p.ss * (style.sizeMax - style.sizeMin);
        const size = sizeBase * scale;
        const period = 6 / style.speed; // seconds
        const phase = (tSec + p.sd * period) / period;
        const tt = phase - Math.floor(phase); // 0..1

        let x = p.sx * STAGE_W;
        let y = 0;
        let opacity = 1;
        const rotation = 0;

        switch (style.motion) {
          case 'rise':
            y = STAGE_H + size * 4 - tt * (STAGE_H + size * 8);
            opacity = Math.sin(tt * Math.PI) * 0.85;
            break;
          case 'fall':
            y = -size * 4 + tt * (STAGE_H + size * 8);
            opacity = Math.sin(tt * Math.PI) * 0.85;
            x += Math.sin((tSec + p.sd * 6) * 0.5) * 24;
            break;
          case 'drift':
            y = STAGE_H * 0.2 + p.sy * STAGE_H * 0.6 + Math.sin((tSec + p.sd * 6) * 0.3) * 30;
            x += Math.sin((tSec + p.sd * 6) * 0.18) * 50;
            opacity = (Math.sin((tSec + p.sd * 6) * 0.6) + 1) / 2 * 0.85;
            break;
          case 'spiral':
            y = -size * 4 + tt * (STAGE_H + size * 8);
            x += Math.sin(tt * Math.PI * 4 + p.sd * 6) * 60;
            opacity = Math.sin(tt * Math.PI) * 0.85;
            break;
        }

        const xPct = (x / STAGE_W) * 100;
        const yPct = (y / STAGE_H) * 100;
        return (
          <div key={p.id} style={{
            position: 'absolute',
            left: `${xPct}%`, top: `${yPct}%`,
            width: size, height: size,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 ${size * 2.4}px ${style.glow}`,
            opacity,
            transform: rotation ? `rotate(${rotation}deg)` : undefined,
          }} />
        );
      })}
    </div>
  );
};

const Glow: React.FC<LayerProps & { effect: Extract<SceneEffect, { type: 'glow' }> }> = ({ frame, fps, effect }) => {
  const tSec = frame / fps;
  const breath = 0.55 + Math.sin(tSec * (effect.breathHz ?? 0.04) * 2 * Math.PI) * 0.18;
  const radius = (effect.radius ?? 0.5) * 100;
  const color = effect.color ?? 'rgba(255,215,0,0.5)';
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4,
      background: `radial-gradient(circle at 50% 42%, ${color} 0%, ${replaceAlpha(color, 0.06)} ${Math.round(radius * 0.6)}%, transparent ${Math.round(radius)}%)`,
      opacity: breath,
      mixBlendMode: 'screen',
    }} />
  );
};

const Flash: React.FC<LayerProps & { effect: Extract<SceneEffect, { type: 'flash' }>; seedPrefix: string }> = ({ frame, fps, effect, seedPrefix }) => {
  // Flash fires at intervals = 1 / rateHz seconds, each lasting durationFrames.
  const rateHz = effect.rateHz ?? 0.3;
  const durFrames = effect.durationFrames ?? 3;
  const period = Math.max(8, Math.round(fps / rateHz));
  // Use a per-cycle jitter so the flash doesn't fall on metronomic
  // beats — feels more lightning-like.
  const cycle = Math.floor(frame / period);
  const jitter = Math.round(seededRandom(`${seedPrefix}-flash-${cycle}`) * (period - durFrames - 4));
  const cycleStart = cycle * period + jitter;
  const cycleEnd = cycleStart + durFrames;
  const inFlash = frame >= cycleStart && frame < cycleEnd;
  if (!inFlash) return null;
  const alpha = effect.color ?? 'rgba(255,250,220,0.55)';
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11,
      background: alpha,
      mixBlendMode: 'screen',
    }} />
  );
};

const Tint: React.FC<{ effect: Extract<SceneEffect, { type: 'tint' }> }> = ({ effect }) => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
    background: effect.color,
    mixBlendMode: effect.blendMode ?? 'multiply',
  }} />
);

const Vignette: React.FC<{ effect: Extract<SceneEffect, { type: 'vignette' }> }> = ({ effect }) => {
  const intensity = effect.intensity ?? 0.35;
  const color = effect.color ?? 'rgba(0,0,0,1)';
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
      background: `radial-gradient(ellipse at center, transparent 40%, ${replaceAlpha(color, intensity)} 100%)`,
    }} />
  );
};

const RimLight: React.FC<LayerProps & { effect: Extract<SceneEffect, { type: 'rim_light' }> }> = ({ effect }) => {
  const angle = effect.angle ?? 60;
  const color = effect.color ?? 'rgba(255,210,140,0.22)';
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5,
      background: `linear-gradient(${angle}deg, transparent 60%, ${color} 100%)`,
      mixBlendMode: 'screen',
    }} />
  );
};

const DustShaft: React.FC<LayerProps & { effect: Extract<SceneEffect, { type: 'dust_shaft' }>; seedPrefix: string }> = ({ frame, fps, effect, seedPrefix }) => {
  const angle = effect.angle ?? 45;
  const color = effect.color ?? 'rgba(255,225,140,0.18)';
  const density = effect.density ?? 0.5;
  const motes = React.useMemo(
    () => Array.from({ length: Math.round(20 * density) }, (_, i) => ({
      id: i,
      sx: seededRandom(`${seedPrefix}-mote-x-${i}`),
      sy: seededRandom(`${seedPrefix}-mote-y-${i}`),
      ss: seededRandom(`${seedPrefix}-mote-s-${i}`),
    })),
    [density, seedPrefix],
  );
  const tSec = frame / fps;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      {/* The shaft itself — a wide angled gradient */}
      <div style={{
        position: 'absolute', inset: '-30%',
        background: `linear-gradient(${angle}deg, transparent 0%, transparent 38%, ${color} 50%, transparent 62%, transparent 100%)`,
        mixBlendMode: 'screen',
      }} />
      {/* Dust motes catching the light */}
      {motes.map(m => {
        const drift = Math.sin((tSec + m.sx * 6) * 0.3) * 30;
        const x = (m.sx * STAGE_W + drift) % STAGE_W;
        const y = (m.sy * STAGE_H);
        const size = 1.5 + m.ss * 2.5;
        const op = 0.5 + Math.sin(tSec * 0.6 + m.sx * 6) * 0.4;
        return (
          <div key={m.id} style={{
            position: 'absolute',
            left: `${(x / STAGE_W) * 100}%`,
            top: `${(y / STAGE_H) * 100}%`,
            width: size, height: size, borderRadius: '50%',
            background: '#FFE7A6',
            boxShadow: '0 0 6px rgba(255,231,166,0.7)',
            opacity: op,
          }} />
        );
      })}
    </div>
  );
};

// ── Bloom (true-ish, no deps) ──────────────────────────────
// Replaces the old gradient faux-bloom with a real thresholded
// luminance bloom: an SVG <filter> uses feColorMatrix to key pixels
// above `threshold`, feGaussianBlur to soften them, then the result
// is composited over the scene image via mixBlendMode:'screen'.
// The overlay is a *duplicate* of the scene <Img> with the filter
// applied + a brightness boost scaled by `intensity` — so the
// highlight regions of the actual scene art glow, not a generic
// radial gradient. The image src is threaded down from SceneShot /
// TrailerShot via the `imageSrc` prop on EffectStack.
//
// When no imageSrc is supplied (legacy callers), we fall back to
// the gradient approximation so the component never renders nothing.
const Bloom: React.FC<{ effect: Extract<SceneEffect, { type: 'bloom' }>; imageSrc?: string }> = ({ effect, imageSrc }) => {
  const intensity = effect.intensity ?? 1.2;
  const threshold = effect.threshold ?? 0.7;
  const filterId = React.useMemo(() => `kk-bloom-${Math.round(threshold * 100)}-${Math.round(intensity * 100)}`, [threshold, intensity]);
  // feColorMatrix: luminance key. Each output channel = weighted luma
  // scaled by intensity, minus the threshold (bias). feColorMatrix
  // clamps to [0,1], so pixels dimmer than the threshold go to 0
  // and only bright regions survive → the "bloom" highlights.
  const r = 0.2126 * intensity;
  const g = 0.7152 * intensity;
  const b = 0.0722 * intensity;
  const bias = -threshold;
  // All three color rows are identical so the bloom reads as
  // neutral-white rather than tinted. Alpha row keeps full opacity.
  const matrix = `${r} ${g} ${b} 0 ${bias}  ${r} ${g} ${b} 0 ${bias}  ${r} ${g} ${b} 0 ${bias}  0 0 0 0 1`;

  if (!imageSrc) {
    // Legacy fallback — no image src threaded, use the soft gradient.
    return (
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 12,
        background: `radial-gradient(circle at 50% 50%, rgba(255,240,200,${0.05 * intensity}) 0%, transparent 60%)`,
        mixBlendMode: 'screen',
      }} />
    );
  }

  return (
    <>
      <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden>
        <filter id={filterId}>
          {/* Luminance key: compute luma, subtract threshold so only
              bright pixels survive, then amplify by intensity. */}
          <feColorMatrix
            type="matrix"
            values={matrix}
          />
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </svg>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 12,
        mixBlendMode: 'screen',
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', objectFit: 'cover',
            filter: `url(#${filterId}) brightness(${1 + intensity * 0.15})`,
            opacity: Math.min(0.85, 0.4 + intensity * 0.15),
          }}
        />
      </div>
    </>
  );
};

const Desaturation: React.FC<{ effect: Extract<SceneEffect, { type: 'desaturation' }> }> = ({ effect }) => {
  // Sit above the image but below tint, so a desaturated scene with a
  // blue tint actually shifts hue rather than just dimming. Achieved
  // via backdrop-filter on a transparent overlay.
  const level = effect.level ?? 0.4;
  const sat = Math.max(0, 1 - level);
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
      backdropFilter: `saturate(${sat})`,
      WebkitBackdropFilter: `saturate(${sat})`,
    }} />
  );
};

// ── Depth of field (no-dep approximation) ───────────────────
// Radial blur via a vignette-mask: the in-focus band (vertical center
// = `focus`) stays sharp, the top and bottom edges blur progressively.
// Implemented as two stacked gradient overlays whose `filter: blur()`
// strength is driven by `blur`. The mask is a radial gradient keyed
// to `focus` so the softness concentrates at the edges, reading as a
// shallow-focus lens without a real bokeh shader. Same `filter: blur()`
// precedent the Fog component uses.
const DepthOfField: React.FC<{ effect: Extract<SceneEffect, { type: 'depth_of_field' }> }> = ({ effect }) => {
  const focus = effect.focus ?? 0.5;
  const blur = effect.blur ?? 0.6;
  const blurPx = Math.max(0, blur * 16);
  // Mask: transparent at the focus band, opaque (blur) at top/bottom.
  const focusTop = Math.max(0, focus - 0.18) * 100;
  const focusBot = Math.min(1, focus + 0.18) * 100;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, rgba(0,0,0,${blur * 0.35}) 0%, transparent ${focusTop}%, transparent ${focusBot}%, rgba(0,0,0,${blur * 0.35}) 100%)`,
        filter: `blur(${blurPx}px)`,
        mixBlendMode: 'multiply',
        zIndex: 3,
      }} />
    </div>
  );
};

// ── Chromatic aberration (no-dep approximation) ─────────────
// RGB-split: three stacked copies of the overlay tinted red / green /
// blue, offset in opposite directions by `amount` px, composited with
// `mixBlendMode: 'screen'`. Reads as the lens-fringing CA effect on
// high-contrast edges. Pure CSS — no canvas, no shader.
const ChromaticAberration: React.FC<{ effect: Extract<SceneEffect, { type: 'chromatic_aberration' }> }> = ({ effect }) => {
  const amount = effect.amount ?? 4;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 13, mixBlendMode: 'screen' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(255,0,0,0.12)',
        transform: `translateX(${-amount}px)`,
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,255,0,0.06)',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,180,255,0.12)',
        transform: `translateX(${amount}px)`,
      }} />
    </div>
  );
};

// ── Motion blur (no-dep approximation) ──────────────────────
// Directional blur via CSS `filter: blur()` on a translated copy of
// the overlay. `direction` picks the translate axis; `amount` scales
// the blur radius. Reads as a fast-pan streak without a velocity-
// buffer shader. Same `filter: blur()` precedent as Fog.
const MotionBlur: React.FC<{ effect: Extract<SceneEffect, { type: 'motion_blur' }> }> = ({ effect }) => {
  const direction = effect.direction ?? 'horizontal';
  const amount = effect.amount ?? 0.5;
  const blurPx = Math.max(0, amount * 14);
  const tx = direction === 'horizontal' ? amount * 8 : 0;
  const ty = direction === 'vertical' ? amount * 8 : direction === 'diagonal' ? amount * 6 : 0;
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 13,
      backdropFilter: `blur(${blurPx}px)`,
      WebkitBackdropFilter: `blur(${blurPx}px)`,
      transform: `translate(${tx}px, ${ty}px)`,
    }} />
  );
};

// ── Fog ──────────────────────────────────────────────────────
// Wide, soft horizontal mist that drifts across the lower third of
// the scene. Renders three soft horizontal gradient bands at slightly
// different offsets and drift speeds so the mist reads as layered
// instead of flat. Frame-driven, deterministic — same input gives
// the same visual in the live reader and the Remotion export.
const Fog: React.FC<LayerProps & { effect: Extract<SceneEffect, { type: 'fog' }>; seedPrefix: string }> = ({ frame, fps, effect, seedPrefix }) => {
  const intensity = effect.intensity ?? 0.22;
  const color = effect.color ?? 'rgba(220, 225, 235, 1)';
  const speed = effect.speed ?? 1.0;
  // Three layered bands at increasing depth — each drifts at a slightly
  // different rate so parallax reads even on a flat background.
  const bands = [
    { y: 70, h: 30, alpha: intensity * 0.85, drift: 14 * speed, depth: 1.0, blur: 12 },
    { y: 60, h: 35, alpha: intensity * 0.55, drift: 9  * speed, depth: 0.7, blur: 18 },
    { y: 50, h: 42, alpha: intensity * 0.35, drift: 6  * speed, depth: 0.5, blur: 24 },
  ];
  const t = frame / fps;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {bands.map((b, i) => {
        // A small per-band phase offset keeps the bands unsynchronized.
        const phase = seededRandom(`${seedPrefix}-fog-${i}`) * 100;
        // Translate cycles slowly across ±20% so the band visibly moves
        // without ever leaving the viewport.
        const tx = Math.sin((t * b.drift / 60) + phase) * 12;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: '-15%', right: '-15%',
              top: `${b.y}%`,
              height: `${b.h}%`,
              transform: `translateX(${tx}%)`,
              background: `linear-gradient(180deg, transparent 0%, ${replaceAlpha(color, b.alpha)} 40%, ${replaceAlpha(color, b.alpha * 0.8)} 60%, transparent 100%)`,
              filter: `blur(${b.blur}px)`,
              willChange: 'transform',
              mixBlendMode: 'screen',
            }}
          />
        );
      })}
    </div>
  );
};

// ── Ripple ───────────────────────────────────────────────────
// Expanding concentric rings from an origin point — reads as water
// ripples on a still surface. Two phase-offset rings expand outward
// and fade, deterministic from `frame` so the live reader and the
// Remotion export match frame-for-frame.
const Ripple: React.FC<LayerProps & { effect: Extract<SceneEffect, { type: 'ripple' }> }> = ({ frame, fps, effect }) => {
  const ox = effect.originX ?? 0.5;
  const oy = effect.originY ?? 0.7;
  const freq = effect.freq ?? 0.06; // cycles per second
  const amp = effect.amplitude ?? 1.4;
  const t = frame / fps;
  const rings = [0, 0.5];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', mixBlendMode: 'screen' }}>
      {rings.map((phase, i) => {
        const cycle = ((t * freq) + phase) % 1; // 0..1 expansion
        const sizePct = cycle * 80; // ring grows to 80% of viewport
        const alpha = (1 - cycle) * 0.18 * amp;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${ox * 100}%`,
            top: `${oy * 100}%`,
            width: `${sizePct}%`,
            height: `${sizePct}%`,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: `${1 + amp}px solid rgba(180, 220, 255, ${alpha})`,
            boxShadow: `0 0 ${4 * amp}px rgba(180,220,255,${alpha * 0.6}) inset`,
            willChange: 'transform, opacity',
          }} />
        );
      })}
    </div>
  );
};

// ── Public dispatcher ────────────────────────────────────────

interface RenderEffectProps {
  effect: SceneEffect;
  frame: number;
  fps: number;
  /** Stable seed prefix so deterministic rng across re-renders. */
  seedPrefix: string;
  /** Resolved scene image URL — threaded down so Bloom can duplicate
   *  the actual scene art for its luminance-keyed overlay. Optional:
   *  effects that don't need the image src ignore it. */
  imageSrc?: string;
}

export const RenderEffect: React.FC<RenderEffectProps> = ({ effect, frame, fps, seedPrefix, imageSrc }) => {
  switch (effect.type) {
    case 'particles':           return <Particles effect={effect} frame={frame} fps={fps} seedPrefix={seedPrefix} />;
    case 'glow':                return <Glow effect={effect} frame={frame} fps={fps} />;
    case 'flash':               return <Flash effect={effect} frame={frame} fps={fps} seedPrefix={seedPrefix} />;
    case 'tint':                return <Tint effect={effect} />;
    case 'vignette':            return <Vignette effect={effect} />;
    case 'rim_light':           return <RimLight effect={effect} frame={frame} fps={fps} />;
    case 'dust_shaft':          return <DustShaft effect={effect} frame={frame} fps={fps} seedPrefix={seedPrefix} />;
    case 'bloom':                return <Bloom effect={effect} imageSrc={imageSrc} />;
    case 'desaturation':        return <Desaturation effect={effect} />;
    case 'fog':                 return <Fog effect={effect} frame={frame} fps={fps} seedPrefix={seedPrefix} />;
    case 'ripple':              return <Ripple effect={effect} frame={frame} fps={fps} />;
    case 'depth_of_field':      return <DepthOfField effect={effect} />;
    case 'chromatic_aberration':return <ChromaticAberration effect={effect} />;
    case 'motion_blur':         return <MotionBlur effect={effect} />;
    // shake + parallax modify the *underlying image transform*, not an
    // overlay. BookMovie consumes shake (shakeOffset) + parallax (a slow
    // parallax-style sway on the beat transform). RenderEffect no-ops.
    case 'shake':               return null;
    case 'parallax':            return null;
    default:                    return null;
  }
};

/**
 * Render every effect for a scene as stacked layers. Caller wraps
 * with their own scene container (positioned absolute fill inside a
 * scene-sized parent).
 */
export const EffectStack: React.FC<{
  effects: SceneEffect[];
  frame: number;
  fps: number;
  seedPrefix: string;
  /** Resolved scene image URL for image-dependent effects (Bloom).
   *  Optional — when absent, Bloom falls back to a gradient overlay. */
  imageSrc?: string;
}> = ({ effects, frame, fps, seedPrefix, imageSrc }) => (
  <>
    {effects.map((eff, i) => (
      <RenderEffect key={`${eff.type}-${i}`} effect={eff} frame={frame} fps={fps} seedPrefix={`${seedPrefix}-${i}`} imageSrc={imageSrc} />
    ))}
  </>
);

/**
 * Image-transform helpers — the host extracts these from the effects
 * array and applies them to the scene background image. `RenderEffect`
 * does not handle them because they are not overlays.
 */
export function shakeOffset(effects: SceneEffect[], frame: number): { x: number; y: number } {
  const shake = effects.find(e => e.type === 'shake');
  if (shake?.type !== 'shake') return { x: 0, y: 0 };
  const amp = shake.amplitude ?? 1.6;
  const freq = shake.freq ?? 0.41;
  return {
    x: Math.sin(frame * freq) * amp + Math.sin(frame * 0.13) * amp * 0.6,
    y: Math.cos(frame * (freq - 0.04)) * amp * 0.7,
  };
}

// ── Internal helpers ─────────────────────────────────────────

function replaceAlpha(rgba: string, newAlpha: number): string {
  // Accepts rgba(r,g,b,a) / rgb(r,g,b) / #rrggbb / #rrggbbaa, returns
  // a same-color-with-replaced-alpha rgba string. Used to derive
  // gradient stops (e.g., glow falls off from full to fade).
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map(s => s.trim());
    return `rgba(${r}, ${g}, ${b}, ${newAlpha})`;
  }
  if (rgba.startsWith('#')) {
    const hex = rgba.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${newAlpha})`;
  }
  return rgba;
}
