'use client';

// ============================================================
// useWebglAvailable
//
// Reports whether the current browser can create a WebGL context —
// used by Living World to decide between the 3D canvas and the v1
// DOM fallback stage. Read via useSyncExternalStore (the React-
// recommended way to mirror an external value into a render) so we
// never call setState synchronously inside an effect (the cascading-
// render lint rule) and stay SSR-safe.
//
// Returns false during SSR and on the first client render, then
// re-renders with the real capability. A headless / WebGL-less
// browser therefore falls back to the v1 DOM stage (and the e2e
// suite) instead of crashing.
// ============================================================

import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
  // WebGL capability does not change during a session — no subscription.
  return () => {};
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

export function useWebglAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}