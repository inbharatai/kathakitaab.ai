// ============================================================
// KathaKitaab.ai — Text-to-Speech API
// POST /api/livebook/tts
//
// Routes through Sarvam Bulbul v3 → Gemini 2.5 Native Audio fallback
// chain. Auto-detects Hindi (Devanagari) vs English. Per-character
// voice consistency across scenes via characterSlug.
//
// Cache TTL bumped to 7 days for TTS — narration text is stable,
// repeats should be free.
// ============================================================

import { NextResponse } from 'next/server';
import { buildCacheKey, getCachedResponse, setCachedResponse } from '@/lib/cache/responseCache';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { speakTTS } from '@/lib/audio/ttsRouter';

const TTS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface TTSRequest {
  text: string;
  /** Character slug — 'rama', 'sita', etc. Used to pick a consistent voice. */
  characterSlug?: string;
  /** Legacy: voice category from old soundEngine ('narration', 'male_character', etc). */
  voice?: string;
  /** Language hint: 'hi' | 'en' | 'auto'. Defaults to auto-detect. */
  language?: 'hi' | 'en' | 'auto';
  /** Reserved for future streaming support. Currently ignored. */
  speed?: number;
}

// Map legacy voice tags from the old route to the new archetype system.
// Lets existing callers (soundEngine speakAsCharacter / speakNarration)
// keep working without code changes.
const LEGACY_VOICE_MAP: Record<string, string> = {
  narration: 'narrator',
  male_character: 'noble-male',
  female_character: 'noble-female',
  child: 'young-female',
  sage: 'wise-male',
  villain: 'commanding-male',
  default: 'narrator',
};

export async function POST(request: Request) {
  try {
    const body: TTSRequest = await request.json();
    const { text, characterSlug, voice, language = 'auto' } = body;

    if (!text || text.trim().length < 5) {
      return NextResponse.json({ error: 'Text too short' }, { status: 400 });
    }

    // Resolve archetype: prefer characterSlug; fall back to legacy voice tag.
    const archetypeFromLegacy = voice ? LEGACY_VOICE_MAP[voice] : undefined;

    // Cache key includes language + voice to prevent cross-contamination.
    const cacheKey = buildCacheKey({
      type: 'tts',
      text: text.slice(0, 100),
      hash: simpleHash(text),
      character: characterSlug ?? archetypeFromLegacy ?? 'narrator',
      lang: language,
    });

    // Cache hits are free — serve before counting against the rate limit.
    // Otherwise re-narrating the same scene burns quota for nothing.
    const cached = getCachedResponse(cacheKey) as { audioB64: string; mime: string; provider: string } | null;
    if (cached) {
      const cachedBuf = Buffer.from(cached.audioB64, 'base64');
      return new NextResponse(Uint8Array.from(cachedBuf), {
        headers: {
          'Content-Type': cached.mime,
          'X-Cached': 'true',
          'X-TTS-Provider': cached.provider,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // Cache miss → rate-limit before paying for a provider call.
    const limited = checkRateLimit(request, { scope: 'tts' });
    if (limited) return limited;

    // Route through Sarvam → Gemini chain
    const result = await speakTTS({
      text: text.slice(0, 1500),
      characterSlug,
      // Cast: archetype shape matches CharacterArchetype enum strings
      archetype: archetypeFromLegacy as never,
      language,
    });

    // Cache for 7 days — narration text is stable, repeats are free
    setCachedResponse(
      cacheKey,
      {
        audioB64: result.audio.toString('base64'),
        mime: result.mimeType,
        provider: result.provider,
      },
      `${result.provider}:${result.voiceUsed}`,
      TTS_CACHE_TTL_MS,
    );

    return new NextResponse(Uint8Array.from(result.audio), {
      headers: {
        'Content-Type': result.mimeType,
        'X-Cached': 'false',
        'X-TTS-Provider': result.provider,
        'X-TTS-Voice': result.voiceUsed,
        'X-TTS-Language': result.language,
        'Cache-Control': 'public, max-age=86400',
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'TTS failed';
    console.error('[TTS Error]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
