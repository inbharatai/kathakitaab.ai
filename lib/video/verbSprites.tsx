'use client';

// ============================================================
// KathaKitaab.ai — Verb sprite overlays
//
// Pure-SVG decorative animations triggered when a verb fires on
// a hotspot. Universal — same vocabulary plays for any book.
// No external assets, no Lottie, no licensed sprite packs:
// each sprite is a tiny inline SVG composed of <motion>'d
// gradients / strokes / particles, sized to the hotspot bbox.
//
// Why inline SVG, not Lottie:
//   • Zero asset weight — ships with the React bundle.
//   • Themed inline (gold/saffron/divine palette) without a
//     separate transform pipeline.
//   • Each sprite is ~50-100 LOC; full library < 600 LOC.
//
// All sprites are pointer-events:none, mix-blend-mode:screen so
// they layer cleanly over baked illustrations without obscuring
// hotspot taps. Reduced-motion users see a static frame.
// ============================================================

import { motion } from 'framer-motion';
import type { HotspotClickAction } from '@/lib/types/storyScene';

interface SpriteProps {
  /** Hotspot bbox as percentages of the scene canvas (0..100). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Burst duration in ms — sprite fades back to nothing on completion. */
  durationMs: number;
}

const wrapperStyle = (p: SpriteProps): React.CSSProperties => ({
  position: 'absolute',
  left: `${p.x}%`,
  top: `${p.y}%`,
  width: `${p.width}%`,
  height: `${p.height}%`,
  pointerEvents: 'none',
  zIndex: 8,
  mixBlendMode: 'screen',
});

// ── Individual sprites ───────────────────────────────────────

/** Sword-flash arc: a curved bright streak passes diagonally
 *  through the bbox, then fades. */
function FightSprite(p: SpriteProps) {
  return (
    <div style={wrapperStyle(p)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <defs>
          <linearGradient id="sword-flash" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="rgba(255,240,180,0)" />
            <stop offset="50%"  stopColor="rgba(255,250,220,0.95)" />
            <stop offset="100%" stopColor="rgba(255,200,80,0)" />
          </linearGradient>
        </defs>
        <motion.path
          d="M -20 110 Q 50 -10 120 -20"
          stroke="url(#sword-flash)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: [0, 1, 1], opacity: [0, 1, 0] }}
          transition={{ duration: p.durationMs / 1000, ease: 'easeOut' }}
        />
      </svg>
    </div>
  );
}

/** Vertical leap arc — a chevron of golden chevrons rises out of the
 *  bbox center then fades upward. */
function LeapSprite(p: SpriteProps) {
  return (
    <div style={wrapperStyle(p)}>
      <svg viewBox="0 0 100 200" preserveAspectRatio="none" style={{ width: '100%', height: '160%', overflow: 'visible' }}>
        {[0, 1, 2].map(i => (
          <motion.path
            key={i}
            d="M 30 100 L 50 70 L 70 100"
            stroke="rgba(255,225,140,0.95)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -60 - i * 18, opacity: [0, 1, 0] }}
            transition={{ duration: p.durationMs / 1000, ease: 'easeOut', delay: i * 0.06 }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Speech ripples — concentric arcs emanating from the speaker's
 *  mouth area. Used for talk + ask + petition. */
function SpeechSprite(p: SpriteProps) {
  return (
    <div style={wrapperStyle(p)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {[0, 1, 2].map(i => (
          <motion.circle
            key={i}
            cx="50" cy="35"
            r="6"
            stroke="rgba(255,235,200,0.85)"
            strokeWidth="1.3"
            fill="none"
            initial={{ r: 6, opacity: 0 }}
            animate={{ r: 28 + i * 8, opacity: [0, 0.8, 0] }}
            transition={{ duration: p.durationMs / 1000 * 1.1, ease: 'easeOut', delay: i * 0.12 }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Divine rays burst — radial spokes of warm light. honor / sacred /
 *  animate share this template; the color fork is small. */
function RaysSprite(p: SpriteProps & { warm?: boolean; cool?: boolean }) {
  const hue = p.cool ? '180,220,255' : '255,210,120';
  return (
    <div style={wrapperStyle(p)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {Array.from({ length: 10 }).map((_, i) => {
          const angle = (i * 36) - 90; // -90 puts the first spoke at the top
          return (
            <motion.line
              key={i}
              x1="50" y1="50"
              x2={50 + Math.cos((angle * Math.PI) / 180) * 60}
              y2={50 + Math.sin((angle * Math.PI) / 180) * 60}
              stroke={`rgba(${hue},0.55)`}
              strokeWidth="2.4"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: [0, 1, 1], opacity: [0, 0.85, 0] }}
              transition={{ duration: p.durationMs / 1000, ease: 'easeOut', delay: i * 0.025 }}
            />
          );
        })}
        <motion.circle
          cx="50" cy="50" r="6"
          fill={`rgba(${hue},0.9)`}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 2, 1.6], opacity: [0, 1, 0] }}
          transition={{ duration: p.durationMs / 1000, ease: 'easeOut' }}
          style={{ transformOrigin: '50% 50%', transformBox: 'fill-box' }}
        />
      </svg>
    </div>
  );
}

/** Soft warmth pulse — concentric glow rings, gentle. comfort / guard. */
function WarmthSprite(p: SpriteProps) {
  return (
    <div style={wrapperStyle(p)}>
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: [0.4, 1.2], opacity: [0, 0.7, 0] }}
        transition={{ duration: p.durationMs / 1000, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(255,210,150,0.5) 0%, transparent 65%)',
          filter: 'blur(8px)',
        }}
      />
    </div>
  );
}

/** Footprint trail — three faint footstep gradients fading along a
 *  horizontal line. Used for move / follow. */
function TrailSprite(p: SpriteProps) {
  return (
    <div style={wrapperStyle(p)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {[0, 1, 2, 3].map(i => (
          <motion.ellipse
            key={i}
            cx={20 + i * 22}
            cy={85}
            rx="4" ry="2.5"
            fill="rgba(255,235,180,0.6)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: p.durationMs / 1000, ease: 'easeOut', delay: i * 0.08 }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Insight pulse — bright dot expands like a thought arriving.
 *  learn / observe / inspect share this. */
function InsightSprite(p: SpriteProps) {
  return (
    <div style={wrapperStyle(p)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <motion.circle
          cx="50" cy="40" r="3"
          fill="rgba(255,250,200,0.95)"
          initial={{ r: 0, opacity: 0 }}
          animate={{ r: [0, 14, 22], opacity: [0, 1, 0] }}
          transition={{ duration: p.durationMs / 1000, ease: 'easeOut' }}
        />
        <motion.circle
          cx="50" cy="40" r="3"
          stroke="rgba(255,235,180,0.7)"
          strokeWidth="1"
          fill="none"
          initial={{ r: 0, opacity: 0 }}
          animate={{ r: [0, 30], opacity: [0, 0.7, 0] }}
          transition={{ duration: p.durationMs / 1000, ease: 'easeOut', delay: 0.1 }}
        />
      </svg>
    </div>
  );
}

// ── Dispatcher ───────────────────────────────────────────────

/**
 * Pick the right sprite for the verb. Unknown verbs render nothing.
 * Returns null when no sprite is defined so the caller can mount or
 * skip cleanly via short-circuit JSX.
 */
export function VerbSprite({
  verb,
  x, y, width, height, durationMs,
}: SpriteProps & { verb: HotspotClickAction }) {
  const props = { x, y, width, height, durationMs };
  switch (verb) {
    case 'fight':
    case 'confront':
      return <FightSprite {...props} />;
    case 'leap':
      return <LeapSprite {...props} />;
    case 'talk':
    case 'ask':
    case 'petition':
    case 'counsel':
      return <SpeechSprite {...props} />;
    case 'honor':
    case 'ally':
      return <RaysSprite {...props} warm />;
    case 'animate':
    case 'change':
      return <RaysSprite {...props} cool />;
    case 'comfort':
    case 'guard':
      return <WarmthSprite {...props} />;
    case 'move':
    case 'follow':
      return <TrailSprite {...props} />;
    case 'learn':
    case 'observe':
    case 'inspect':
      return <InsightSprite {...props} />;
    default:
      return null;
  }
}
