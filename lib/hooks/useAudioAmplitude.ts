'use client';

// ============================================================
// useAudioAmplitude
//
// Wraps a HTMLAudioElement in a Web Audio AnalyserNode and exposes
// a smoothed RMS amplitude (0..1) that updates each animation frame.
//
// Used by the live reader's lip-pulse layer: when narration is
// playing, the active speaker's mouth-region overlay scales + glows
// with the audio's loudness envelope. Not real lip-sync — just
// "the figure's mouth is moving while audio is playing", which is
// enough for the perceived "alive" effect at zero AI cost.
//
// Notes
//   • The AudioContext is created lazily and reused across audio
//     elements. Browsers cap concurrent contexts to ~6, so the
//     single shared instance is the right pattern.
//   • If the same audio element is connected to a MediaElementSource
//     twice, browsers throw. We track which elements we've connected
//     via a WeakMap.
//   • Playback is preserved: the analyser → destination chain mirrors
//     the audio so the user still hears it.
//   • Returns 0 when reduced-motion is on, so callers can render the
//     overlay statically without wasting cycles.
// ============================================================

import { useEffect, useRef, useState } from 'react';

type AudioContextCtor = typeof AudioContext;
type WebkitWindow = typeof globalThis & { webkitAudioContext?: AudioContextCtor };

let sharedCtx: AudioContext | null = null;
const connectedSources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  const W = window as WebkitWindow;
  const Ctor = window.AudioContext ?? W.webkitAudioContext;
  if (!Ctor) return null;
  sharedCtx = new Ctor();
  return sharedCtx;
}

function ensureSourceNode(ctx: AudioContext, audio: HTMLAudioElement): MediaElementAudioSourceNode {
  const cached = connectedSources.get(audio);
  if (cached) return cached;
  const node = ctx.createMediaElementSource(audio);
  connectedSources.set(audio, node);
  return node;
}

interface UseAudioAmplitudeOpts {
  /** Pause analysis when reduced-motion is set; returns 0 each tick. */
  reducedMotion?: boolean;
  /** Smoothing constant 0..1 — closer to 1 = smoother, less twitchy. */
  smoothing?: number;
  /** Min reading floor below which we report 0. Cuts noise during
   *  silence gaps so the lip-pulse doesn't shimmer at idle. */
  silenceFloor?: number;
}

/**
 * Subscribe to RMS amplitude of an HTMLAudioElement. Returns a number
 * in [0, 1]. Returns 0 if no audio is given, the audio is paused, or
 * reduced-motion is requested.
 */
export function useAudioAmplitude(
  audio: HTMLAudioElement | null | undefined,
  opts: UseAudioAmplitudeOpts = {},
): number {
  const { reducedMotion = false, smoothing = 0.55, silenceFloor = 0.03 } = opts;
  const [amp, setAmp] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);

  useEffect(() => {
    // When there's nothing to analyse we just don't start the rAF
    // loop — the initial useState(0) keeps amp=0, no setState-in-effect
    // cascade. (When `audio` flips to null mid-playback the previous
    // effect's cleanup will run, and the rAF stops; lastRef holds 0.)
    if (!audio || reducedMotion) return;
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    let analyser: AnalyserNode | null = null;
    try {
      const source = ensureSourceNode(ctx, audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyser.connect(ctx.destination);
    } catch (err) {
      // Most common failure: audio element from a stale render still
      // holds a stale source node. Bail silently — the lip-pulse just
      // stays at 0 for this audio.
      console.warn('[useAudioAmplitude] analyser setup failed:', err instanceof Error ? err.message : err);
      return;
    }

    // Resume the context when the audio actually plays. AudioContext
    // is suspended until a user gesture; the narrationManager already
    // primes it elsewhere, but we belt-and-braces it here.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { /* will retry on next gesture */ });
    }

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      // Pause readout when audio is paused or ended — the analyser
      // would still report quiet noise from the destination chain.
      if (audio.paused || audio.ended) {
        if (lastRef.current !== 0) {
          lastRef.current = 0;
          setAmp(0);
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      analyser.getByteTimeDomainData(buf);
      // RMS over the time-domain buffer. 128 = silence centerline; we
      // measure deviation from it.
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Compress the dynamic range a touch so peaks don't dominate.
      const shaped = Math.min(1, rms * 1.4);
      const next = shaped < silenceFloor ? 0 : shaped;
      // Exponential smoothing so the readout reads "syllable" rather
      // than "sample". The lip-pulse looks more natural this way.
      const smoothed = lastRef.current * smoothing + next * (1 - smoothing);
      if (Math.abs(smoothed - lastRef.current) > 0.005) {
        lastRef.current = smoothed;
        setAmp(smoothed);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      // Disconnect the analyser *only*. The MediaElementSource stays
      // bound to the audio element (browsers don't allow re-creating
      // it), so we keep the WeakMap entry alive.
      try { analyser?.disconnect(); } catch { /* */ }
      analyser = null;
    };
  }, [audio, reducedMotion, smoothing, silenceFloor]);

  return amp;
}
