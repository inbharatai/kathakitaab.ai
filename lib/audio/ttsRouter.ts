// ============================================================
// KathaKitaab.ai — TTS Router
//
// One entry point for all narration. Picks the best provider
// based on language, character voice, and provider availability.
//
// Chain (configurable):
//   1. Sarvam Bulbul v3 — primary. Native Hindi + English, cheap,
//      8 character voices. Wins for cost AND quality on Indic content.
//   2. Gemini 2.5 Native Audio — fallback. Native multilingual,
//      ~30 voices. Used when Sarvam is down or returns an error.
//
// OpenAI tts-1 is deliberately NOT in the chain (anglocentric
// prosody — wrong tool for an Indian-stories app).
// ============================================================

import { sarvamTTS, isSarvamConfigured } from './sarvamClient';
import { geminiTTS, isGeminiConfigured } from './geminiAudioClient';
import { getVoiceMapping, type CharacterArchetype } from './characterVoices';
import { deliveryForTone, toneFromMood, detectTone, type Tone } from './emotionTagger';

export type TTSLanguage = 'hi' | 'en' | 'auto';

export interface TTSRequest {
  text: string;
  /** Character slug — used to pick a consistent voice across scenes. */
  characterSlug?: string;
  /** Override the archetype directly (e.g., switch to villain voice). */
  archetype?: CharacterArchetype;
  /** Language hint — 'auto' detects from script. Defaults to 'auto'. */
  language?: TTSLanguage;
  /** Explicit tone label. When omitted, the router classifies the
   *  text via emotionTagger; when also unmatched, falls back to
   *  scene mood, then to neutral. */
  tone?: Tone;
  /** Scene mood from the manifest. Used when tone isn't given and
   *  text classification returns neutral — keeps "this whole scene
   *  is sad" delivery even on lines that don't carry strong words. */
  mood?: string | null;
}

export interface TTSResult {
  audio: Buffer;
  mimeType: string;
  provider: 'sarvam' | 'gemini';
  voiceUsed: string;
  language: 'hi' | 'en';
  /** The tone label that was actually used to shape this audio. Lets
   *  the caller log + cache against the same key it was rendered with. */
  toneUsed: Tone;
}

/**
 * Route a TTS request through Sarvam → Gemini fallback chain.
 * Throws if no provider is configured or all providers fail.
 */
export async function speakTTS(req: TTSRequest): Promise<TTSResult> {
  const language = resolveLanguage(req.text, req.language);
  const voiceMap = req.archetype
    ? (await import('./characterVoices')).getVoiceMappingByArchetype(req.archetype)
    : getVoiceMapping(req.characterSlug);

  // Resolve emotional tone: caller-given > text-derived > scene-mood > neutral.
  // Each fallback is cheaper than the previous; we only do classification
  // once per call.
  const tone: Tone =
    req.tone
    ?? (() => {
      const fromText = detectTone(req.text);
      if (fromText !== 'neutral') return fromText;
      return toneFromMood(req.mood);
    })();
  const delivery = deliveryForTone(tone);

  const providers = buildProviderChain();
  if (providers.length === 0) {
    throw new Error('No TTS provider configured. Set SARVAM_API_KEY or GEMINI_API_KEY.');
  }

  let lastError: unknown;
  for (const provider of providers) {
    try {
      if (provider === 'sarvam') {
        const result = await sarvamTTS({
          text: req.text,
          language,
          speaker: voiceMap.sarvam,
          pace: delivery.pace,
          pitch: delivery.pitch,
          loudness: delivery.loudness,
        });
        return {
          audio: result.audio,
          mimeType: result.mimeType,
          provider: 'sarvam',
          voiceUsed: voiceMap.sarvam,
          language,
          toneUsed: tone,
        };
      }
      if (provider === 'gemini') {
        // Gemini doesn't expose pace/pitch/loudness controls but does
        // respect a leading natural-language prosody instruction. We
        // prepend a one-line stage direction so the fallback path
        // still picks up the tone — empty for neutral so caching stays
        // tight when no tone is needed.
        const direction = geminiToneDirection(tone);
        const text = direction ? `${direction}\n${req.text}` : req.text;
        const result = await geminiTTS({ text, language, voiceName: voiceMap.gemini });
        return {
          audio: result.audio,
          mimeType: result.mimeType,
          provider: 'gemini',
          voiceUsed: voiceMap.gemini,
          language,
          toneUsed: tone,
        };
      }
    } catch (err) {
      lastError = err;
      console.warn(`[TTS] ${provider} failed, trying next:`, err instanceof Error ? err.message : err);
    }
  }

  throw new Error(
    `All TTS providers failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

// ── Helpers ──

/**
 * Detect language from text. Devanagari → 'hi', else → 'en'.
 * Hindi text mixed with Latin (Hinglish) still routes to 'hi' —
 * Sarvam Bulbul v3 handles code-switching natively.
 */
export function resolveLanguage(text: string, hint?: TTSLanguage): 'hi' | 'en' {
  if (hint === 'hi' || hint === 'en') return hint;
  // Devanagari Unicode range U+0900–U+097F
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  return 'en';
}

function buildProviderChain(): Array<'sarvam' | 'gemini'> {
  const chain: Array<'sarvam' | 'gemini'> = [];
  if (isSarvamConfigured()) chain.push('sarvam');
  if (isGeminiConfigured()) chain.push('gemini');
  return chain;
}

/**
 * Per-tone stage direction prepended to Gemini-generated audio. Gemini
 * 2.5 native audio respects natural-language prosody hints in the text;
 * the model treats the first line as performance direction when it
 * looks like a stage cue. Empty string for neutral so we don't pay the
 * tokens when no shaping is needed.
 */
function geminiToneDirection(tone: Tone): string {
  switch (tone) {
    case 'serene':    return '(Speak softly, slowly, with a calm and reflective tone.)';
    case 'joyful':    return '(Speak warmly and brightly, slightly faster, with a smile in the voice.)';
    case 'dramatic':  return '(Speak with urgency, slightly faster and louder, like an action moment.)';
    case 'sorrowful': return '(Speak slowly, quietly, with a low voice — a moment of sadness.)';
    case 'sacred':    return '(Speak with reverence, measured and dignified, full-voiced but unhurried.)';
    case 'tense':     return '(Speak with restrained tension, slightly drawn out, as if every word matters.)';
    default:          return '';
  }
}
