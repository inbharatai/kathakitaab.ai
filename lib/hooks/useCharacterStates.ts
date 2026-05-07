'use client';

// ============================================================
// useCharacterStates
//
// Per-character animation state machine for the live reader.
// State is a string label per hotspot.target_id; consumers
// (AmbientFigure, SceneLayers) read the state and pick a
// motion preset accordingly.
//
// State sources, in priority order:
//
//   1. Active speaker → 'talk' for the audio's lifetime.
//      Subscription via narrationManager.subscribeActiveSpeaker.
//      Auto-clears to 'idle' on audio end.
//
//   2. Verb burst → mapped state for the burst window.
//      Caller calls applyVerbBurst(targetId, verb, durationMs).
//      Auto-clears to 'idle' on timeout.
//
//   3. Default → 'idle'.
//
// Verb → state map is a thin wrapper over the existing verb
// vocabulary (HotspotClickAction). New verbs require a new row
// here AND a row in verbCharacterMotion.ts. Same vocabulary the
// QA agent + branch agent + camera burst already share, so adding
// a verb is one place per system, not a global rewrite.
//
// Universal: book-agnostic. State is a render-time concept; it
// doesn't touch the StoryScene contract or the manifest.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import type { HotspotClickAction } from '@/lib/types/storyScene';
import { subscribeActiveSpeaker } from '@/lib/engine/narrationManager';

export type CharacterState =
  | 'idle'
  | 'talk'
  | 'fight'
  | 'leap'
  | 'honor'
  | 'comfort'
  | 'observe'
  | 'guard'
  | 'follow'
  | 'learn'
  | 'animate';

const VERB_TO_STATE: Partial<Record<HotspotClickAction, CharacterState>> = {
  talk:    'talk',
  ask:     'talk',
  petition:'talk',
  counsel: 'talk',
  fight:   'fight',
  confront:'fight',
  leap:    'leap',
  honor:   'honor',
  ally:    'honor',
  comfort: 'comfort',
  observe: 'observe',
  inspect: 'observe',
  guard:   'guard',
  follow:  'follow',
  move:    'follow',
  learn:   'learn',
  animate: 'animate',
  change:  'animate',
};

export function characterStateForVerb(verb: HotspotClickAction): CharacterState {
  return VERB_TO_STATE[verb] ?? 'idle';
}

/**
 * Hook returning a `(targetId) => CharacterState` reader plus a
 * `applyVerbBurst(targetId, verb, durationMs)` setter. State for a
 * speaking character is automatically 'talk' until audio ends.
 */
export function useCharacterStates() {
  // Active speaker comes from narrationManager — flips a target_id
  // into 'talk' for as long as the audio is playing. We hold the
  // entityId in state so subscribers re-render when it changes.
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  useEffect(() => subscribeActiveSpeaker(s => setActiveSpeakerId(s.entityId)), []);

  // Per-target verb-burst state. Cleared on a per-target timer when
  // the burst completes. Burst beats audio in priority because the
  // burst represents a specific user-driven action moment.
  const [bursts, setBursts] = useState<Record<string, CharacterState>>({});
  const burstTimers = useRef<Record<string, number>>({});

  const applyVerbBurst = useCallback((targetId: string, verb: HotspotClickAction, durationMs: number) => {
    const state = characterStateForVerb(verb);
    if (state === 'idle') return;
    setBursts(prev => ({ ...prev, [targetId]: state }));
    if (burstTimers.current[targetId]) window.clearTimeout(burstTimers.current[targetId]);
    burstTimers.current[targetId] = window.setTimeout(() => {
      setBursts(prev => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      delete burstTimers.current[targetId];
    }, Math.max(120, durationMs));
  }, []);

  useEffect(() => () => {
    for (const id of Object.keys(burstTimers.current)) {
      window.clearTimeout(burstTimers.current[id]);
    }
  }, []);

  /** Read the current state for a hotspot target_id. Verb burst wins
   *  over speaker, speaker wins over idle. */
  const stateFor = useCallback((targetId: string): CharacterState => {
    const burst = bursts[targetId];
    if (burst) return burst;
    if (activeSpeakerId === targetId) return 'talk';
    return 'idle';
  }, [bursts, activeSpeakerId]);

  return { stateFor, applyVerbBurst, activeSpeakerId };
}
