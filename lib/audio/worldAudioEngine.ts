// ============================================================
// KathaKitaab — World Ambient Audio Engine (W1)
//
// A browser-side WebAudio engine for the Living World mode.
// Transcribes the voicing math from `lib/audio/proceduralWav.ts`
// (MOODS sine+vibrato+breath+noise) to live WebAudio nodes so the
// 3D planet has a cozy, mood-aware soundscape with ZERO licensed
// assets and ZERO network calls.
//
// Layers:
//   1. Biome bed — a soft drone keyed on the current node's
//      biome/mood (forest birds / battle drone / temple bells, etc.).
//      Crossfades on `currentNodeId` change.
//   2. NPC murmur — a spatialized whisper from each NPC's
//      `voiceMood`, positioned at the NPC's lat/lon via PannerNode.
//   3. Footstep SFX — a short tick when the avatar crosses a
//      meaningful distance threshold (reuses the playClickSound
//      synth pattern from lib/audio/soundEngine.ts).
//
// Ducking: the biome bed's master gain is registered with
// narrationManager so narration auto-ducks the world audio.
//
// Headless fallback: if AudioContext is unavailable (SSR, headless
// CI, locked-down Safari), every function is a no-op — mirrors the
// getAudioContext graceful degradation in musicOrchestrator.ts.
//
// Opt-in flag: NEXT_PUBLIC_KATHA_WORLD_AUDIO=1 (default OFF).
// ============================================================

'use client';

import { useEffect, useRef } from 'react';
import type { WorldManifest, WorldNpc } from '@/lib/world/worldManifest';
import { latLonToVec3, npcCurrentPlaceId } from '@/lib/world/worldManifest';
import type { WorldSessionState } from '@/lib/world/worldSession';
import { registerDroneGain } from '@/lib/engine/narrationManager';

// ── Mood voicings (transcribed from proceduralWav.ts MOODS) ──
// The proceduralWav Mood type has: serene | dramatic | somber |
// joyful | sacred | mysterious. World node.mood can also be 'tense'
// (from MOOD_KEYWORDS) — we map tense → dramatic since the Mood
// type doesn't have 'tense'. This keeps every world node covered.

interface MoodVoice {
  freq: number;
  amp: number;
  vibratoHz?: number;
  breath?: number;
}

const MOOD_VOICES: Record<string, MoodVoice[]> = {
  serene:     [{ freq: 110, amp: 0.18, breath: 0.07 }, { freq: 165, amp: 0.10, breath: 0.05 }, { freq: 220, amp: 0.05, breath: 0.09 }],
  dramatic:   [{ freq: 55, amp: 0.32, breath: 0.04 }, { freq: 82.5, amp: 0.10, breath: 0.06 }, { freq: 117, amp: 0.06, breath: 0.05 }],
  somber:     [{ freq: 98, amp: 0.22, vibratoHz: 0.4, breath: 0.05 }, { freq: 147, amp: 0.08, breath: 0.06 }],
  joyful:     [{ freq: 196, amp: 0.16, breath: 0.18 }, { freq: 294, amp: 0.10, breath: 0.20 }, { freq: 392, amp: 0.05, breath: 0.22 }],
  sacred:     [{ freq: 130.81, amp: 0.20, breath: 0.05 }, { freq: 196, amp: 0.10, breath: 0.06 }, { freq: 261.63, amp: 0.06, breath: 0.04 }],
  mysterious: [{ freq: 138, amp: 0.18, vibratoHz: 0.2, breath: 0.08 }, { freq: 142, amp: 0.18, vibratoHz: 0.18, breath: 0.07 }],
};

// Map the world mood vocabulary (which includes 'tense') to the
// proceduralWav Mood vocabulary (which does not).
function resolveMoodVoices(mood: string): MoodVoice[] {
  if (mood === 'tense') return MOOD_VOICES.dramatic;
  return MOOD_VOICES[mood] ?? MOOD_VOICES.serene;
}

// ── Biome-specific texture layer ──
// Each biome adds a short characteristic flutter/clang on top of
// the mood drone. Kept extremely subtle so it never competes with
// narration. These are simple oscillator + envelope patterns — no
// samples, no licensing.

interface BiomeTexture {
  /** Oscillator type for the flutter */
  type: OscillatorType;
  /** Base frequency in Hz */
  freq: number;
  /** Flutter rate (how often the texture pulses, in Hz) */
  flutterHz: number;
  /** Peak amplitude (kept very low) */
  amp: number;
}

const BIOME_TEXTURES: Record<string, BiomeTexture> = {
  forest:      { type: 'triangle', freq: 660, flutterHz: 0.3, amp: 0.012 },  // birds
  river:       { type: 'sine',     freq: 220, flutterHz: 0.15, amp: 0.010 },  // water shimmer
  temple:      { type: 'sine',     freq: 523, flutterHz: 0.08, amp: 0.014 },  // bells
  palace:      { type: 'sine',     freq: 392, flutterHz: 0.12, amp: 0.010 },  // courtly hum
  battlefield: { type: 'sawtooth', freq: 46,  flutterHz: 0.2,  amp: 0.020 },  // low rumble
  shore:       { type: 'sine',     freq: 180, flutterHz: 0.1,  amp: 0.012 },  // wave wash
  mountain:    { type: 'sine',     freq: 98,  flutterHz: 0.06, amp: 0.008 },  // wind
  village:     { type: 'triangle', freq: 440, flutterHz: 0.25, amp: 0.010 },  // distant chatter
  city:        { type: 'triangle', freq: 330, flutterHz: 0.18, amp: 0.010 },  // crowd murmur
  wilds:       { type: 'sine',     freq: 130, flutterHz: 0.05, amp: 0.008 },  // eerie drone
};

const FADE_MS = 1800;

// ── AudioContext (graceful headless fallback) ──
// Mirrors musicOrchestrator.ts getAudioContext (45-67).

let sharedCtx: AudioContext | null = null;
let ctxUnavailable = false;

function getAudioContext(): AudioContext | null {
  if (ctxUnavailable) return null;
  if (!sharedCtx) {
    const Ctor = (typeof window !== 'undefined') &&
      (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) { ctxUnavailable = true; return null; }
    try { sharedCtx = new Ctor(); } catch { ctxUnavailable = true; return null; }
  }
  if (sharedCtx?.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

// ── Biome bed node graph ──

interface BiomeBed {
  masterGain: GainNode;
  nodes: AudioNode[];
}

function buildBiomeBed(ctx: AudioContext, mood: string, biome: string): BiomeBed {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.05, ctx.currentTime + FADE_MS / 1000);
  master.connect(ctx.destination);

  const nodes: AudioNode[] = [master];
  const voices = resolveMoodVoices(mood);

  for (const v of voices) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = v.freq;
    gain.gain.value = v.amp;

    // Vibrato LFO on frequency
    if (v.vibratoHz) {
      const vibLfo = ctx.createOscillator();
      const vibGain = ctx.createGain();
      vibLfo.frequency.value = v.vibratoHz;
      vibGain.gain.value = 1.5;
      vibLfo.connect(vibGain);
      vibGain.connect(osc.frequency);
      vibLfo.start();
      nodes.push(vibLfo, vibGain);
    }

    // Breath LFO on amplitude (slow swelling)
    if (v.breath) {
      const breathLfo = ctx.createOscillator();
      const breathGain = ctx.createGain();
      breathLfo.frequency.value = v.breath;
      breathGain.gain.value = v.amp * 0.35;
      // Offset so the LFO oscillates around the base gain
      breathLfo.connect(breathGain);
      breathGain.connect(gain.gain);
      breathLfo.start();
      nodes.push(breathLfo, breathGain);
    }

    osc.connect(gain);
    gain.connect(master);
    osc.start();
    nodes.push(osc, gain);
  }

  // Biome texture layer
  const tex = BIOME_TEXTURES[biome] ?? BIOME_TEXTURES.wilds;
  if (tex) {
    const texOsc = ctx.createOscillator();
    const texGain = ctx.createGain();
    const flutterLfo = ctx.createOscillator();
    const flutterGain = ctx.createGain();
    texOsc.type = tex.type;
    texOsc.frequency.value = tex.freq;
    flutterLfo.frequency.value = tex.flutterHz;
    flutterGain.gain.value = tex.amp;
    // Flutter modulates the texture amplitude
    flutterLfo.connect(flutterGain);
    flutterGain.connect(texGain.gain);
    texGain.gain.value = tex.amp;
    texOsc.connect(texGain);
    texGain.connect(master);
    texOsc.start();
    flutterLfo.start();
    nodes.push(texOsc, texGain, flutterLfo, flutterGain);
  }

  return { masterGain: master, nodes };
}

function stopBiomeBed(ctx: AudioContext, bed: BiomeBed) {
  // Fade out then stop
  bed.masterGain.gain.cancelScheduledValues(ctx.currentTime);
  bed.masterGain.gain.setValueAtTime(bed.masterGain.gain.value, ctx.currentTime);
  bed.masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE_MS / 1000);
  const toStop = bed.nodes;
  setTimeout(() => {
    for (const n of toStop) {
      try { (n as OscillatorNode).stop?.(); } catch { /* already stopped */ }
      try { n.disconnect(); } catch { /* already disconnected */ }
    }
  }, FADE_MS + 100);
}

// ── NPC murmur (spatialized via PannerNode) ──

interface NpcMurmur {
  panner: PannerNode;
  gain: GainNode;
  nodes: AudioNode[];
}

function buildNpcMurmur(ctx: AudioContext, npc: WorldNpc): NpcMurmur | null {
  // Position the panner at the NPC's planet location.
  const [x, y, z] = latLonToVec3(
    // Use the NPC's home lat/lon as fallback; the caller updates position.
    0, 0, 6,
  );
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 20;
  panner.rolloffFactor = 1;
  panner.setPosition(x, y, z);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.015, ctx.currentTime + 1);
  panner.connect(gain);
  gain.connect(ctx.destination);

  const voices = resolveMoodVoices(npc.voiceMood ?? 'serene');
  const nodes: AudioNode[] = [panner, gain];
  // Use just the fundamental voice for the murmur (kept whisper-quiet).
  if (voices.length > 0) {
    const v = voices[0];
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = v.freq;
    oscGain.gain.value = 0.6; // scaled by the master gain above
    osc.connect(oscGain);
    oscGain.connect(panner);
    osc.start();
    nodes.push(osc, oscGain);

    if (v.breath) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = v.breath;
      lfoGain.gain.value = 0.15;
      lfo.connect(lfoGain);
      lfoGain.connect(oscGain.gain);
      lfo.start();
      nodes.push(lfo, lfoGain);
    }
  }

  return { panner, gain, nodes };
}

function stopNpcMurmur(ctx: AudioContext, murmur: NpcMurmur) {
  murmur.gain.gain.cancelScheduledValues(ctx.currentTime);
  murmur.gain.gain.setValueAtTime(murmur.gain.gain.value, ctx.currentTime);
  murmur.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
  const toStop = murmur.nodes;
  setTimeout(() => {
    for (const n of toStop) {
      try { (n as OscillatorNode).stop?.(); } catch { /* */ }
      try { n.disconnect(); } catch { /* */ }
    }
  }, 700);
}

// ── Footstep SFX (reuses playClickSound pattern) ──

function playFootstep(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  // Lower pitch than the UI click — a soft earthy step
  osc.frequency.setValueAtTime(180, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.12);
}

// ── React component ──

export interface WorldAudioEngineProps {
  manifest: WorldManifest;
  session: WorldSessionState;
}

/**
 * <WorldAudioEngine> — mounts the biome bed, NPC murmurs, and
 * footstep SFX for the 3D Living World. Pure WebAudio, no samples.
 * Headless (no AudioContext) → renders nothing, no errors.
 */
export function WorldAudioEngine({ manifest, session }: WorldAudioEngineProps) {
  const bedRef = useRef<BiomeBed | null>(null);
  const murmursRef = useRef<Map<string, NpcMurmur>>(new Map());
  const lastFootstepPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const lastNodeIdRef = useRef<string | null>(null);

  // Biome bed: crossfade on node change
  useEffect(() => {
    const ctx = getAudioContext();
    if (!ctx) return;

    const nodeId = session.currentNodeId;
    if (lastNodeIdRef.current === nodeId) return;
    lastNodeIdRef.current = nodeId;

    const node = manifest.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Register the new bed's master gain so narrationManager can duck it.
    const newBed = buildBiomeBed(ctx, node.mood, node.biome);
    registerDroneGain(newBed.masterGain);

    // Fade out + stop the old bed
    if (bedRef.current) {
      stopBiomeBed(ctx, bedRef.current);
    }
    bedRef.current = newBed;

    return () => {
      // Cleanup on unmount
      registerDroneGain(null);
    };
  }, [session.currentNodeId, manifest]);

  // NPC murmurs: build/teardown based on which NPCs are at the
  // current node (migrated via canon schedule).
  useEffect(() => {
    const ctx = getAudioContext();
    if (!ctx) return;

    const activeSlugs = new Set<string>();
    for (const npc of manifest.npcs) {
      const placeId = npcCurrentPlaceId(npc, session);
      if (placeId === session.currentNodeId) {
        activeSlugs.add(npc.slug);
        if (!murmursRef.current.has(npc.slug)) {
          const murmur = buildNpcMurmur(ctx, npc);
          if (murmur) murmursRef.current.set(npc.slug, murmur);
        }
        // Update panner position to the NPC's current node lat/lon
        const node = manifest.nodes.find(n => n.id === placeId);
        if (node) {
          const murmur = murmursRef.current.get(npc.slug);
          const [x, y, z] = latLonToVec3(node.lat, node.lon, 6);
          murmur?.panner.setPosition(x, y, z);
        }
      }
    }

    // Tear down murmurs for NPCs no longer at the current node
    for (const [slug, murmur] of murmursRef.current) {
      if (!activeSlugs.has(slug)) {
        stopNpcMurmur(ctx, murmur);
        murmursRef.current.delete(slug);
      }
    }
  }, [session.currentNodeId, session.visitedNodeIds, manifest]);

  // Footstep SFX: play when the avatar moves a meaningful distance
  useEffect(() => {
    const ctx = getAudioContext();
    if (!ctx) return;
    const lat = session.avatarLat;
    const lon = session.avatarLon;
    if (lat == null || lon == null) return;

    const last = lastFootstepPosRef.current;
    if (last) {
      const dLat = lat - last.lat;
      const dLon = lon - last.lon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      // ~0.05 radians ≈ a "step" on the planet surface
      if (dist > 0.05) {
        playFootstep(ctx);
        lastFootstepPosRef.current = { lat, lon };
      }
    } else {
      lastFootstepPosRef.current = { lat, lon };
    }
  }, [session.avatarLat, session.avatarLon]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (bedRef.current) stopBiomeBed(ctx, bedRef.current);
      for (const murmur of murmursRef.current.values()) stopNpcMurmur(ctx, murmur);
      murmursRef.current.clear();
      registerDroneGain(null);
    };
  }, []);

  // Renders nothing — audio only.
  return null;
}

export default WorldAudioEngine;