// ============================================================
// KathaKitaab.ai — Narration Manager
//
// Central TTS controller tied to scene lifecycle.
// Every scene change → stop old → speak new → duck music.
// No scattered setTimeout TTS calls.
// ============================================================

type NarrationState = 'idle' | 'speaking' | 'loading';
type Listener = (state: NarrationState, text?: string) => void;

// ── Active-speaker subscription ──
// Lets the live reader render an audio-driven lip-pulse on whichever
// hotspot is currently speaking. The `entityId` aligns with hotspot
// target_id so SceneCanvas can match without a fuzzy lookup. The
// HTMLAudioElement itself is exposed too — consumers wrap it in a
// Web Audio AnalyserNode for amplitude readout.
export interface ActiveSpeaker {
  audio: HTMLAudioElement | null;
  entityId: string | null;
}
type SpeakerListener = (s: ActiveSpeaker) => void;
const speakerListeners: Set<SpeakerListener> = new Set();
let currentSpeaker: ActiveSpeaker = { audio: null, entityId: null };

function setActiveSpeaker(next: ActiveSpeaker) {
  currentSpeaker = next;
  speakerListeners.forEach(l => { try { l(next); } catch { /* */ } });
}

export function subscribeActiveSpeaker(l: SpeakerListener): () => void {
  speakerListeners.add(l);
  // Fire once with the current value so subscribers get state immediately.
  try { l(currentSpeaker); } catch { /* */ }
  return () => speakerListeners.delete(l);
}

let currentAudio: HTMLAudioElement | null = null;
let abortController: AbortController | null = null;
let currentSceneId: string | null = null;
let muted = false;
let state: NarrationState = 'idle';
const listeners: Set<Listener> = new Set();

// ── Audio autoplay unlock ────────────────────────────────────
// Browsers block HTMLAudioElement.play() until the page has seen a
// user gesture (click/keydown/touch). Once any audio element on the
// page has been play()-then-paused inside a gesture handler, the
// browser flips the per-tab autoplay flag and ALL future play() calls
// — including ones triggered by setTimeout or fetch — succeed without
// fresh gestures. So the moment the user clicks/taps anywhere, we
// silently prime the audio system. No more "TTS doesn't auto-start
// on the next scene" because by then the unlock has already happened.

let audioUnlocked = false;

function installAutoplayUnlock() {
  if (typeof window === 'undefined' || audioUnlocked) return;
  const handler = () => {
    if (audioUnlocked) return;
    try {
      // 0.1s of silence — enough to satisfy the gesture requirement
      // without making any sound. Data URI is a 28-byte WAV header
      // pointing at zero samples.
      const primer = new Audio(
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
      );
      primer.volume = 0;
      const p = primer.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { audioUnlocked = true; primer.pause(); })
          .catch(() => { /* will retry on the next gesture */ });
      } else {
        audioUnlocked = true;
      }
    } catch { /* */ }
  };
  // `once: true` means we only fire on the first qualifying gesture.
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, handler, { once: true, passive: true, capture: true }),
  );
}

if (typeof window !== 'undefined') {
  // Install on module load — the page is interactive by the time any
  // narration code runs, so a fresh listener captures the next click.
  installAutoplayUnlock();
}

// ── Ambient music volume control ─────────────────────────────
// Music must always sit BELOW TTS — ducked harshly during speech,
// restored gently after. Two registration paths:
//   (a) Web Audio drone   → registerDroneGain(GainNode)
//   (b) HTMLAudio file    → registerMusicAudio(audio, fullVolume)
// The narration manager handles both transparently.

let droneGainNode: GainNode | null = null;
let musicAudioElement: HTMLAudioElement | null = null;
let musicAudioFullVolume = 0.18; // subtle ceiling — never above TTS (~0.85–0.9)

export function registerDroneGain(gain: GainNode | null) {
  droneGainNode = gain;
}

export function registerMusicAudio(audio: HTMLAudioElement | null, fullVolume = 0.18) {
  musicAudioElement = audio;
  musicAudioFullVolume = Math.max(0, Math.min(0.4, fullVolume));
  // If TTS is currently speaking, immediately apply the ducked level
  // so the new track doesn't pop in at full volume.
  if (musicAudioElement && state === 'speaking') {
    musicAudioElement.volume = musicAudioFullVolume * 0.18;
  }
}

function rampAudioVolume(audio: HTMLAudioElement, target: number, durationMs: number) {
  const start = performance.now();
  const startVol = audio.volume;
  function step(now: number) {
    if (audio !== musicAudioElement) return; // track was replaced — abandon
    const t = Math.min(1, (now - start) / durationMs);
    audio.volume = startVol + (target - startVol) * t;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function duckMusic() {
  if (droneGainNode) {
    droneGainNode.gain.linearRampToValueAtTime(0.015, droneGainNode.context.currentTime + 0.5);
  }
  if (musicAudioElement) {
    rampAudioVolume(musicAudioElement, musicAudioFullVolume * 0.18, 500);
  }
}

function restoreMusic() {
  if (droneGainNode) {
    droneGainNode.gain.linearRampToValueAtTime(0.06, droneGainNode.context.currentTime + 1);
  }
  if (musicAudioElement) {
    rampAudioVolume(musicAudioElement, musicAudioFullVolume, 1000);
  }
}

// ── State management ─────────────────────────────────────────

function setState(newState: NarrationState, text?: string) {
  state = newState;
  listeners.forEach(l => l(state, text));
}

export function onNarrationChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNarrationState(): NarrationState {
  return state;
}

export function setMuted(m: boolean) {
  muted = m;
  if (m) stopNarration();
}

export function isMuted(): boolean {
  return muted;
}

// ── Core: Stop ───────────────────────────────────────────────

export function stopNarration() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  setActiveSpeaker({ audio: null, entityId: null });
  restoreMusic();
  setState('idle');
}

// ── Core: Speak ──────────────────────────────────────────────

export async function speak(
  text: string,
  voice: string = 'narration',
  sceneId?: string,
  /** Hotspot target_id of the speaker, when known. Drives the
   *  audio-amplitude lip-pulse in the live reader. Omitted for
   *  scene-narrator audio (no specific character speaking). */
  speakerEntityId?: string,
  /** Universality plumbing: when the speaker belongs to a registered
   *  AI-generated book, pass the book + character slug so the TTS
   *  router can pick the LLM's chosen voice_archetype rather than
   *  falling through to the global hardcoded archetype map.
   *  preRenderedUrl, when provided, bypasses /api/livebook/tts
   *  entirely — we just stream the existing CDN file. Used for
   *  scene narration that the manifest hydration already produced. */
  opts?: { bookSlug?: string; characterSlug?: string; mood?: string; preRenderedUrl?: string },
): Promise<void> {
  // If the same id is already speaking, skip — prevents re-renders
  // from restarting playback mid-sentence.
  if (sceneId && sceneId === currentSceneId && state === 'speaking') return;

  // A direct speak() call (e.g., from a branch arrival) supersedes any
  // pending scene-change timer — otherwise the timer would fire 800ms
  // later and overwrite the branch narration with scene narration.
  clearPendingSceneTimer();

  stopNarration();
  if (muted || !text || text.trim().length < 10) return;

  currentSceneId = sceneId ?? null;
  setState('loading', text);
  duckMusic();

  // Fast path: if the scene already has narration audio on Supabase
  // (every AI-generated book hydrates these on first movie open),
  // play that URL directly. No TTS API round-trip, no wait for
  // Sarvam, no possible Gemini fallback — just an instant CDN fetch.
  if (opts?.preRenderedUrl) {
    try {
      currentAudio = new Audio(opts.preRenderedUrl);
      currentAudio.crossOrigin = 'anonymous';
      currentAudio.volume = 0.9;
      currentAudio.onended = () => {
        currentAudio = null;
        setActiveSpeaker({ audio: null, entityId: null });
        restoreMusic();
        setState('idle');
      };
      currentAudio.onerror = () => {
        setActiveSpeaker({ audio: null, entityId: null });
        restoreMusic();
        setState('idle');
      };
      setState('speaking', text);
      setActiveSpeaker({ audio: currentAudio, entityId: speakerEntityId ?? null });
      await currentAudio.play();
      return;
    } catch (preErr) {
      console.warn('[narration] pre-rendered URL failed, falling back to TTS API:', preErr instanceof Error ? preErr.message : preErr);
      // Fall through to the TTS API below.
    }
  }

  // Try OpenAI TTS
  try {
    abortController = new AbortController();
    const res = await fetch('/api/livebook/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 1500),
        voice,
        speed: 0.95,
        bookSlug: opts?.bookSlug,
        characterSlug: opts?.characterSlug,
        mood: opts?.mood,
      }),
      signal: abortController.signal,
    });

    if (res.ok && res.headers.get('content-type')?.includes('audio')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      // crossOrigin lets the Web Audio AnalyserNode tap the audio
      // stream for amplitude. Blob: URLs are same-origin so this is
      // a no-op on the wire, but the AudioContext source-node
      // creation requires the flag to be set before play().
      currentAudio.crossOrigin = 'anonymous';
      currentAudio.volume = 0.9;
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        setActiveSpeaker({ audio: null, entityId: null });
        restoreMusic();
        setState('idle');
      };
      currentAudio.onerror = () => {
        setActiveSpeaker({ audio: null, entityId: null });
        restoreMusic();
        setState('idle');
      };
      setState('speaking', text);
      setActiveSpeaker({ audio: currentAudio, entityId: speakerEntityId ?? null });
      try {
        await currentAudio.play();
        return;
      } catch (playErr) {
        // NotAllowedError on autoplay-blocked browsers. Reset state so
        // the next user-gesture-triggered narration can fire cleanly,
        // and fall through to the SpeechSynthesis fallback below — it's
        // less subject to autoplay rules on some platforms.
        const name = (playErr as Error)?.name;
        if (name !== 'NotAllowedError' && name !== 'AbortError') {
          console.warn('[narrationManager] audio.play() failed:', name, (playErr as Error)?.message);
        }
        currentAudio = null;
        URL.revokeObjectURL(url);
        restoreMusic();
        setState('idle');
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
  }

  // Fallback: browser TTS
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
    utterance.lang = 'en-IN';
    utterance.rate = 0.9;
    utterance.onend = () => { restoreMusic(); setState('idle'); };
    utterance.onerror = () => { restoreMusic(); setState('idle'); };
    setState('speaking', text);
    window.speechSynthesis.speak(utterance);
  } else {
    restoreMusic();
    setState('idle');
  }
}

// ── Scene lifecycle hook ─────────────────────────────────────

// The pending scene-narration timer. If the user clicks a hotspot
// inside the 800ms transition window, the branch TTS would fire and
// then this timer would land after, overwriting the branch narration
// with the scene narration — that's the "TTS started from the first"
// bug the user reported. Track + clear the handle on every new scene
// change AND on every direct speak() call.
let pendingSceneTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingSceneTimer() {
  if (pendingSceneTimer) {
    clearTimeout(pendingSceneTimer);
    pendingSceneTimer = null;
  }
}

export function onSceneChanged(
  sceneId: string,
  narration: string,
  voice?: string,
  /** Pre-rendered Supabase URL — when provided, bypasses /api/livebook/tts
   *  for an instant CDN play. Manifest hydration produces these once per
   *  AI-generated book. */
  preRenderedUrl?: string,
) {
  clearPendingSceneTimer();
  if (muted) return;
  // Small delay to let the visual transition complete.
  pendingSceneTimer = setTimeout(() => {
    pendingSceneTimer = null;
    speak(narration, voice ?? 'narration', sceneId, undefined, { preRenderedUrl });
  }, 800);
}

// ── Entity interaction hook ──────────────────────────────────

export function onEntityInteraction(text: string, voice?: string) {
  if (muted) return;
  speak(text, voice ?? 'narration');
}
