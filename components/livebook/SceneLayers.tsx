'use client';

// ============================================================
// KathaKitaab — SceneLayers
//
// Renders a scene as separated background + character cutout
// layers so figures can move independently of the painted bg.
// Two modes, picked at render time:
//
//   1. Sliced mode   — when public/images/layers/{slug}/{sceneId}/
//                      assets exist on disk, use the real cutouts
//                      with proper alpha. Future Wave 2.1 pipeline
//                      writes these.
//   2. Virtual mode  — when no slice assets exist, derive
//                      pseudo-cutouts from the existing hotspots
//                      by clipping the bg image with a soft
//                      ellipse mask. Free, universal, immediate.
//                      The illusion holds because the bg image's
//                      character region IS the cutout, just
//                      masked.
//
// Idle puppet motion: every figure breathes (chest pulse anchored
// at feet) and sways (small body rotation) when no verb burst is
// active. Without this, the cutout is statue-still while the
// AmbientFigure aura overlay pulses around it — visually broken.
// Now both move in sync with phase-offset timing per figure.
//
// Universal: works for any book. No book-specific logic. New
// scenes get virtual cutouts for free; high-priority scenes
// can be upgraded by running the slicer.
// ============================================================

import { motion } from 'framer-motion';
import type { SceneHotspot } from '@/lib/types/storyScene';

/** Verb-driven motion deltas, layered on top of the base position. */
export interface CharacterMotion {
  /** Translation in % of canvas. */
  dx: number;
  dy: number;
  scale: number;
  /** Rotation in degrees. */
  rotate: number;
  /** Animation duration in ms. */
  durationMs: number;
  /** Cubic-bezier coefficients [x1, y1, x2, y2] (framer-motion). */
  ease?: [number, number, number, number];
}

interface SceneLayersProps {
  /** The painted bg image — same path as scene.background.image_url. */
  bgImageUrl: string;
  /** Optional pre-sliced bg-only plate. Falls back to bgImageUrl. */
  bgPlateUrl?: string;
  /** Character-targetable hotspots from the scene. We only mount
   *  layers for `character` and `animal` types — objects/places stay
   *  flat in the bg. */
  hotspots: SceneHotspot[];
  /** Map from target_id → cutout PNG URL. When entries exist we use
   *  sliced mode for those characters; others stay virtual. */
  cutouts?: Record<string, string>;
  /** Per-character motion overlay, keyed by target_id. Motion is
   *  driven by Wave 2.3 (verb camera burst) so this is the integration
   *  point: the parent passes the active motion when a verb fires. */
  motions?: Record<string, CharacterMotion>;
  /** Pause every layer animation for accessibility. */
  reducedMotion?: boolean;
  /** Background fitting mode. Desktop keeps cover, mobile reader can use contain. */
  fitMode?: 'cover' | 'contain';
}

// Stable per-id phase, mirrors AmbientFigure.phaseFor so the cutout
// breathes in sync with its aura overlay. FNV-1a; deterministic.
function phaseFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h % 1000) / 1000;
}

export function SceneLayers({
  bgImageUrl,
  bgPlateUrl,
  hotspots,
  cutouts,
  motions,
  reducedMotion = false,
  fitMode = 'cover',
}: SceneLayersProps) {
  // Only character hotspots get cutouts in v3. Place/object types
  // are part of the bg plate. (HotspotTargetType doesn't include
  // 'animal' yet — when added, extend this filter.)
  const figures = hotspots.filter(h => h.type === 'character');
  const plateUrl = bgPlateUrl ?? bgImageUrl;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${plateUrl})`,
          backgroundSize: fitMode,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          filter: bgPlateUrl ? 'none' : 'brightness(0.92)',
        }}
      />

      {figures.map((h, i) => {
        const cutoutUrl = cutouts?.[h.target_id];
        const charMotion = motions?.[h.target_id];
        return (
          <FigureLayer
            key={`fig-${h.id}`}
            hotspot={h}
            phase={phaseFor(h.id || `${h.target_id}-${i}`)}
            cutoutUrl={cutoutUrl}
            bgImageUrl={bgImageUrl}
            charMotion={charMotion}
            reducedMotion={reducedMotion}
            fitMode={fitMode}
          />
        );
      })}
    </div>
  );
}

// ── Single character layer ───────────────────────────────────

interface FigureLayerProps {
  hotspot: SceneHotspot;
  phase: number;
  /** True cutout PNG with alpha. When set, sliced mode is used. */
  cutoutUrl?: string;
  /** Bg image used as the source for the virtual ellipse-clip
   *  fallback. Ignored in sliced mode. */
  bgImageUrl: string;
  charMotion?: CharacterMotion;
  reducedMotion: boolean;
  fitMode: 'cover' | 'contain';
}

function FigureLayer({ hotspot, phase, cutoutUrl, bgImageUrl, charMotion, reducedMotion, fitMode }: FigureLayerProps) {
  // When a verb burst is firing, hand control to the verb motion —
  // the cutout snaps to the burst pose and back. Otherwise idle
  // puppet motion: chest-rise breath + slow body sway, anchored
  // at the figure's feet so it reads biologically correct.
  const burstActive = charMotion && !reducedMotion;
  const breathSec = 3.4 + phase * 1.2;
  const swaySec = 5.8 + phase * 1.6;
  const breathPeak = 1.04;
  const swayDeg = 1.2;

  // Verb-burst transform: explicit one-shot pose. Idle transform:
  // looping breath + sway via keyframes.
  const animate = burstActive ? {
    x: `${charMotion!.dx}%`,
    y: `${charMotion!.dy}%`,
    scale: charMotion!.scale,
    rotate: charMotion!.rotate,
  } : reducedMotion ? {
    x: '0%', y: '0%', scale: 1, rotate: 0,
  } : {
    // Looping idle: body sway around feet, breath via scale.
    rotate: [-swayDeg, swayDeg, -swayDeg],
    scale: [1, breathPeak, 1],
  };
  const transition = burstActive ? {
    duration: charMotion!.durationMs / 1000,
    ease: charMotion!.ease ?? [0.22, 1, 0.36, 1],
  } : reducedMotion ? {
    duration: 0,
  } : {
    rotate: { duration: swaySec, repeat: Infinity, ease: 'easeInOut' as const, delay: phase * swaySec },
    scale:  { duration: breathSec, repeat: Infinity, ease: 'easeInOut' as const, delay: phase * breathSec },
  };

  // Sliced mode: render the cutout PNG positioned to its bbox.
  if (cutoutUrl) {
    return (
      <motion.img
        src={cutoutUrl}
        alt=""
        aria-hidden
        animate={animate}
        transition={transition}
        style={{
          position: 'absolute',
          left: `${hotspot.x}%`,
          top: `${hotspot.y}%`,
          width: `${hotspot.width}%`,
          height: `${hotspot.height}%`,
          objectFit: 'contain',
          objectPosition: 'top center',
          // Anchor at feet so breath and sway behave like a
          // standing figure, not a hovering box.
          transformOrigin: '50% 100%',
          pointerEvents: 'none',
          willChange: 'transform',
        }}
      />
    );
  }

  // Virtual mode: clip the original bg image to an ellipse around the
  // hotspot bbox. The clip ratio is generous enough to absorb the
  // largest verb translation we ship (`leap` at -14% Y) without
  // cropping the head — 30% padding above the bbox top covers it.
  const padX = hotspot.width * 0.10;
  const padY = hotspot.height * 0.30;
  const x = Math.max(0, hotspot.x - padX);
  const y = Math.max(0, hotspot.y - padY);
  const w = Math.min(100, hotspot.width + padX * 2);
  const h = Math.min(100, hotspot.height + padY * 1.4);

  const bgScaleX = 100 / w;
  const bgScaleY = 100 / h;
  const bgOffsetX = -x * bgScaleX;
  const bgOffsetY = -y * bgScaleY;

  return (
    <motion.div
      animate={animate}
      transition={transition}
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: `${h}%`,
        // Ellipse mask falls off by ~85% of the radius; the figure
        // lives at 50% so it stays opaque while the clipping fades
        // gracefully into the bg plate.
        WebkitMaskImage: 'radial-gradient(ellipse at 50% 60%, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 85%)',
        maskImage: 'radial-gradient(ellipse at 50% 60%, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 85%)',
        // Anchor breath/sway at feet — same as sliced mode.
        transformOrigin: '50% 100%',
        pointerEvents: 'none',
        willChange: 'transform',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${bgOffsetX}%`,
          top: `${bgOffsetY}%`,
          width: `${100 * bgScaleX}%`,
          height: `${100 * bgScaleY}%`,
          backgroundImage: `url(${bgImageUrl})`,
          backgroundSize: fitMode,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          filter: 'saturate(1.05) brightness(1.02)',
        }}
      />
    </motion.div>
  );
}
