// ============================================================
// KathaKitaab.ai — Sound Engine
//
// TTS: OpenAI tts-1 (primary) → Browser Web Speech (fallback)
// SFX: Web Audio API (zero dependencies, zero cost)
// Ambient: Procedural Indian classical drone
// ============================================================

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ---- Ambient Drone (Indian classical root note) ----
let droneNodes: AudioNode[] = [];
let droneMasterGain: GainNode | null = null;

/** Get the drone master gain node for narration ducking */
export function getDroneMasterGain(): GainNode | null {
  return droneMasterGain;
}

// Hardcoded raga-style triads kept for backward compatibility with
// the original Ramayana-only flow. The universal music orchestrator
// now passes its own profile-derived frequencies via startAmbientDroneRaw.
const LEGACY_SCENE_FREQS: Record<string, number[]> = {
  ayodhya_intro:    [110, 165, 220],
  mithila_bow:      [130.8, 196, 261.6],
  exile:            [98, 147, 196],
  forest_life:      [146.8, 220, 293.6],
  ravana_jatayu:    [92.5, 138.6, 185],
  hanuman_meets_rama:[110, 164.8, 220],
  hanuman_lanka:    [123.5, 185.0, 247],
  bridge_to_lanka:  [116.5, 175, 233],
  battle_lanka:     [87.3, 130.8, 174.6],
  return_ayodhya:   [130.8, 196, 261.6],
  lessons:          [110, 165, 220],
  closing:          [110, 165, 220],
};

/**
 * Generic ambient drone — caller passes the frequency triad. Used by
 * the universal music orchestrator. Music gain stays subtle (0.06)
 * so it never overpowers narration.
 */
export function startAmbientDroneRaw(freqs: number[]) {
  stopAmbientDrone();
  const ctx = getCtx();

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 3);
  masterGain.connect(ctx.destination);
  droneMasterGain = masterGain;

  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i === 0 ? 'sawtooth' : 'sine';
    osc.frequency.value = freq;
    gain.gain.value = i === 0 ? 0.4 : 0.2;

    const vibLfo = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vibLfo.frequency.value = 5 + i;
    vibGain.gain.value = 0.5;
    vibLfo.connect(vibGain);
    vibGain.connect(osc.frequency);
    vibLfo.start();

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start();
    droneNodes.push(osc, gain, vibLfo, vibGain);
  });

  droneNodes.push(masterGain);
}

export function startAmbientDrone(scene: string) {
  const freqs = LEGACY_SCENE_FREQS[scene] || [110, 165, 220];
  startAmbientDroneRaw(freqs);
}

export function stopAmbientDrone() {
  droneNodes.forEach(n => { try { (n as OscillatorNode).stop?.(); n.disconnect(); } catch { /* already stopped */ } });
  droneNodes = [];
}

// ---- Sound Effects ----
export function playClickSound() {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
}

export function playAchievementSound() {
  const ctx = getCtx();
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    const t = ctx.currentTime + i * 0.12;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

export function playSceneTransitionSound() {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.5);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.6);
}

// ---- TTS Narration (OpenAI primary, browser fallback) ----
let currentAudio: HTMLAudioElement | null = null;
let ttsAbortController: AbortController | null = null;

/**
 * Speak narration using OpenAI TTS (natural voice) with browser fallback.
 * @param text - The text to narrate
 * @param voice - Voice type: narration, male_character, female_character, sage, villain
 */
export async function speakNarration(
  text: string,
  voice: string = 'narration',
): Promise<void> {
  stopNarration();

  if (!text || text.trim().length < 5) return;

  // Try OpenAI TTS first
  try {
    ttsAbortController = new AbortController();

    const response = await fetch('/api/livebook/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 2000), voice, speed: 0.95 }),
      signal: ttsAbortController.signal,
    });

    if (response.ok && response.headers.get('content-type')?.includes('audio')) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      currentAudio = new Audio(url);
      currentAudio.volume = 0.85;
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
      };

      await currentAudio.play();
      return;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    console.warn('[TTS] OpenAI failed, using browser fallback:', err);
  }

  // Fallback: Browser Web Speech API
  if (window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    utterance.rate = 0.88;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === 'en-IN' && v.localService)
      || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;

    window.speechSynthesis.speak(utterance);
  }
}

/**
 * Speak as a specific character using appropriate voice.
 */
export async function speakAsCharacter(
  text: string,
  characterName: string,
): Promise<void> {
  // Map known characters to voice types
  const charVoiceMap: Record<string, string> = {
    rama: 'male_character',
    lakshmana: 'male_character',
    hanuman: 'male_character',
    ravana: 'villain',
    sita: 'female_character',
    dasharatha: 'sage',
    vishwamitra: 'sage',
    janaka: 'sage',
  };

  const voice = charVoiceMap[characterName.toLowerCase()] || 'narration';
  return speakNarration(text, voice);
}

export function stopNarration() {
  // Stop OpenAI audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  // Abort in-flight TTS request
  if (ttsAbortController) {
    ttsAbortController.abort();
    ttsAbortController = null;
  }
  // Stop browser TTS
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

export function isSpeaking(): boolean {
  if (currentAudio && !currentAudio.paused) return true;
  return window.speechSynthesis?.speaking ?? false;
}
