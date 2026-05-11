'use client';

// ============================================================
// Auto-cycling Ken-Burns scene background for the landing hero.
//
// Sits behind the hero copy at low opacity. Each scene fades in,
// holds with a slow zoom + pan (Ken Burns), then crossfades to
// the next. Uses the photoreal Ramayana images so the visitor's
// first paint shows the actual product output — not a stock
// gradient or a Lorem hero photo.
//
// Why a custom component instead of more motion.div layers in
// the hero: keeping the cycle logic isolated makes it easy to
// reason about and prevents the existing hero parallax from
// interfering with the zoom timing.
//
// Performance budget:
//   - 6 scenes preloaded with Next/Image priority on the first
//     to keep LCP fast.
//   - Cross-fade uses opacity transitions only (no layout reflow).
//   - Pause when the tab is hidden (document.visibilityState) so
//     phones don't keep animating off-screen.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

interface HeroScene {
  src: string;
  /** Suggested origin for the zoom — visually centers the most
   *  important figure of the painting so the Ken-Burns doesn't
   *  pan into empty sky. */
  origin: string;
}

// Hand-picked Ramayana scenes that read well at low opacity behind
// the hero copy. Ordered for emotional pacing: contemplative →
// dramatic → contemplative.
const SCENES: HeroScene[] = [
  { src: '/images/scene_ayodhya_intro.png',     origin: '52% 48%' },
  { src: '/images/scene_mithila_bow.png',       origin: '50% 50%' },
  { src: '/images/scene_forest_life.png',       origin: '45% 55%' },
  { src: '/images/scene_ravana_jatayu.png',     origin: '55% 45%' },
  { src: '/images/scene_battle_lanka.png',      origin: '50% 50%' },
  { src: '/images/scene_return_ayodhya.png',    origin: '50% 50%' },
];

const HOLD_MS = 7000;     // each scene lingers for 7s of slow Ken Burns
const FADE_MS = 1500;     // 1.5s crossfade between scenes

export function CinematicHeroBackground() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Pause when the tab is hidden — saves a few cycles on mobile
  // background tabs and avoids burning the timer for nothing.
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => {
      setActive(i => (i + 1) % SCENES.length);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [active, paused]);

  // Reduced motion: hold the first scene, no zoom. Respects the user's
  // OS-level accessibility pref.
  const reduceMotion = useReducedMotion();

  // Slow Ken Burns: each scene scales 1.00 → 1.08 over the hold. The
  // animation is CSS-keyframe driven, restarted by changing `key`.
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        pointerEvents: 'none', zIndex: 0,
      }}
    >
      {SCENES.map((scene, i) => {
        const isActive = i === active;
        return (
          <div
            key={i}
            style={{
              position: 'absolute', inset: 0,
              opacity: isActive ? 1 : 0,
              transition: `opacity ${FADE_MS}ms ease-in-out`,
              transformOrigin: scene.origin,
              animation: isActive && !reduceMotion
                ? `kk-kenburns ${HOLD_MS + FADE_MS}ms ease-out forwards`
                : 'none',
            }}
          >
            <Image
              src={scene.src}
              alt=""
              fill
              priority={i === 0}
              sizes="100vw"
              style={{ objectFit: 'cover' }}
            />
          </div>
        );
      })}
      {/* Vignette + warm tint over the whole layer so the hero copy
          stays legible against any underlying scene. Without this,
          bright scenes (forest, return to Ayodhya) wash out the
          gradient-tricolor headline. */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse at center, rgba(12,8,6,0.20) 0%, rgba(12,8,6,0.55) 60%, rgba(12,8,6,0.85) 100%),
          linear-gradient(180deg, rgba(12,8,6,0.65) 0%, rgba(12,8,6,0.20) 35%, rgba(12,8,6,0.85) 100%)
        `,
        mixBlendMode: 'normal',
      }} />
      {/* Inline @keyframes so we don't have to touch globals.css. */}
      <style jsx>{`
        @keyframes kk-kenburns {
          0%   { transform: scale(1.00); }
          100% { transform: scale(1.08); }
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
