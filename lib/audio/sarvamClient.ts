// ============================================================
// KathaKitaab.ai — Sarvam Bulbul v3 TTS Client
//
// Native Hindi + English (and 11 Indic languages). Bulbul v3 has
// 8 speakers and handles Hinglish code-switching cleanly. Cheap
// (~$0.01/min) — primary path in the TTS router.
//
// Returns WAV (22050 Hz, 16-bit mono).
// ============================================================

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';
// 10s per attempt — Sarvam typical p99 is ~6s. Keeping this tight
// matters because the book generator has only ~300s of Vercel lambda
// budget; the previous 15s + 3-retry chain could spend 45s+ on a
// single bad scene and starve the rest of the TTS pass.
const SARVAM_TIMEOUT_MS = 10_000;

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
  // Sarvam single-request length cap is generous (~1500 chars in v3); we
  // trim defensively to avoid 400s on edge cases.
  const text = req.text.trim().slice(0, 1500);
  if (text.length < 5) throw new Error('Sarvam: text too short');

  // v2 accepts pace + pitch + loudness; v3 only accepts pace. Detect
  // the model and gate the prosody fields. Default model is v2 so
  // emotional delivery is on by default.
  const isV3 = /v3/i.test(getSarvamModel());
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  // Retry once on transient errors (429 rate limit, 5xx). The book
  // generator fires several Sarvam calls in parallel; without any
  // retry, even a single 429 in the burst falls all the way through
  // to Gemini and the whole book ends up with the wrong voice. But
  // too many retries balloons worst-case latency past Vercel's 300s
  // lambda budget — one retry is the right balance.
  let attempt = 0;
  const MAX_ATTEMPTS = 2;
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
          inputs: [text],
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
