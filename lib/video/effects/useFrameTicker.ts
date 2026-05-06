// ============================================================
// KathaKitaab.ai — Frame ticker hook for the live reader
//
// The Remotion compositions get `frame` from `useCurrentFrame()`.
// The live reader doesn't have that, so it needs an equivalent
// ticking counter so the same effect components animate.
//
// Strategy: requestAnimationFrame loop. We tick at 30fps logical
// (matching BookMovie's BOOK_MOVIE_FPS) by gating on elapsed ms.
// Pause when document.hidden so background tabs don't burn CPU.
// ============================================================

import { useEffect, useRef, useState } from 'react';

interface FrameTickerOpts {
  fps?: number;
  /** Pause when the document is hidden (default true). */
  pauseOnHidden?: boolean;
  /** Reduce-motion preference. When true, frame stays at 0 so
   *  effects render their first-frame-only state. */
  reducedMotion?: boolean;
}

export function useFrameTicker(opts: FrameTickerOpts = {}): { frame: number; fps: number } {
  const fps = opts.fps ?? 30;
  const pauseOnHidden = opts.pauseOnHidden ?? true;
  const [frame, setFrame] = useState(0);
  const startedAt = useRef<number>(0);
  const rafId = useRef<number | null>(null);
  const lastFrame = useRef<number>(0);

  useEffect(() => {
    // When reduced-motion is requested we want frame to stay at 0 so
    // animated effects render their static first-frame state. We avoid
    // calling setFrame(0) inside the effect body (cascading render) —
    // instead we just skip starting the rAF loop and rely on the
    // initial useState(0) for the zero value.
    if (opts.reducedMotion) return;
    if (typeof window === 'undefined') return;

    startedAt.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const elapsedMs = now - startedAt.current;
      const next = Math.floor((elapsedMs * fps) / 1000);
      if (next !== lastFrame.current) {
        lastFrame.current = next;
        setFrame(next);
      }
      rafId.current = requestAnimationFrame(tick);
    };

    const onVis = () => {
      if (document.hidden && pauseOnHidden) {
        if (rafId.current != null) cancelAnimationFrame(rafId.current);
        rafId.current = null;
      } else if (rafId.current == null) {
        // Resume: re-anchor startedAt so frame doesn't jump.
        startedAt.current = performance.now() - (lastFrame.current * 1000) / fps;
        rafId.current = requestAnimationFrame(tick);
      }
    };

    if (pauseOnHidden) document.addEventListener('visibilitychange', onVis);
    rafId.current = requestAnimationFrame(tick);

    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      if (pauseOnHidden) document.removeEventListener('visibilitychange', onVis);
    };
  }, [fps, pauseOnHidden, opts.reducedMotion]);

  return { frame, fps };
}
