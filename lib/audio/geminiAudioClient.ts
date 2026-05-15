// ============================================================
// KathaKitaab — Gemini 2.5 Native Audio TTS Client
//
// Fallback path for the TTS router when Sarvam is unavailable.
// Native multilingual including Hindi. Returns 16-bit PCM at
// 24 kHz which we wrap into a WAV header for browser playback.
// ============================================================

import { getGeminiClient, isGeminiConfigured } from '@/lib/openai/client';

export type GeminiLanguage = 'hi' | 'en';

export interface GeminiTTSRequest {
  text: string;
  language: GeminiLanguage;
  /** Gemini prebuilt voice (Aoede, Charon, Fenrir, Kore, Leda, Orus, Puck, Zephyr…). */
  voiceName: string;
}

export interface GeminiTTSResult {
  audio: Buffer;
  mimeType: string;
}

export { isGeminiConfigured };

function getGeminiAudioModel(): string {
  return process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash-preview-tts';
}

export async function geminiTTS(req: GeminiTTSRequest): Promise<GeminiTTSResult> {
  if (!isGeminiConfigured()) throw new Error('GEMINI_API_KEY not set');

  const ai = getGeminiClient();
  const text = req.text.trim().slice(0, 4000);
  if (text.length < 5) throw new Error('Gemini: text too short');

  const response = await ai.models.generateContent({
    model: getGeminiAudioModel(),
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: req.voiceName },
        },
      },
    } as never,
  });

  const part = response.candidates?.[0]?.content?.parts?.[0];
  const inline = (part as { inlineData?: { data?: string; mimeType?: string } } | undefined)?.inlineData;
  const b64 = inline?.data;
  if (!b64) throw new Error('Gemini returned no audio');

  // Gemini returns 16-bit PCM at 24 kHz mono. Wrap as WAV.
  const pcm = Buffer.from(b64, 'base64');
  const sampleRate = parseSampleRate(inline?.mimeType) ?? 24000;
  const wav = pcmToWav(pcm, sampleRate, 1, 16);

  return { audio: wav, mimeType: 'audio/wav' };
}

// ── Helpers ──

function parseSampleRate(mimeType?: string): number | null {
  if (!mimeType) return null;
  const match = mimeType.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : null;
}

function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
