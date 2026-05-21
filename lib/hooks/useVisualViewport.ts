'use client';

import { useState, useEffect } from 'react';

interface VisualViewportState {
  height: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
  keyboardOpen: boolean;
}

/**
 * Tracks the visual viewport so components can react to the mobile
 * virtual keyboard appearing / disappearing. On desktop this is
 * essentially a no-op (keyboardOpen stays false).
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
    keyboardOpen: false,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const vv = window.visualViewport;
    const threshold = 0.8; // keyboard is "open" when viewport < 80 % of window

    const update = () => {
      const winH = window.innerHeight;
      const keyboardOpen = vv.height < winH * threshold;
      setState({
        height: vv.height,
        offsetTop: vv.offsetTop,
        offsetLeft: vv.offsetLeft,
        scale: vv.scale,
        keyboardOpen,
      });
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return state;
}
