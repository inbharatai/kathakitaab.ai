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

export type TTSLanguage = 'hi' | 'en' | 'auto';

export interface TTSRequest {
  text: string;
  /** Character slug — used to pick a consistent voice across scenes. */
  characterSlug?: string;
  /** Override the archetype directly (e.g., switch to villain voice). */
  archetype?: CharacterArchetype;
  /** Language hint — 'auto' detects from script. Defaults to 'auto'. */
  language?: TTSLanguage;
}

export interface TTSResult {
  audio: Buffer;
  mimeType: string;
  provider: 'sarvam' | 'gemini';
  voiceUsed: string;
  language: 'hi' | 'en';
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
        });
        return {
          audio: result.audio,
          mimeType: result.mimeType,
          provider: 'sarvam',
          voiceUsed: voiceMap.sarvam,
          language,
        };
      }
      if (provider === 'gemini') {
        const result = await geminiTTS({
          text: req.text,
          language,
          voiceName: voiceMap.gemini,
        });
        return {
          audio: result.audio,
          mimeType: result.mimeType,
          provider: 'gemini',
          voiceUsed: voiceMap.gemini,
          language,
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
