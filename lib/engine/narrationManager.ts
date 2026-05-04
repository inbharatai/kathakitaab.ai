// ============================================================
// KathaKitaab.ai — Narration Manager
//
// Central TTS controller tied to scene lifecycle.
// Every scene change → stop old → speak new → duck music.
// No scattered setTimeout TTS calls.
// ============================================================

type NarrationState = 'idle' | 'speaking' | 'loading';
type Listener = (state: NarrationState, text?: string) => void;

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
  restoreMusic();
  setState('idle');
}

// ── Core: Speak ──────────────────────────────────────────────

export async function speak(
  text: string,
  voice: string = 'narration',
  sceneId?: string,
): Promise<void> {
  // If same scene is already speaking this text, skip
  if (sceneId && sceneId === currentSceneId && state === 'speaking') return;

  stopNarration();
  if (muted || !text || text.trim().length < 10) return;

  currentSceneId = sceneId ?? null;
  setState('loading', text);
  duckMusic();

  // Try OpenAI TTS
  try {
    abortController = new AbortController();
    const res = await fetch('/api/livebook/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 1500), voice, speed: 0.95 }),
      signal: abortController.signal,
    });

    if (res.ok && res.headers.get('content-type')?.includes('audio')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      currentAudio.volume = 0.9;
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        restoreMusic();
        setState('idle');
      };
      currentAudio.onerror = () => {
        restoreMusic();
        setState('idle');
      };
      setState('speaking', text);
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

export function onSceneChanged(sceneId: string, narration: string, voice?: string) {
  if (muted) return;
  // Small delay to let the visual transition complete
  setTimeout(() => {
    speak(narration, voice ?? 'narration', sceneId);
  }, 800);
}

// ── Entity interaction hook ──────────────────────────────────

export function onEntityInteraction(text: string, voice?: string) {
  if (muted) return;
  speak(text, voice ?? 'narration');
}
