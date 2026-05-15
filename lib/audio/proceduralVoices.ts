// ============================================================
// KathaKitaab — Procedural Music Voices
//
// Web Audio API synthesis only. Zero external assets, zero
// licensing, zero network. Each voice is a small DSP graph
// designed to evoke a genre's instrumental character.
//
// Voices:
//   tanpura       — Indian classical drone (mythology / fable Indian)
//   bowls         — Tibetan singing bowls (buddhist)
//   cinematic-pad — Layered orchestral string pad (fantasy / historical / biography / default)
//   synth-pad     — Detuned sci-fi pad with sub-bass (sci-fi)
//   bells         — FM bells in major key (kids playful)
//   marimba       — Wooden marimba (kids whimsical)
//   lo-fi         — Filtered noise + bass (education focus)
//   tense-pulse   — Sub-bass pulse with rising tension (sci-fi tense)
//
// Volume ceiling: 0.06 master (subtle — TTS plays ≈0.85). The
// orchestrator registers the master gain with narrationManager
// so it ducks automatically during speech.
// ============================================================

export type VoiceType =
  | 'tanpura'
  | 'bowls'
  | 'cinematic-pad'
  | 'synth-pad'
  | 'bells'
  | 'marimba'
  | 'lo-fi'
  | 'tense-pulse';

export interface VoiceHandle {
  /** Master gain — register with narrationManager for ducking. */
  masterGain: GainNode;
  /** Stop and tear down the voice cleanly with a short fade. */
  stop: () => void;
}

// Subtle by default (well under TTS≈0.85). Users can scale this with
// `setMusicVolumeMultiplier(0.5..4.0)` from the UI; ducking still
// applies on top via narrationManager.
const MASTER_TARGET = 0.06;
let masterMultiplier = 1.0;
const liveMasters = new Set<GainNode>();

/** Update every active master gain. Multiplier clamps to a safe range
 * so even at max the music can't drown out narration. */
export function setMusicVolumeMultiplier(mult: number) {
  const clamped = Math.max(0, Math.min(4, mult));
  masterMultiplier = clamped;
  for (const g of liveMasters) {
    try {
      const ctx = g.context;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.linearRampToValueAtTime(MASTER_TARGET * clamped, ctx.currentTime + 0.25);
    } catch { /* node already torn down */ }
  }
}

export function getMusicVolumeMultiplier(): number {
  return masterMultiplier;
}

// ── Synthetic reverb IR ──
// Cached per AudioContext sample rate. ~1.8s exponential decay,
// stereo. Cheap and effective for cinematic depth.

const reverbCache = new WeakMap<AudioContext, AudioBuffer>();

function getReverbIR(ctx: AudioContext, durationSec = 1.8, decay = 3): AudioBuffer {
  const cached = reverbCache.get(ctx);
  if (cached) return cached;

  const length = Math.floor(ctx.sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  reverbCache.set(ctx, buffer);
  return buffer;
}

// ── Master gain with optional reverb send ──

function buildMaster(ctx: AudioContext, reverbAmount = 0.3): GainNode {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.linearRampToValueAtTime(MASTER_TARGET * masterMultiplier, ctx.currentTime + 3);
  liveMasters.add(master);
  // Cleanup hook called by the voice's stop() method via the gain
  // node's `disconnect`; we sweep stale entries lazily on next set.

  if (reverbAmount > 0) {
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = getReverbIR(ctx);
    dry.gain.value = 1 - reverbAmount;
    wet.gain.value = reverbAmount;

    master.connect(dry).connect(ctx.destination);
    master.connect(conv).connect(wet).connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }
  return master;
}

// ── Public API ──

export function playVoice(
  ctx: AudioContext,
  voice: VoiceType,
  notes: number[],
): VoiceHandle {
  // Defensive — fall back to root only if notes empty
  const safeNotes = notes.length > 0 ? notes : [110];
  switch (voice) {
    case 'tanpura':       return playTanpura(ctx, safeNotes);
    case 'bowls':         return playBowls(ctx, safeNotes);
    case 'cinematic-pad': return playCinematicPad(ctx, safeNotes);
    case 'synth-pad':     return playSynthPad(ctx, safeNotes);
    case 'bells':         return playBells(ctx, safeNotes);
    case 'marimba':       return playMarimba(ctx, safeNotes);
    case 'lo-fi':         return playLoFi(ctx, safeNotes);
    case 'tense-pulse':   return playTensePulse(ctx, safeNotes);
    default:              return playCinematicPad(ctx, safeNotes);
  }
}

// ── Voice: tanpura (Indian classical drone) ──
// Cyclic plucks on Sa-Pa-Sa'-Sa pattern; each pluck has long
// exponential decay so the four overlap into a continuous shimmer.

function playTanpura(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.35);
  const sa = notes[0];
  const pa = notes[1] ?? sa * 1.5;
  const pattern = [sa, pa, sa * 2, sa];

  let stopped = false;

  function pluck(freq: number, time: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() * 8) - 4;

    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.Q.value = 2;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.55, time + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 3.2);

    osc.connect(filter).connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 3.4);
  }

  function loop() {
    if (stopped) return;
    const now = ctx.currentTime;
    pattern.forEach((freq, i) => pluck(freq, now + i * 1.0));
    setTimeout(loop, pattern.length * 1000);
  }
  loop();

  return makeHandle(ctx, master, () => { stopped = true; });
}

// ── Voice: bowls (FM-synthesized singing bowls) ──
// Slow, deeply reverberant strikes. FM creates the inharmonic
// metallic ring characteristic of bronze bowls.

function playBowls(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.55);
  let stopped = false;

  function strike(freq: number, time: number) {
    // Carrier
    const carrier = ctx.createOscillator();
    const carrierGain = ctx.createGain();
    carrier.frequency.value = freq;
    carrier.type = 'sine';

    // Modulator — gives the metallic shimmer
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    mod.frequency.value = freq * 1.41; // inharmonic ratio
    mod.type = 'sine';
    modGain.gain.value = freq * 0.6;

    mod.connect(modGain).connect(carrier.frequency);

    carrierGain.gain.setValueAtTime(0, time);
    carrierGain.gain.linearRampToValueAtTime(0.45, time + 0.4);
    carrierGain.gain.exponentialRampToValueAtTime(0.001, time + 9);

    carrier.connect(carrierGain).connect(master);
    carrier.start(time);
    mod.start(time);
    carrier.stop(time + 9.5);
    mod.stop(time + 9.5);
  }

  function loop() {
    if (stopped) return;
    const now = ctx.currentTime;
    const freq = notes[Math.floor(Math.random() * notes.length)];
    strike(freq, now);
    setTimeout(loop, 9000 + Math.random() * 4000);
  }
  loop();

  return makeHandle(ctx, master, () => { stopped = true; });
}

// ── Voice: cinematic-pad (orchestral string-pad emulation) ──
// Layered sawtooths in chord with slow filter sweep + chorus
// detuning. The bread-and-butter cinematic background.

function playCinematicPad(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.4);
  const stops: Array<() => void> = [];

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  filter.Q.value = 0.6;
  filter.connect(master);

  // Slow LFO on filter cutoff for "breathing"
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.06;
  lfoGain.gain.value = 600;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();
  stops.push(() => { try { lfo.stop(); } catch { /* */ } });

  // Three layers per note (root, slight detune up, slight detune down)
  notes.forEach((freq, idx) => {
    [-7, 0, 7].forEach((cents, j) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.18 / (idx + 1), ctx.currentTime + 4 + j * 0.3);
      osc.connect(gain).connect(filter);
      osc.start();
      stops.push(() => { try { osc.stop(); } catch { /* */ } });
    });
  });

  return makeHandle(ctx, master, () => { stops.forEach(s => s()); });
}

// ── Voice: synth-pad (sci-fi ambient) ──
// Detuned sub-bass + airy upper octave. Filter LFO is wider than
// cinematic-pad for that "alien" wobble.

function playSynthPad(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.5);
  const stops: Array<() => void> = [];

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 1.4;
  filter.connect(master);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.04;
  lfoGain.gain.value = 1200;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();
  stops.push(() => { try { lfo.stop(); } catch { /* */ } });

  // Sub-bass at root/2
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.value = notes[0] / 2;
  subGain.gain.setValueAtTime(0, ctx.currentTime);
  subGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 4);
  sub.connect(subGain).connect(filter);
  sub.start();
  stops.push(() => { try { sub.stop(); } catch { /* */ } });

  // Detuned saw layers
  notes.forEach((freq, idx) => {
    [-15, 15].forEach((cents) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.1 / (idx + 1), ctx.currentTime + 5);
      osc.connect(gain).connect(filter);
      osc.start();
      stops.push(() => { try { osc.stop(); } catch { /* */ } });
    });
  });

  return makeHandle(ctx, master, () => { stops.forEach(s => s()); });
}

// ── Voice: bells (FM kids bells, major key) ──
// Random gentle strikes from the note set. FM ratio 1:2 gives a
// soft, music-box-ish bell.

function playBells(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.4);
  let stopped = false;

  function ping(freq: number, time: number) {
    const carrier = ctx.createOscillator();
    const carrierGain = ctx.createGain();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.value = freq;
    mod.type = 'sine';
    mod.frequency.value = freq * 2;
    modGain.gain.value = freq * 0.8;
    mod.connect(modGain).connect(carrier.frequency);

    carrierGain.gain.setValueAtTime(0, time);
    carrierGain.gain.linearRampToValueAtTime(0.35, time + 0.01);
    carrierGain.gain.exponentialRampToValueAtTime(0.001, time + 1.6);

    carrier.connect(carrierGain).connect(master);
    carrier.start(time);
    mod.start(time);
    carrier.stop(time + 1.7);
    mod.stop(time + 1.7);
  }

  function loop() {
    if (stopped) return;
    const now = ctx.currentTime;
    const freq = notes[Math.floor(Math.random() * notes.length)];
    ping(freq, now);
    setTimeout(loop, 1800 + Math.random() * 1500);
  }
  loop();

  return makeHandle(ctx, master, () => { stopped = true; });
}

// ── Voice: marimba (wooden, percussive) ──
// Triangle wave with quick attack/decay; pseudo-random pentatonic
// pattern from the note set.

function playMarimba(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.25);
  let stopped = false;

  function tap(freq: number, time: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.4, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);

    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.65);
  }

  function loop() {
    if (stopped) return;
    const now = ctx.currentTime;
    const seq = [notes[0], notes[1] || notes[0] * 1.25, notes[2] || notes[0] * 1.5];
    seq.forEach((f, i) => tap(f, now + i * 0.35));
    setTimeout(loop, 1600 + Math.random() * 1200);
  }
  loop();

  return makeHandle(ctx, master, () => { stopped = true; });
}

// ── Voice: lo-fi (filtered noise + bass) ──
// Soft brown-noise hiss, sustained low-pass bass, slow chord pulse.
// No reverb — lo-fi sounds drier.

function playLoFi(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.05);
  const stops: Array<() => void> = [];

  // Soft noise
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02; // brown noise
    data[i] = lastOut * 3.5;
  }
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 1200;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.08;

  noiseSrc.connect(noiseFilter).connect(noiseGain).connect(master);
  noiseSrc.start();
  stops.push(() => { try { noiseSrc.stop(); } catch { /* */ } });

  // Sustained bass
  const bass = ctx.createOscillator();
  const bassGain = ctx.createGain();
  bass.type = 'sine';
  bass.frequency.value = notes[0] / 2;
  bassGain.gain.setValueAtTime(0, ctx.currentTime);
  bassGain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 2);
  bass.connect(bassGain).connect(master);
  bass.start();
  stops.push(() => { try { bass.stop(); } catch { /* */ } });

  return makeHandle(ctx, master, () => { stops.forEach(s => s()); });
}

// ── Voice: tense-pulse (sci-fi tension) ──
// Rhythmic sub-bass pulse with rising filter sweep.

function playTensePulse(ctx: AudioContext, notes: number[]): VoiceHandle {
  const master = buildMaster(ctx, 0.3);
  let stopped = false;

  function pulse(time: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.value = notes[0] / 2;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.linearRampToValueAtTime(900, time + 1.4);
    filter.Q.value = 4;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.45, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 1.6);
    osc.connect(filter).connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 1.7);
  }

  function loop() {
    if (stopped) return;
    pulse(ctx.currentTime);
    setTimeout(loop, 1700);
  }
  loop();

  return makeHandle(ctx, master, () => { stopped = true; });
}

// ── Shared stop with fade ──

function makeHandle(
  ctx: AudioContext,
  master: GainNode,
  onStop: () => void,
): VoiceHandle {
  let stopped = false;
  return {
    masterGain: master,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      } catch { /* */ }
      setTimeout(() => {
        onStop();
        try { master.disconnect(); } catch { /* */ }
        liveMasters.delete(master);
      }, 600);
    },
  };
}
