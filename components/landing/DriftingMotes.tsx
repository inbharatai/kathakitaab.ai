'use client';

// ============================================================
// Drifting golden motes — sits over the hero scene as a subtle
// "divine dust" particle layer. CSS-only animation, ~24 motes
// total. Pure pointer-events: none decorative layer; never
// blocks clicks.
//
// Reduced-motion: returns null so users with the OS pref off
// don't see drifting elements at all.
// ============================================================

import { useEffect, useMemo, useState } from 'react';

interface Mote {
  left: string;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  opacity: number;
}

// Pre-seeded deterministic placements so SSR + client agree on
// positions. Math.random would diverge between server and client
// markup and cause hydration warnings.
const MOTES: Mote[] = Array.from({ length: 24 }, (_, i) => {
  // PRNG that's stable across SSR and client: classic LCG seeded by i.
  const seed = (i * 9301 + 49297) % 233280;
  const r1 = seed / 233280;
  const r2 = ((seed * 2) % 233280) / 233280;
  const r3 = ((seed * 3) % 233280) / 233280;
  const r4 = ((seed * 5) % 233280) / 233280;
  return {
    left: `${(r1 * 100).toFixed(1)}%`,
    size: 1.5 + r2 * 3,
    duration: 14 + r3 * 18,           // 14-32s lazy drift
    delay: -r4 * 30,                   // negative delay = staggered start
    drift: (r2 - 0.5) * 60,            // horizontal drift in px
    opacity: 0.18 + r3 * 0.28,         // 0.18-0.46
  };
});

export function DriftingMotes() {
  const reduce = useReducedMotion();
  if (reduce) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0,
        pointerEvents: 'none', zIndex: 1,
        overflow: 'hidden',
      }}
    >
      {MOTES.map((m, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: m.left,
            bottom: -8,
            width: m.size,
            height: m.size,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,215,140,0.95) 0%, rgba(255,215,140,0.3) 50%, transparent 70%)',
            opacity: m.opacity,
            filter: 'blur(0.4px)',
            animation: `kk-mote-drift ${m.duration}s linear ${m.delay}s infinite`,
            // Per-mote drift target through CSS variables
            ['--kk-drift' as string]: `${m.drift}px`,
          } as React.CSSProperties}
        />
      ))}
      <style jsx>{`
        @keyframes kk-mote-drift {
          0%   { transform: translate(0, 0) scale(1); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translate(var(--kk-drift, 0px), -110vh) scale(0.6); opacity: 0; }
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
