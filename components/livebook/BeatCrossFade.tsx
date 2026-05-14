'use client';

// ============================================================
// BeatCrossFade — multi-image cross-fade keyed off narration time.
//
// When a scene has multiple visual beats (gpt-image-1 painted 2-3
// pictures for the same scene), this component switches through
// them at evenly-spaced intervals across the narration duration.
// The result: kids see a new picture every ~10 seconds instead of
// holding on a single still for 30+ seconds.
//
// Single-image scenes don't mount this component; the existing
// background renderer handles them. Backwards-compatible: scenes
// with `beats === undefined` or `beats.length < 2` use the old
// renderer path.
//
// Why time-based and not amplitude-based: amplitude readouts are
// flaky on cross-origin Supabase audio (the same problem the
// lip-pulse heartbeat solves). A simple wall-clock interval is
// boring but reliable. We can add a per-cue beat-switch later when
// the subtitle planner exposes cue boundaries to the live reader.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { onNarrationChange, getNarrationState } from '@/lib/engine/narrationManager';

interface Beat {
  image_url: string;
  prompt: string;
}

interface Props {
  beats: Beat[];
  /** Estimated narration duration in seconds. Comes from the scene's
   *  word-count estimate; doesn't have to be exact — the cross-fade
   *  loops gracefully if narration runs longer or shorter than the
   *  estimate. Falls back to 25s when undefined. */
  durationSeconds?: number;
  /** Render-prop for each visible beat. The renderer wraps the
   *  caller-supplied content (typically <SceneLayers ...>) with the
   *  cross-fade animation. */
  renderBeat: (beat: Beat, index: number) => React.ReactNode;
  onActiveBeatChange?: (beat: Beat, index: number) => void;
}

export default function BeatCrossFade({ beats, durationSeconds, renderBeat, onActiveBeatChange }: Props) {
  // Active beat index. Drives which child mounts; the previous one
  // fades out via AnimatePresence-equivalent cross-fade.
  const [active, setActive] = useState(0);
  // Track narration state — we only advance beats while audio is
  // actively playing. Pausing or scene-loading state freezes the
  // visual track on its current beat (avoids flashing through beats
  // during silence).
  const [narrating, setNarrating] = useState(getNarrationState() === 'speaking');
  const startedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return onNarrationChange((state) => setNarrating(state === 'speaking'));
  }, []);

  // Reset to beat 0 when the beats array itself changes (scene
  // navigation). Without this, navigating from scene A (3 beats)
  // to scene B (2 beats) could leave us pointing at a missing
  // index briefly. The set-state-in-effect lint rule fires here
  // because we're synchronizing internal state with an incoming
  // prop change — exactly the case where setState in an effect is
  // the recommended pattern (see React docs "You might not need
  // an effect" exceptions).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setActive(0);
    startedAtRef.current = null;
  }, [beats]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const beat = beats[active];
    if (!beat) return;
    onActiveBeatChange?.(beat, active);
  }, [active, beats, onActiveBeatChange]);

  useEffect(() => {
    if (beats.length < 2) return; // single beat: nothing to advance
    const total = (durationSeconds ?? 25) * 1000;
    const perBeat = Math.max(3500, Math.floor(total / beats.length));

    function tick() {
      const now = performance.now();
      // Pause progression when not actively narrating. Capture the
      // start time on the first frame of a fresh narration.
      if (!narrating) {
        startedAtRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (startedAtRef.current === null) startedAtRef.current = now;
      const elapsed = now - startedAtRef.current;
      // Hold on the LAST beat after we've walked through them all.
      // Looping back to beat 0 mid-scene would feel jarring; the
      // child should land on a final stable image.
      const idx = Math.min(beats.length - 1, Math.floor(elapsed / perBeat));
      setActive((current) => (current === idx ? current : idx));
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [beats, durationSeconds, narrating]);

  if (beats.length === 0) return null;

  return (
    <>
      {beats.map((beat, i) => {
        const visible = i === active;
        return (
          <motion.div
            key={i}
            initial={{ opacity: i === 0 ? 1 : 0 }}
            animate={{ opacity: visible ? 1 : 0 }}
            transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'absolute', inset: 0,
              // pointer-events:none on inactive layers so hotspot
              // taps always reach the topmost rendered scene layer.
              pointerEvents: visible ? 'auto' : 'none',
            }}
          >
            {renderBeat(beat, i)}
          </motion.div>
        );
      })}
    </>
  );
}
