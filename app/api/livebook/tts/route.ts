// ============================================================
// KathaKitaab — Text-to-Speech API
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
import { uploadGeneratedNarration } from '@/lib/storage/audioStorage';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { canReadBook } from '@/lib/auth/bookAccess';
import { getBook } from '@/lib/data/bookRegistry';

const TTS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface TTSRequest {
  text: string;
  /** Character slug — 'rama', 'sita', etc. Used to pick a consistent voice. */
  characterSlug?: string;
  /** Book slug — propagates to the router so AI-generated characters
   *  get their LLM-chosen voice_archetype from the registry instead
   *  of falling through to the global hardcoded map. */
  bookSlug?: string;
  /** Legacy: voice category from old soundEngine ('narration', 'male_character', etc). */
  voice?: string;
  /** Language hint: 'hi' | 'en' | 'auto'. Defaults to auto-detect. */
  language?: 'hi' | 'en' | 'auto';
  /** Reserved for future streaming support. Currently ignored. */
  speed?: number;
  /** Optional explicit emotional tone. When omitted, the router
   *  classifies the text and falls back to scene mood. */
  tone?: 'neutral' | 'serene' | 'joyful' | 'dramatic' | 'sorrowful' | 'sacred' | 'tense';
  /** Scene mood from the manifest — used when tone isn't given and
   *  text classification returns neutral. */
  mood?: string;
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
    const { text, characterSlug, bookSlug, voice, language = 'auto', tone, mood } = body;

    if (!text || text.trim().length < 5) {
      return NextResponse.json({ error: 'Text too short' }, { status: 400 });
    }

    // Visibility check for AI-generated books.
    const session = await getSessionFromRouteRequest(request);
    if (bookSlug) {
      const book = await getBook(bookSlug);
      if (book) {
        const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
        const isAdmin = isAdminSession(session);
        if (!isAdmin && !canReadBook(book, ownerId)) {
          return NextResponse.json({ error: 'Book not found' }, { status: 404 });
        }
      }
    }

    // Resolve archetype: prefer characterSlug; fall back to legacy voice tag.
    const archetypeFromLegacy = voice ? LEGACY_VOICE_MAP[voice] : undefined;

    // Cache key includes tone + mood so emotional re-renders don't
    // collide with neutral cached audio. Without this, the first
    // request seeds the cache with a flat delivery and every
    // subsequent emotional request gets the wrong audio back.
    const cacheKey = buildCacheKey({
      type: 'tts',
      text: text.slice(0, 100),
      hash: simpleHash(text),
      // Include the book in the key so AI-generated characters can't
      // collide with same-slug Ramayana characters in the cache (e.g.
      // a generated book character coincidentally slugged "rama").
      book: bookSlug ?? 'none',
      character: characterSlug ?? archetypeFromLegacy ?? 'narrator',
      lang: language,
      tone: tone ?? 'auto',
      mood: mood ?? 'none',
    });

    // Cache hits are free — serve before counting against the rate limit.
    // Otherwise re-narrating the same scene burns quota for nothing.
    const cached = (await getCachedResponse(cacheKey)) as { audioB64: string; mime: string; provider: string } | null;
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
    const limited = await checkRateLimit(request, { scope: 'tts' });
    if (limited) return limited;

    // Route through Sarvam → Gemini chain. tone + mood propagate so
    // the router can pick a per-tone delivery (Sarvam: pace/pitch/
    // loudness; Gemini: prosody-direction prefix).
    const result = await speakTTS({
      text: text.slice(0, 1500),
      characterSlug,
      bookSlug,
      // Cast: archetype shape matches CharacterArchetype enum strings
      archetype: archetypeFromLegacy as never,
      language,
      tone,
      mood,
    });

    // Upload to Supabase first — same pattern hydrateBookAudio uses
    // for the pre-baked scene narrations. Content-hash filenames in
    // audioStorage make identical bytes dedupe automatically, so a
    // second TTS request with the same text re-uses the existing
    // blob instead of writing a new one. The browser's CDN cache
    // then carries the audio across Redis expirations.
    try {
      await uploadGeneratedNarration(result.audio, {
        mimeType: result.mimeType,
        pathHint: bookSlug || 'on-demand',
      });
    } catch (uploadErr) {
      // Non-fatal: Redis cache below still gives us a fast path,
      // and the next request just re-uploads. Log so it shows up
      // in Sentry without breaking the listener.
      console.warn('[tts] supabase upload failed:', uploadErr instanceof Error ? uploadErr.message : uploadErr);
    }

    // Cache for 7 days — narration text is stable, repeats are free.
    // Redis holds the bytes so the next listener gets an instant
    // first-paint without a Supabase round-trip; Supabase above is
    // the durable copy that survives TTL expiry.
    await setCachedResponse(
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
    return NextResponse.json({ error: "Narration is temporarily unavailable. Please try again." }, { status: 500 });
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
