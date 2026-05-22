// ============================================================
// KathaKitaab — TTS Router
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
import {
  getVoiceMapping,
  getVoiceMappingByArchetype,
  resolveArchetypeForBook,
  type CharacterArchetype,
} from './characterVoices';
import { deliveryForTone, toneFromMood, detectTone, type Tone } from './emotionTagger';

export type TTSLanguage = 'hi' | 'en' | 'auto';

export interface TTSRequest {
  text: string;
  /** Character slug — used to pick a consistent voice across scenes. */
  characterSlug?: string;
  /** Book slug — when provided alongside characterSlug, the router
   *  consults the per-book registry first to find the LLM's chosen
   *  voice_archetype. Critical for AI-generated books whose
   *  characters aren't in the global archetype table. */
  bookSlug?: string;
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
  /** Which provider was selected as primary for this language. */
  ttsProviderSelected: 'sarvam' | 'gemini';
  /** Which provider actually succeeded (may differ from selected if fallback occurred). */
  ttsProviderUsed: 'sarvam' | 'gemini';
  /** Number of retry attempts made across all providers. */
  retryCount: number;
}

/**
 * Route a TTS request through Sarvam → Gemini fallback chain.
 * Throws if no provider is configured or all providers fail.
 */
export async function speakTTS(req: TTSRequest): Promise<TTSResult> {
  const language = resolveLanguage(req.text, req.language);

  // Voice resolution priority:
  //   1. Caller passed an explicit archetype  — honour it
  //   2. bookSlug + characterSlug → registry lookup (covers AI-
  //      generated characters whose voice_archetype the LLM picked)
  //   3. characterSlug alone → global archetype map (Ramayana,
  //      Mahabharata, common role nouns)
  //   4. Fall through to narrator
  let voiceMap;
  if (req.archetype) {
    voiceMap = getVoiceMappingByArchetype(req.archetype);
  } else if (req.bookSlug && req.characterSlug) {
    const archetype = await resolveArchetypeForBook(req.bookSlug, req.characterSlug);
    voiceMap = getVoiceMappingByArchetype(archetype);
  } else {
    voiceMap = getVoiceMapping(req.characterSlug);
  }

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

  const providers = buildProviderChain(language);
  if (providers.length === 0) {
    throw new Error('No TTS provider configured. Set SARVAM_API_KEY or GEMINI_API_KEY.');
  }

  const ttsProviderSelected = providers[0];
  let lastError: unknown;
  let retryCount = 0;

  for (const provider of providers) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
            ttsProviderSelected,
            ttsProviderUsed: 'sarvam',
            retryCount,
          };
        }
        if (provider === 'gemini') {
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
            ttsProviderSelected,
            ttsProviderUsed: 'gemini',
            retryCount,
          };
        }
      } catch (err) {
        lastError = err;
        retryCount++;
        const delayMs = attempt < maxRetries ? Math.min(1000 * Math.pow(3, attempt - 1), 10000) : 0;
        console.warn(`[TTS] ${provider} attempt ${attempt}/${maxRetries} failed (delay ${delayMs}ms):`, err instanceof Error ? err.message : err);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }
  }

  throw new Error(
    `All TTS providers failed after ${retryCount} retries. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
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

function buildProviderChain(language?: 'hi' | 'en'): Array<'sarvam' | 'gemini'> {
  const chain: Array<'sarvam' | 'gemini'> = [];
  // Hindi → Gemini primary (better multilingual quality), Sarvam fallback
  // English → Sarvam primary (better Indic prosody), Gemini fallback
  if (language === 'hi') {
    if (isGeminiConfigured()) chain.push('gemini');
    if (isSarvamConfigured()) chain.push('sarvam');
  } else {
    if (isSarvamConfigured()) chain.push('sarvam');
    if (isGeminiConfigured()) chain.push('gemini');
  }
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
