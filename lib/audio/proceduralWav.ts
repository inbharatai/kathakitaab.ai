// ============================================================
// KathaKitaab — Procedural WAV synthesizer (Node-side)
//
// Emits raw PCM 16-bit mono WAV bytes for short ambient mood beds.
// Used by `scripts/build-mood-music.ts` at build time so the
// Remotion composition can layer a mood track via <Audio>.
//
// Why bake static WAVs instead of synthesizing in-browser:
//   - Remotion's <Audio> element only consumes URL-addressable
//     audio; Web Audio API output isn't captured by renderMedia.
//   - We need the same audio in the live Player and the MP4 export.
//   - Pre-baking keeps the runtime path zero-cost and licensable
//     (the WAVs are CC0 by construction — pure sine + noise math).
//
// The library is intentionally tiny and dependency-free so it can
// run inside `tsx` without bundling. Output samples are int16 PCM.
// ============================================================

export type Mood =
  | 'serene' | 'dramatic' | 'somber' | 'joyful' | 'sacred' | 'mysterious';

export interface MoodVoice {
  /** Base frequency in Hz */
  freq: number;
  /** Volume 0..1 */
  amp: number;
  /** Detuning ramp width — adds breathing/swelling */
  vibratoHz?: number;
  /** Slow LFO frequency for amplitude breathing */
  breath?: number;
}

const MOODS: Record<Mood, MoodVoice[]> = {
  // Open consonant chord, slow breath. Calm but not empty.
  serene:     [{ freq: 110, amp: 0.18, breath: 0.07 }, { freq: 165, amp: 0.10, breath: 0.05 }, { freq: 220, amp: 0.05, breath: 0.09 }],
  // Low rumble + minor third + tritone tension. Heavy.
  dramatic:   [{ freq: 55, amp: 0.32, breath: 0.04 }, { freq: 82.5, amp: 0.10, breath: 0.06 }, { freq: 117, amp: 0.06, breath: 0.05 }],
  // Lonely cello-like drone with slow vibrato.
  somber:     [{ freq: 98, amp: 0.22, vibratoHz: 0.4, breath: 0.05 }, { freq: 147, amp: 0.08, breath: 0.06 }],
  // Bright open fifth + harmonic, gentle pulse.
  joyful:     [{ freq: 196, amp: 0.16, breath: 0.18 }, { freq: 294, amp: 0.10, breath: 0.20 }, { freq: 392, amp: 0.05, breath: 0.22 }],
  // Sustained perfect intervals reminiscent of chant.
  sacred:     [{ freq: 130.81, amp: 0.20, breath: 0.05 }, { freq: 196, amp: 0.10, breath: 0.06 }, { freq: 261.63, amp: 0.06, breath: 0.04 }],
  // Detuned beating + airy noise wash for unease.
  mysterious: [{ freq: 138, amp: 0.18, vibratoHz: 0.2, breath: 0.08 }, { freq: 142, amp: 0.18, vibratoHz: 0.18, breath: 0.07 }],
};

export const MOOD_NAMES: Mood[] = ['serene', 'dramatic', 'somber', 'joyful', 'sacred', 'mysterious'];

const SAMPLE_RATE = 44_100;
const DEFAULT_DURATION_SEC = 12; // looped via <Audio loop> — short keeps the bundle small

/**
 * Generate a 16-bit mono PCM WAV for the given mood. Returns the
 * complete .wav file bytes (header + samples).
 */
export function synthesizeMoodWav(mood: Mood, durationSec = DEFAULT_DURATION_SEC): Buffer {
  const voices = MOODS[mood];
  if (!voices) throw new Error(`Unknown mood: ${mood}`);

  const totalSamples = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Int16Array(totalSamples);

  const noiseAmp = mood === 'mysterious' ? 0.04 : 0.02;
  const fadeInSamples = Math.floor(SAMPLE_RATE * 0.5);
  const fadeOutSamples = Math.floor(SAMPLE_RATE * 0.5);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    for (const v of voices) {
      const vibrato = v.vibratoHz ? Math.sin(2 * Math.PI * v.vibratoHz * t) * 1.5 : 0;
      const breath = v.breath ? (0.65 + 0.35 * Math.sin(2 * Math.PI * v.breath * t)) : 1;
      sample += Math.sin(2 * Math.PI * (v.freq + vibrato) * t) * v.amp * breath;
    }
    // Light pink-ish noise for air.
    sample += (Math.random() * 2 - 1) * noiseAmp;

    // Edge fades so the loop seams aren't audible.
    let envelope = 1;
    if (i < fadeInSamples) envelope = i / fadeInSamples;
    else if (i > totalSamples - fadeOutSamples) envelope = (totalSamples - i) / fadeOutSamples;
    sample *= envelope;

    samples[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }

  return encodeWavInt16Mono(samples, SAMPLE_RATE);
}

// ── WAV header ───────────────────────────────────────────────
// Standard PCM RIFF wave: 16-bit signed mono. The header is fixed-size,
// so we can pre-allocate the full buffer up front.

function encodeWavInt16Mono(samples: Int16Array, sampleRate: number): Buffer {
  const headerSize = 44;
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');

  // fmt subchunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);              // subchunk size
  buf.writeUInt16LE(1, 20);               // PCM format
  buf.writeUInt16LE(1, 22);               // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);  // byte rate (mono * 2 bytes)
  buf.writeUInt16LE(2, 32);               // block align
  buf.writeUInt16LE(16, 34);              // bits per sample

  // data subchunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2);
  }

  return buf;
}
