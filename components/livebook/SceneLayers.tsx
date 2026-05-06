'use client';

// ============================================================
// KathaKitaab.ai — SceneLayers
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
// Why both modes share one component:
//   • The verb-driven motion (Wave 2.3) treats both the same.
//   • The renderer doesn't need to branch on "do we have slices
//     yet?" everywhere. The component owns the choice.
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
}

export function SceneLayers({
  bgImageUrl,
  bgPlateUrl,
  hotspots,
  cutouts,
  motions,
  reducedMotion = false,
}: SceneLayersProps) {
  // Only character hotspots get cutouts in v3. Place/object types
  // are part of the bg plate. (HotspotTargetType doesn't include
  // 'animal' yet — when added, extend this filter.)
  const figures = hotspots.filter(h => h.type === 'character');
  const plateUrl = bgPlateUrl ?? bgImageUrl;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Layer 1 — background plate. When sliced, this is a
          characters-removed version (slightly inpainted by the slicer).
          When virtual, it's the original bg with a faint blur to push
          it back perceptually behind the cutouts. */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${plateUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          // Light blur on virtual mode pushes the bg back; sliced mode
          // (when bgPlateUrl is provided) skips the blur because the
          // plate is already character-free.
          filter: bgPlateUrl ? 'none' : 'blur(0.5px) brightness(0.92)',
        }}
      />

      {/* Layer 2 — character cutouts. One per figure hotspot. */}
      {figures.map(h => {
        const cutoutUrl = cutouts?.[h.target_id];
        const charMotion = motions?.[h.target_id];
        return (
          <FigureLayer
            key={`fig-${h.id}`}
            hotspot={h}
            cutoutUrl={cutoutUrl}
            bgImageUrl={bgImageUrl}
            charMotion={charMotion}
            reducedMotion={reducedMotion}
          />
        );
      })}
    </div>
  );
}

// ── Single character layer ───────────────────────────────────

interface FigureLayerProps {
  hotspot: SceneHotspot;
  /** True cutout PNG with alpha. When set, sliced mode is used. */
  cutoutUrl?: string;
  /** Bg image used as the source for the virtual ellipse-clip
   *  fallback. Ignored in sliced mode. */
  bgImageUrl: string;
  charMotion?: CharacterMotion;
  reducedMotion: boolean;
}

function FigureLayer({ hotspot, cutoutUrl, bgImageUrl, charMotion, reducedMotion }: FigureLayerProps) {
  // Active motion → animate to the delta; otherwise sit at rest.
  const animate = (charMotion && !reducedMotion) ? {
    x: `${charMotion.dx}%`,
    y: `${charMotion.dy}%`,
    scale: charMotion.scale,
    rotate: charMotion.rotate,
  } : {
    x: '0%',
    y: '0%',
    scale: 1,
    rotate: 0,
  };
  const transition = charMotion ? {
    duration: charMotion.durationMs / 1000,
    ease: charMotion.ease ?? [0.22, 1, 0.36, 1],
  } : { duration: 0.4, ease: 'easeOut' as const };

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
          pointerEvents: 'none',
          willChange: 'transform',
        }}
      />
    );
  }

  // Virtual mode: clip the original bg image to an ellipse around the
  // hotspot bbox. The trick: a scaled-up duplicate of the same bg
  // image, positioned so the hotspot's pixels land in the same place,
  // clipped by an ellipse with feathered edges via radial-gradient
  // mask. This gives a soft-edged figural slice without alpha assets.
  // The clip ratio is generous (110% × 115%) so head/feet aren't cut
  // off when AmbientFigure / character motion translate the layer.
  const padX = hotspot.width * 0.10;
  const padY = hotspot.height * 0.18;
  const x = Math.max(0, hotspot.x - padX);
  const y = Math.max(0, hotspot.y - padY);
  const w = Math.min(100, hotspot.width + padX * 2);
  const h = Math.min(100, hotspot.height + padY * 2);

  // The inner div is the bg-image source, sized to mirror the FULL
  // canvas. We then negative-position it so the hotspot region lands
  // at (0,0) of the wrapper. backgroundSize:cover on a wrapper sized
  // to (canvas.width / hotspot.width * 100%, canvas.height / hotspot.height * 100%)
  // gives a 1:1 alignment with the parent's bg painting.
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
        // CSS mask creates the soft ellipse falloff. The radial
        // gradient is opaque in the center (where the figure is) and
        // fades to 0 by ~85% of the radius. mix-blend doesn't apply —
        // this is a real alpha mask.
        WebkitMaskImage: 'radial-gradient(ellipse at 50% 55%, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 85%)',
        maskImage: 'radial-gradient(ellipse at 50% 55%, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 85%)',
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
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          // Slight saturation/brightness pop so the cutout reads as
          // "nearer to camera" — separates from the blurred plate.
          filter: 'saturate(1.05) brightness(1.02)',
        }}
      />
    </motion.div>
  );
}
