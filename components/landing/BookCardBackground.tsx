'use client';

// ============================================================
// Ken-Burns cycling background for landing-page featured-book
// cards. Receives a list of image URLs (the book's first 1-4
// scene-beat images) and crossfades through them with a slow
// zoom underneath the card content.
//
// Universal — works for any book whose preview images come back
// from /api/books. A book with one image still renders fine
// (single image, no cycle); zero images falls back to nothing
// and the parent's flat background shows through.
// ============================================================

import { useEffect, useMemo, useState } from 'react';

interface Props {
  /** Ordered scene images to cycle. 1-4 entries works best. */
  images: string[];
  /** Border tint colour from the parent card — used for the
   *  bottom-of-card vignette so the bg blends back into the card
   *  edge instead of cropping abruptly. */
  accent: string;
  /** Hold + crossfade tempo. Defaults match the hero so the page
   *  reads as one consistent visual rhythm. */
  holdMs?: number;
  fadeMs?: number;
}

export function BookCardBackground({
  images,
  accent,
  holdMs = 6000,
  fadeMs = 1200,
}: Props) {
  const valid = useMemo(() => images.filter(Boolean), [images]);
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (valid.length <= 1 || reduce) return;
    const t = setTimeout(() => {
      setActive(i => (i + 1) % valid.length);
    }, holdMs);
    return () => clearTimeout(t);
  }, [active, valid.length, holdMs, reduce]);

  if (valid.length === 0) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        borderRadius: 16, pointerEvents: 'none', zIndex: 0,
      }}
    >
      {valid.map((src, i) => {
        const isActive = i === active;
        return (
          <div
            key={src + i}
            style={{
              position: 'absolute', inset: 0,
              opacity: isActive ? 1 : 0,
              transition: `opacity ${fadeMs}ms ease-in-out`,
              transformOrigin: '50% 45%',
              backgroundImage: `url("${src}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              animation: isActive && !reduce
                ? `kk-card-kenburns ${holdMs + fadeMs}ms ease-out forwards`
                : 'none',
            }}
          />
        );
      })}
      {/* Vignette + accent floor: tints the image down to roughly
          card-darkness so the title/blurb stay legible without the
          parent having to add another opaque layer. The bottom
          accent line gives the card a subtle warm glow at the foot,
          tying the bg to the card's border colour. */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          linear-gradient(180deg, rgba(15,9,7,0.55) 0%, rgba(15,9,7,0.80) 100%),
          radial-gradient(ellipse at 50% 30%, rgba(15,9,7,0.30) 0%, rgba(15,9,7,0.65) 75%)
        `,
      }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 38,
        background: `linear-gradient(180deg, transparent 0%, ${accent.replace(/0\.[0-9]+\)/, '0.35)')} 100%)`,
      }} />
      <style jsx>{`
        @keyframes kk-card-kenburns {
          0%   { transform: scale(1.00); }
          100% { transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}

function useReducedMotion(): boolean {
  const initial = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);
  const [reduce, setReduce] = useState(initial);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduce;
}
