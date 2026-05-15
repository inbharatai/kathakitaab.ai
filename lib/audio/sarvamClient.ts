// ============================================================
// KathaKitaab — Sarvam Bulbul v3 TTS Client
//
// Native Hindi + English (and 11 Indic languages). Bulbul v3 has
// 8 speakers and handles Hinglish code-switching cleanly. Cheap
// (~$0.01/min) — primary path in the TTS router.
//
// Returns WAV (22050 Hz, 16-bit mono).
// ============================================================

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';
// 40s. Long-form scene narrations (1000-1500 chars) on the paid
// tier reliably need 25-32s. A tighter ceiling forced every long
// scene into the Gemini fallback. The live-reader path passes
// short text (≤200 chars per branch) and finishes well under
// this anyway, so widening here doesn't slow that path.
const SARVAM_TIMEOUT_MS = 40_000;

// Sarvam Bulbul v3 caps each `inputs[i]` element at 500 characters.
// Anything over that returns 400 "String should have at most 500
// characters" — which is what was silently bouncing every long
// narration into the Gemini fallback. We split on sentence boundaries
// and pass the chunks as separate `inputs` elements; Sarvam stitches
// them server-side and returns a single combined WAV. Margin of 20
// covers the ", " join we may insert when packing partials.
const SARVAM_INPUT_CAP = 480;

export type SarvamLanguage = 'hi' | 'en';

export interface SarvamTTSRequest {
  text: string;
  language: SarvamLanguage;
  /** Bulbul v3 speaker id (anushka, abhilash, manisha, vidya, arya, karun, hitesh, aditya). */
  speaker: string;
  pace?: number;
  pitch?: number;
  loudness?: number;
}

export interface SarvamTTSResult {
  audio: Buffer;
  mimeType: string;
}

export function isSarvamConfigured(): boolean {
  return !!process.env.SARVAM_API_KEY;
}

function getSarvamModel(): string {
  return process.env.SARVAM_TTS_MODEL || 'bulbul:v2';
}

export async function sarvamTTS(req: SarvamTTSRequest): Promise<SarvamTTSResult> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error('SARVAM_API_KEY not set');

  const langCode = req.language === 'hi' ? 'hi-IN' : 'en-IN';
  const text = req.text.trim();
  if (text.length < 5) throw new Error('Sarvam: text too short');
  // Bulbul v3 enforces ≤500 chars per input element; we chunk on
  // sentence boundaries and let Sarvam concatenate server-side.
  const inputs = chunkForSarvam(text);

  // v2 accepts pace + pitch + loudness; v3 only accepts pace. Detect
  // the model and gate the prosody fields. Default model is v2 so
  // emotional delivery is on by default.
  const isV3 = /v3/i.test(getSarvamModel());
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  // No retry. With the longer 22s timeout, Sarvam either responds
  // or it doesn't — retrying a slow endpoint just doubles wait time
  // without improving the success rate. If Sarvam fails on the
  // first attempt, speakTTS falls through to Gemini (still WAV,
  // still emotional, just a different voice). Better to ship the
  // book on time with mixed voices than to push the lambda over
  // its budget chasing a perfect Sarvam pass.
  let attempt = 0;
  const MAX_ATTEMPTS = 1;
  let lastErr: Error = new Error('sarvamTTS: no attempts made');
  while (attempt < MAX_ATTEMPTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SARVAM_TIMEOUT_MS);
    try {
      const res = await fetch(SARVAM_TTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': apiKey,
        },
        body: JSON.stringify({
          inputs,
          target_language_code: langCode,
          speaker: req.speaker,
          model: getSarvamModel(),
          speech_sample_rate: 22050,
          enable_preprocessing: true,
          ...(req.pace !== undefined ? { pace: clamp(req.pace, 0.5, 2.0) } : {}),
          ...(!isV3 && req.pitch !== undefined ? { pitch: clamp(req.pitch, -100, 100) } : {}),
          ...(!isV3 && req.loudness !== undefined ? { loudness: clamp(req.loudness, -3, 3) } : {}),
        }),
        signal: controller.signal,
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const body = await res.text().catch(() => '');
        lastErr = new Error(`Sarvam ${res.status}: ${body.slice(0, 200)}`);
        // Brief backoff so we don't immediately re-trigger the 429.
        // After one retry, fall through and let speakTTS try Gemini.
        await new Promise(r => setTimeout(r, 800));
        attempt++;
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Sarvam ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as { audios?: string[] };
      const b64 = json.audios?.[0];
      if (!b64) throw new Error('Sarvam returned no audio');

      return {
        audio: Buffer.from(b64, 'base64'),
        mimeType: 'audio/wav',
      };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // AbortError on timeout — also worth one more shot before
      // surrendering to Gemini fallback.
      if (lastErr.name === 'AbortError' && attempt < MAX_ATTEMPTS - 1) {
        attempt++;
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr;
}

/**
 * Split a long narration into chunks that satisfy Sarvam's 500-char
 * per-input cap. Greedy pack on sentence boundaries; falls back to
 * comma boundaries inside oversized sentences, and finally to a hard
 * slice if a single clause is somehow still too long. Returns at
 * least one chunk even when the input is empty (caller already
 * guards on length, but better safe than 0-input 400).
 *
 * Why sentence-aware: Sarvam concatenates the chunks back-to-back in
 * the returned WAV. Cutting mid-word produces an audible click and
 * unnatural prosody at every boundary; cutting at sentence ends
 * lets the model end one phrase cleanly and start the next with
 * fresh intonation, indistinguishable from a single render.
 */
export function chunkForSarvam(text: string, max = SARVAM_INPUT_CAP): string[] {
  if (text.length <= max) return [text];

  // First pass: split into sentences (Devanagari danda + Latin
  // punctuation). Keep the trailing punctuation attached so the
  // prosody stays right.
  const sentences = text
    .split(/(?<=[।.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  const flush = () => { if (buf) { chunks.push(buf); buf = ''; } };
  const pushSafe = (piece: string) => {
    // If even this piece is over the cap, recurse on commas, then
    // hard-slice as a last resort.
    if (piece.length <= max) {
      if (!buf) buf = piece;
      else if (buf.length + 1 + piece.length <= max) buf += ' ' + piece;
      else { flush(); buf = piece; }
      return;
    }
    flush();
    const commaParts = piece.split(/(?<=,)\s+/).map(s => s.trim()).filter(Boolean);
    if (commaParts.length > 1) {
      for (const p of commaParts) pushSafe(p);
      return;
    }
    // Hard slice — last-resort guard so we never emit a >max chunk.
    for (let i = 0; i < piece.length; i += max) {
      chunks.push(piece.slice(i, i + max));
    }
  };

  for (const s of sentences) pushSafe(s);
  flush();

  return chunks.length > 0 ? chunks : [text.slice(0, max)];
}
