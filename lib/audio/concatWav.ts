// ============================================================
// KathaKitaab.ai — WAV concatenator
//
// Splices multiple PCM WAV files into a single output file. Used by
// the per-cue TTS pipeline (Wave 3.1) to render each sentence with
// its own emotional tone, then stitch the clips into one scene
// audio file with byte-accurate cue timing.
//
// Constraints:
//   • All inputs must share the same sample rate, channel count, and
//     bit depth. The function throws if not. Sarvam Bulbul always
//     returns 22050 Hz 16-bit mono so this holds for our pipeline.
//   • PCM only — no ADPCM, no compressed sub-formats. The WAV header
//     `fmt ` chunk's audioFormat must be 1 (PCM).
//   • Output is also PCM WAV with a freshly-written 44-byte header.
//
// Returns both the concatenated buffer AND the per-clip durations
// in milliseconds so the caller can build accurate cue timing
// without a second probe pass.
// ============================================================

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Milliseconds. */
  durationMs: number;
  /** Offset of the start of the `data` chunk (PCM bytes), inclusive. */
  dataOffset: number;
  /** Length of the `data` chunk in bytes (PCM bytes). */
  dataLength: number;
}

/** Parse a WAV's RIFF + fmt + data chunks. Throws on malformed or
 *  non-PCM input. Designed to be cheap — just header-walking, no
 *  full decode. */
export function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 44) throw new Error('wav: too short for header');
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('wav: missing RIFF magic');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('wav: missing WAVE magic');

  let cursor = 12;
  let fmtFound = false;
  let dataOffset = -1;
  let dataLength = 0;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;

  while (cursor + 8 <= buf.length) {
    const id = buf.toString('ascii', cursor, cursor + 4);
    const size = buf.readUInt32LE(cursor + 4);
    const bodyStart = cursor + 8;

    if (id === 'fmt ') {
      const audioFormat = buf.readUInt16LE(bodyStart);
      if (audioFormat !== 1) throw new Error(`wav: only PCM supported (got format ${audioFormat})`);
      channels = buf.readUInt16LE(bodyStart + 2);
      sampleRate = buf.readUInt32LE(bodyStart + 4);
      bitsPerSample = buf.readUInt16LE(bodyStart + 14);
      fmtFound = true;
    } else if (id === 'data') {
      dataOffset = bodyStart;
      dataLength = size;
      // We have everything we need; trust the rest of the file is PCM.
      break;
    }
    // RIFF chunks are word-aligned — pad to the next even byte.
    cursor = bodyStart + size + (size % 2);
  }

  if (!fmtFound) throw new Error('wav: missing fmt chunk');
  if (dataOffset < 0) throw new Error('wav: missing data chunk');

  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const durationMs = byteRate > 0 ? Math.round((dataLength / byteRate) * 1000) : 0;
  return { sampleRate, channels, bitsPerSample, durationMs, dataOffset, dataLength };
}

/** Build a fresh 44-byte PCM WAV header. */
function buildHeader(sampleRate: number, channels: number, bitsPerSample: number, dataSize: number): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM fmt-chunk size
  header.writeUInt16LE(1, 20);           // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

export interface ConcatResult {
  /** Concatenated WAV (header + interleaved PCM bodies). */
  buffer: Buffer;
  /** Per-input durations in ms, in input order. Caller uses these to
   *  build cumulative cue start/end timings. */
  durationsMs: number[];
  /** Total duration in ms. */
  totalDurationMs: number;
}

/**
 * Concatenate multiple PCM WAVs into a single PCM WAV. All inputs must
 * share sample rate, channels, and bit depth.
 */
export function concatWav(inputs: Buffer[]): ConcatResult {
  if (inputs.length === 0) throw new Error('concatWav: no inputs');
  const heads = inputs.map(parseWav);
  const ref = heads[0];
  // Tight format-equality check. 16-bit mono 22050 Hz is the
  // expected shape from Sarvam, but the helper is generic.
  for (let i = 1; i < heads.length; i++) {
    const h = heads[i];
    if (h.sampleRate !== ref.sampleRate
      || h.channels !== ref.channels
      || h.bitsPerSample !== ref.bitsPerSample) {
      throw new Error(`concatWav: input ${i} has mismatched format (${h.sampleRate}/${h.channels}ch/${h.bitsPerSample}b vs ${ref.sampleRate}/${ref.channels}ch/${ref.bitsPerSample}b)`);
    }
  }
  const totalData = heads.reduce((s, h) => s + h.dataLength, 0);
  const header = buildHeader(ref.sampleRate, ref.channels, ref.bitsPerSample, totalData);
  // Slice the PCM body of each input (no header) and concatenate.
  const bodies = inputs.map((buf, i) => {
    const h = heads[i];
    return Uint8Array.from(buf.subarray(h.dataOffset, h.dataOffset + h.dataLength));
  });
  const out = Buffer.concat([Uint8Array.from(header), ...bodies]);
  const durationsMs = heads.map(h => h.durationMs);
  return { buffer: out, durationsMs, totalDurationMs: durationsMs.reduce((a, b) => a + b, 0) };
}
