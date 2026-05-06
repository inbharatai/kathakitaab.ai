'use client';

// ============================================================
// usePrefersReducedMotion
//
// Subscribes to the OS `prefers-reduced-motion` media query via
// useSyncExternalStore — the React-recommended way to mirror an
// external (non-React) state into a render. Avoids the cascading-
// render lint warning that fires when components implement the
// same logic with useState + useEffect + setState.
//
// Returns false during SSR. The first client render reads the
// real value and re-renders if it differs from false.
// ============================================================

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
