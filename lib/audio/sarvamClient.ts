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
const SARVAM_TIMEOUT_MS = 15_000;

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SARVAM_TIMEOUT_MS);

  try {
    // v2 accepts pace + pitch + loudness; v3 only accepts pace. Detect
    // the model and gate the prosody fields. Default model is v2 so
    // emotional delivery is on by default.
    const isV3 = /v3/i.test(getSarvamModel());
    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

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
  } finally {
    clearTimeout(timeout);
  }
}
