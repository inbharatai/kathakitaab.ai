'use client';

// ============================================================
// lib/hooks/useComicDialogueDriver.ts
//
// Walks a scene's dialogue[] in time with the currently-playing
// narration audio. Returns the index of the active bubble and a
// 0-1 typingProgress used by ComicBubbleLayer for the typewriter
// reveal.
//
// Algorithm: subscribe to narrationManager's active-speaker audio,
// then rAF-poll currentTime/duration. Divide the audio's duration
// into equal slots per dialogue beat. Inside each slot, ramp text
// reveal from 0 → 1 over the first 70% of the slot, then hold at
// 1 for the remaining 30% so the line is fully visible before the
// crossfade to the next bubble.
//
// Falls back to a synthetic 3-second-per-beat timer when there's
// no audio element (manual reads / paused narration) so the comic
// experience still works without TTS.
// ============================================================

import { useEffect, useState } from 'react';
import { subscribeActiveSpeaker, type ActiveSpeaker } from '@/lib/engine/narrationManager';

export interface ComicDialogueDriverState {
  /** Index into dialogue[]. -1 when nothing is active. */
  activeIndex: number;
  /** 0..1 reveal progress for the active bubble. 1 means fully typed. */
  typingProgress: number;
}

export function useComicDialogueDriver(
  beatCount: number,
  enabled: boolean,
): ComicDialogueDriverState {
  const [state, setState] = useState<ComicDialogueDriverState>({
    activeIndex: enabled && beatCount > 0 ? 0 : -1,
    typingProgress: 0,
  });

  useEffect(() => {
    if (!enabled || beatCount <= 0) {
      setState({ activeIndex: -1, typingProgress: 0 });
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let speaker: ActiveSpeaker = { audio: null, entityId: null };

    // Fallback synthetic clock — used when no audio is playing.
    // Wall-clock start time, beat slot 3s, hold proportion 0.30.
    const startedAt = performance.now();
    const fallbackBeatMs = 3200;
    const holdFrac = 0.30;

    function compute(): ComicDialogueDriverState {
      const audio = speaker.audio;
      if (audio && audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
        const t = audio.currentTime;
        const slotLen = audio.duration / beatCount;
        const rawIdx = Math.floor(t / slotLen);
        const idx = Math.max(0, Math.min(beatCount - 1, rawIdx));
        const within = (t - idx * slotLen) / slotLen; // 0..1
        const reveal = Math.min(1, within / (1 - holdFrac));
        return { activeIndex: idx, typingProgress: reveal };
      }
      // No audio: synthetic clock.
      const elapsed = performance.now() - startedAt;
      const rawIdx = Math.floor(elapsed / fallbackBeatMs);
      const idx = Math.min(beatCount - 1, rawIdx);
      const within = (elapsed - idx * fallbackBeatMs) / fallbackBeatMs;
      const reveal = Math.min(1, within / (1 - holdFrac));
      return { activeIndex: idx, typingProgress: reveal };
    }

    function tick() {
      if (cancelled) return;
      setState(compute());
      rafId = requestAnimationFrame(tick);
    }

    const unsubSpeaker = subscribeActiveSpeaker(s => {
      speaker = s;
    });

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      unsubSpeaker();
    };
  }, [enabled, beatCount]);

  return state;
}
