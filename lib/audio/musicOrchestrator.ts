// ============================================================
// KathaKitaab.ai — Universal Music Orchestrator
//
// Plays scene music for any book genre + scene mood. Picks a
// MusicProfile via the universal library and synthesizes the music
// in-browser using Web Audio API — zero external assets, zero
// licensing, zero network. Procedural is the canonical default.
//
// Optional escape hatch: callers may pass `tryAudioFiles: true` to
// also attempt loading a CC0 sample from /public/audio/drones/{file}
// before synthesizing. Default is procedural-only.
//
// Critical constraint: music must NEVER overpower TTS narration.
// Volume ceilings: 0.06 procedural master, 0.18 file. Both are
// registered with narrationManager so they auto-duck during speech.
// ============================================================

import {
  selectMusicProfile,
  inferGenreFromBook,
  normalizeMood,
  listMusicProfiles,
  type MusicProfile,
  type MusicGenre,
  type SceneMood,
} from '@/lib/music/musicLibrary';
import {
  playVoice,
  setMusicVolumeMultiplier,
  getMusicVolumeMultiplier,
  type VoiceHandle,
} from './proceduralVoices';
import { stopAmbientDrone } from './soundEngine';
import { registerDroneGain, registerMusicAudio } from '@/lib/engine/narrationManager';

const MUSIC_FILE_TARGET_VOLUME = 0.18;
const FADE_MS = 1800;

let audioCtx: AudioContext | null = null;
let currentVoice: VoiceHandle | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentProfileId: string | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export interface SceneMusicContext {
  bookSlug?: string;
  bookTitle?: string;
  /** Pre-declared genre from canon meta. Falls back to inference. */
  declaredGenre?: string;
  /** Free-form mood from the LLM (e.g., 'serene', 'tense'). */
  mood?: string;
  /** Hard override — use this profile id regardless of genre/mood. */
  forceProfileId?: string;
  /**
   * Opt-in to attempting CC0 sample files at /audio/drones/{file}.
   * Default false — procedural-only. Set to true if you've added
   * your own license-clean samples and want to use them.
   */
  tryAudioFiles?: boolean;
}

/**
 * Pick + play music for a scene. Idempotent — calling with the same
 * effective profile is a no-op. Switching profiles crossfades.
 */
export async function playSceneMusic(ctx: SceneMusicContext): Promise<MusicProfile> {
  if (typeof window === 'undefined') {
    return pickProfile(ctx);
  }

  const profile = pickProfile(ctx);
  if (currentProfileId === profile.id) return profile;
  currentProfileId = profile.id;

  // Optional: try a user-supplied CC0 audio file first.
  if (ctx.tryAudioFiles && profile.audio_file) {
    const audio = await tryLoadAudioFile(`/audio/drones/${profile.audio_file}`);
    if (audio) {
      stopProceduralVoice();
      crossfadeFileIn(audio);
      return profile;
    }
  }

  // Canonical default: procedural synthesis. Free, license-clean, instant.
  stopFileAudio();
  registerMusicAudio(null);

  const audioContext = getAudioContext();
  const oldVoice = currentVoice;
  const newVoice = playVoice(audioContext, profile.voice, profile.notes_hz);
  currentVoice = newVoice;

  // Stop any legacy soundEngine drone (in case it was started directly)
  stopAmbientDrone();
  // Register the new voice's master gain so narrationManager can duck it.
  registerDroneGain(newVoice.masterGain);

  // Fade out the previous procedural voice while the new one fades in.
  if (oldVoice && oldVoice !== newVoice) {
    setTimeout(() => oldVoice.stop(), 50);
  }

  return profile;
}

/** Stop all scene music — procedural voice and any file. */
export function stopSceneMusic() {
  stopFileAudio();
  stopProceduralVoice();
  registerMusicAudio(null);
  registerDroneGain(null);
  currentProfileId = null;
}

/** Read-only — useful for debug/admin UI. */
export function getCurrentProfileId(): string | null {
  return currentProfileId;
}

const VOLUME_KEY = 'kathakitaab_music_volume';

/** User-facing volume control. Range 0..1 from the UI slider; we map
 * that to the procedural multiplier (0..3) so even at max the music
 * stays under the TTS narration. Persists to localStorage. */
export function setUserMusicVolume(volume01: number) {
  const v = Math.max(0, Math.min(1, volume01));
  setMusicVolumeMultiplier(v * 3);
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* */ }
  }
}

/** 0..1 — current user volume. Reads from localStorage on first call. */
export function getUserMusicVolume(): number {
  const m = getMusicVolumeMultiplier();
  return Math.max(0, Math.min(1, m / 3));
}

/** Pull the persisted volume on app start and apply it. Idempotent. */
export function loadPersistedMusicVolume(): number {
  if (typeof window === 'undefined') return getUserMusicVolume();
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v)) {
        setUserMusicVolume(v);
        return v;
      }
    }
  } catch { /* */ }
  return getUserMusicVolume();
}

// ── Internals ──

function pickProfile(ctx: SceneMusicContext): MusicProfile {
  if (ctx.forceProfileId) {
    const match = listMusicProfiles().find(p => p.id === ctx.forceProfileId);
    if (match) return match;
  }

  const genre: MusicGenre = inferGenreFromBook(ctx.bookSlug, ctx.bookTitle, ctx.declaredGenre);
  const mood: SceneMood = normalizeMood(ctx.mood);
  return selectMusicProfile(genre, mood);
}

function stopProceduralVoice() {
  if (currentVoice) {
    currentVoice.stop();
    currentVoice = null;
  }
  // Also stop any legacy drone
  stopAmbientDrone();
}

async function tryLoadAudioFile(path: string): Promise<HTMLAudioElement | null> {
  try {
    const head = await fetch(path, { method: 'HEAD' });
    if (!head.ok) return null;
  } catch {
    return null;
  }

  try {
    const audio = new Audio(path);
    audio.loop = true;
    audio.volume = 0;
    audio.preload = 'auto';
    const playPromise = audio.play();
    if (playPromise) await playPromise.catch(() => null);
    return audio;
  } catch {
    return null;
  }
}

function crossfadeFileIn(newAudio: HTMLAudioElement) {
  const oldAudio = currentAudio;
  currentAudio = newAudio;

  registerMusicAudio(newAudio, MUSIC_FILE_TARGET_VOLUME);
  rampVolume(newAudio, 0, MUSIC_FILE_TARGET_VOLUME, FADE_MS);
  if (oldAudio && oldAudio !== newAudio) {
    rampVolume(oldAudio, oldAudio.volume, 0, FADE_MS, () => {
      try { oldAudio.pause(); oldAudio.currentTime = 0; } catch { /* ignore */ }
    });
  }
}

function stopFileAudio() {
  if (currentAudio) {
    rampVolume(currentAudio, currentAudio.volume, 0, 600, () => {
      try { currentAudio?.pause(); if (currentAudio) currentAudio.currentTime = 0; } catch { /* ignore */ }
      currentAudio = null;
    });
  }
}

function rampVolume(
  audio: HTMLAudioElement,
  from: number,
  to: number,
  durationMs: number,
  onDone?: () => void,
) {
  const start = performance.now();
  function step(now: number) {
    const t = Math.min(1, (now - start) / durationMs);
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
    else onDone?.();
  }
  requestAnimationFrame(step);
}
