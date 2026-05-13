'use client';

// ============================================================
// components/comic/ComicBubbleLayer.tsx
//
// Universal overlay layer for the Comic Book style preset. Renders
// one dialogue beat at a time on top of the current scene image,
// anchored to the speaker's hotspot when one exists. The same
// layer mounts into both the live reader (SceneCanvas) and the
// movie player (BookMovie) so the experience is identical between
// "read it" and "watch it" modes.
//
// Beat selection is driven by the caller via `activeIndex`. That
// keeps timing logic out of this component — SceneCanvas advances
// the index on sentence-cue tick, BookMovie advances it on frame.
//
// Bubble shapes:
//   speech   → rounded rectangle with a triangular tail to speaker
//   thought  → cloud with trailing dots
//   caption  → flat rectangle pinned to top or bottom, no tail
//   shout    → jagged starburst, larger text, slight tilt
//
// Auto-flip: when the speaker's hotspot is on the right half of the
// frame the bubble extends to the left so the tail still points to
// the head. Bubbles never cross the frame edge.
// ============================================================

import { useMemo } from 'react';
import type { SceneDialogue } from '@/lib/types/livebook';

export interface BubbleAnchor {
  /** Slug must match SceneDialogue.speaker for the bubble to anchor. */
  speaker: string;
  /** Hotspot bbox in percentage units (0-100). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComicBubbleLayerProps {
  /** Ordered list of dialogue beats for the current scene. */
  dialogue: SceneDialogue[];
  /** Which entry to display right now. Out-of-range values render
   *  nothing so callers don't need to special-case bounds. */
  activeIndex: number;
  /** Speakers' positions, derived from the current scene's
   *  character hotspots. Missing speaker → bubble floats centred
   *  at the top instead of anchoring. */
  anchors: BubbleAnchor[];
  /** 0-1 fraction of the current beat that has elapsed. Drives the
   *  typewriter text reveal so the line types in across its
   *  allotted time, not all at once. */
  typingProgress: number;
}

export function ComicBubbleLayer({
  dialogue,
  activeIndex,
  anchors,
  typingProgress,
}: ComicBubbleLayerProps) {
  const entry = dialogue[activeIndex];
  const anchor = useMemo(() => {
    if (!entry?.speaker) return null;
    return anchors.find(a => a.speaker === entry.speaker) ?? null;
  }, [entry, anchors]);

  if (!entry) return null;

  const kind = entry.kind ?? 'speech';
  // Typewriter reveal — slice text to the proportion of the line
  // typed in so far. Easing slightly favours the start so short
  // lines don't feel like they snap on.
  const revealedChars = Math.max(
    1,
    Math.floor(entry.text.length * Math.min(1, Math.max(0, typingProgress))),
  );
  const revealed = entry.text.slice(0, revealedChars);

  if (kind === 'caption') {
    return <CaptionBox text={revealed} />;
  }

  // Layout: place bubble above the speaker's head if a hotspot is
  // known, otherwise float it at the top of the frame. The bubble's
  // own width is clamped so it never crosses the frame edge.
  const bubble = computeBubbleBox(anchor);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${bubble.left}%`,
          top: `${bubble.top}%`,
          width: `${bubble.width}%`,
          maxWidth: `${bubble.width}%`,
          transformOrigin: 'center bottom',
          animation: 'kk-bubble-pop 220ms ease-out',
        }}
      >
        <BubbleShape kind={kind}>
          <span style={{
            fontFamily: '"Bangers", "Comic Neue", "Comic Sans MS", system-ui, sans-serif',
            fontSize: kind === 'shout' ? '1.15rem' : '0.96rem',
            lineHeight: 1.25,
            color: '#0d0a08',
            fontWeight: kind === 'shout' ? 800 : 600,
            letterSpacing: 0.2,
            textTransform: kind === 'shout' ? 'uppercase' : 'none',
            textShadow: kind === 'shout' ? '0 1px 0 rgba(255,200,40,0.5)' : 'none',
          }}>
            {revealed}
            <span style={{ opacity: typingProgress < 1 ? 1 : 0, marginLeft: 1 }}>▎</span>
          </span>
        </BubbleShape>
        {anchor && <BubbleTail kind={kind} bubble={bubble} anchor={anchor} />}
      </div>
      <BubbleKeyframes />
    </div>
  );
}

// ── Bubble shape ────────────────────────────────────────────

function BubbleShape({
  kind,
  children,
}: {
  kind: NonNullable<SceneDialogue['kind']>;
  children: React.ReactNode;
}) {
  if (kind === 'thought') {
    return (
      <div style={{
        position: 'relative',
        padding: '14px 18px',
        background: '#fdfaf2',
        border: '3px solid #14110d',
        borderRadius: '54% 46% 60% 40% / 50% 60% 40% 50%',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35), inset 0 0 0 2px #fdfaf2',
      }}>
        {children}
      </div>
    );
  }
  if (kind === 'shout') {
    return (
      <div style={{
        position: 'relative',
        padding: '14px 22px',
        background: '#ffe23d',
        color: '#0d0a08',
        // Jagged starburst via clip-path — exaggerated points so it
        // reads as "BAM!" energy rather than a soft cloud.
        clipPath: 'polygon(0% 18%, 9% 0%, 20% 16%, 34% 0%, 46% 18%, 60% 4%, 70% 22%, 84% 8%, 94% 28%, 100% 50%, 92% 70%, 100% 86%, 84% 92%, 70% 80%, 60% 96%, 46% 84%, 34% 100%, 20% 86%, 9% 98%, 0% 80%)',
        filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))',
        transform: 'rotate(-2deg)',
      }}>
        {children}
      </div>
    );
  }
  // Default: speech bubble — clean rounded rectangle with a thick
  // ink border. Tail rendered separately so the rectangle stays a
  // simple shape (better wrapping, no clip-path needed).
  return (
    <div style={{
      position: 'relative',
      padding: '12px 16px',
      background: '#fdfaf2',
      border: '3px solid #14110d',
      borderRadius: 18,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    }}>
      {children}
    </div>
  );
}

// ── Tail (speech / shout only) ──────────────────────────────

function BubbleTail({
  kind,
  bubble,
  anchor,
}: {
  kind: NonNullable<SceneDialogue['kind']>;
  bubble: BubbleBox;
  anchor: BubbleAnchor;
}) {
  if (kind === 'caption' || kind === 'thought') return null;
  // Anchor centre (in 0-100% scene coords)
  const anchorCx = anchor.x + anchor.width / 2;
  const anchorTop = anchor.y;
  // Bubble bottom centre
  const bubbleCx = bubble.left + bubble.width / 2;
  const bubbleBottomY = bubble.top + bubble.heightEst;
  // Tail spans from bubble bottom to the anchor head.
  // Render as an SVG line + filled triangle in absolute coords
  // relative to the SCENE, not the bubble — easier math.
  const dx = anchorCx - bubbleCx;
  const dy = anchorTop - bubbleBottomY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Triangle base half-width (in % units) — narrow so the tail
  // reads as a tail, not a flag.
  const halfBase = 2.2;
  // Tail base sits on the bubble bottom edge.
  const baseLx = bubbleCx - uy * halfBase;
  const baseLy = bubbleBottomY + ux * halfBase;
  const baseRx = bubbleCx + uy * halfBase;
  const baseRy = bubbleBottomY - ux * halfBase;
  return (
    <svg
      style={{
        position: 'absolute',
        left: `${-bubble.left}%`,
        top: `${-bubble.top}%`,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <polygon
        points={`${baseLx},${baseLy} ${baseRx},${baseRy} ${anchorCx},${anchorTop + 1}`}
        fill="#fdfaf2"
        stroke="#14110d"
        strokeWidth={0.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Caption box (top-of-frame narrator strip) ───────────────

function CaptionBox({ text }: { text: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: '6%', right: '6%', top: '5%',
        padding: '10px 16px',
        background: '#fff1c8',
        border: '3px solid #14110d',
        boxShadow: '0 6px 18px rgba(0,0,0,0.40)',
        zIndex: 30,
        transform: 'rotate(-0.6deg)',
        pointerEvents: 'none',
      }}
    >
      <span style={{
        fontFamily: '"Bangers", "Comic Neue", "Comic Sans MS", system-ui, sans-serif',
        fontSize: '0.95rem',
        lineHeight: 1.3,
        color: '#0d0a08',
        fontStyle: 'italic',
        letterSpacing: 0.3,
      }}>
        {text}
      </span>
    </div>
  );
}

// ── Layout helpers ──────────────────────────────────────────

interface BubbleBox {
  left: number;
  top: number;
  width: number;
  /** Rough vertical extent used only by the tail math. The bubble
   *  itself sizes itself via padding, so this is a soft estimate. */
  heightEst: number;
}

function computeBubbleBox(anchor: BubbleAnchor | null): BubbleBox {
  // No anchor → centred at top.
  if (!anchor) {
    return { left: 20, top: 6, width: 60, heightEst: 14 };
  }
  // Width tuned to the scene aspect — 36-44% of frame width reads
  // comfortably in a 1536×1024 image.
  const width = 38;
  // Position the bubble above the speaker's head, biased away from
  // whichever frame edge the speaker is closest to so the tail
  // doesn't run off-screen.
  const anchorCx = anchor.x + anchor.width / 2;
  // Right side: bubble extends left.
  const left = anchorCx > 50
    ? Math.max(4, anchorCx - width + 6)
    : Math.min(96 - width, anchorCx - 6);
  // Top: place above the head with a small gap. Clamp to a minimum
  // top margin so it never clips the frame's upper edge.
  const top = Math.max(4, anchor.y - 18);
  return { left, top, width, heightEst: 14 };
}

// ── Keyframes (scoped, no globals.css edit) ─────────────────

function BubbleKeyframes() {
  return (
    <style jsx>{`
      @keyframes kk-bubble-pop {
        0%   { transform: scale(0.7); opacity: 0; }
        70%  { transform: scale(1.06); opacity: 1; }
        100% { transform: scale(1.00); opacity: 1; }
      }
    `}</style>
  );
}
