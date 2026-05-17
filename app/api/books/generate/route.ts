import { NextResponse, after } from 'next/server';
import { generateBook, type GeneratedBook, type GeneratedScene, type GeneratedCharacter, type GenerationMode, type BookMetadata } from '@/lib/openai/bookGeneratorAgent';
import type { StylePreset } from '@/lib/types/style';
import { defaultPresetForBook, STYLE_PRESETS, slugSuffixForPreset } from '@/lib/types/style';
import { detectGenreProfile } from '@/lib/engine/genreDetector';
import { saveGeneratedBook, getBook, setProgress, isBookGenerating, getProgress } from '@/lib/data/bookRegistry';
import { hydrateBookAudio } from '@/lib/video/manifestSynthesizer';
import { isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { checkRateLimit, checkOwnerDailyLimit } from '@/lib/middleware/rateLimit';
import { moderatePrompt } from '@/lib/safety/moderation';
import { scrubError } from '@/lib/safety/scrub';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { checkFreeEraGate, bookGenerationConsumed, bookGenerationRefund } from '@/lib/auth/freeEraGate';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { captureException } from '@/lib/observability/sentry';
import { capture as trackEvent } from '@/lib/observability/analytics';
import { guardPromptInput, sanitiseFields } from '@/lib/safety/promptInjectionGuard';
import {
  worldOutlinePrompt,
  classroomOutlinePrompt,
  classroomTitle,
  personalizedOutlinePrompt,
  personalizedTitle,
  privateSlug,
  type ClassroomMeta,
  type PersonalizedTextMeta,
} from '@/lib/openai/modePrompts';
import {
  createJob,
  updateJob,
  completeJob,
  failJob,
  getJobBySlug,
  hasActiveJob,
  type GenerationStep,
} from '@/lib/data/jobRegistry';
import { saveScenes, updateScene, saveBookCharacters, type PersistedScene } from '@/lib/data/sceneRegistry';

// Generation runs ~60–180s for a 10–12 scene book (one OpenAI
// chat per scene plus image generation). Default Vercel hobby
// timeout is 60s; this raises it to the platform max so the
// `after()` callback below has time to finish.
export const maxDuration = 300;

// ── Body shapes ──────────────────────────────────────────────
// We accept three forms for backwards compat:
//   (1) Legacy:  { title: 'Mahabharata' }                 → world mode
//   (2) Tagged:  { mode: 'world', title: 'Mahabharata' }
//   (3) Tagged:  { mode: 'classroom', payload: {...} }
//                { mode: 'personalized_text', payload: {...} }
// Form (1) keeps existing clients (BookGenerator before the mode
// selector ships) working without coordinated rollout.
// Every body shape can carry an optional `stylePreset` field. The
// client-side BookGenerator surfaces this; the server falls back to
// the title-derived default when the client omits it.
interface WorldBody { mode?: 'world'; title: string; stylePreset?: StylePreset; }
interface ClassroomBody { mode: 'classroom'; payload: ClassroomMeta; stylePreset?: StylePreset; }
interface PersonalizedTextBody {
  mode: 'personalized_text';
  payload: PersonalizedTextMeta & { consent: boolean };
  stylePreset?: StylePreset;
}
type GenerateBody = WorldBody | ClassroomBody | PersonalizedTextBody;

/** Resolve the style preset for this request — explicit client choice
 *  wins, otherwise we suggest a sensible default based on genre
 *  detection from the title so sci-fi doesn't default to photoreal
 *  mythology and folktales default to watercolour.
 *
 *  Falls back to the legacy title heuristic when genre detection
 *  yields generic (no strong signals). */
function resolveStylePreset(body: GenerateBody, bookTitle: string): StylePreset {
  const explicit = body.stylePreset;
  if (explicit && explicit in STYLE_PRESETS) return explicit;

  const isChildrenStory = body.mode === 'personalized_text';

  // Genre-aware override: when the title carries strong signals,
  // pick the preset that matches the detected genre rather than
  // the legacy "fables → watercolour, everything else → photoreal"
  // rule that forced Vedic aesthetics on every title.
  const profile = detectGenreProfile(bookTitle);
  if (profile.genre !== 'generic') {
    return profile.recommendedPreset;
  }

  return defaultPresetForBook({ title: bookTitle, isChildrenStory });
}

// ── Helpers ──────────────────────────────────────────────────

/** Pulls together the moderation input string for a request. We
 *  feed the moderation API every piece of user-supplied text so the
 *  classifier sees what the LLM will see. Internal labels are
 *  stripped — only the parent's own words go through. */
function moderationInputFor(body: GenerateBody): string {
  if (!body.mode || body.mode === 'world') {
    return (body as WorldBody).title || '';
  }
  if (body.mode === 'classroom') {
    const p = body.payload;
    return [p.gradeBand, p.subject, p.chapter, p.learningGoal, p.tone].filter(Boolean).join(' | ');
  }
  if (body.mode === 'personalized_text') {
    const p = body.payload;
    return [p.childName, p.interests, p.prompt, p.moral, p.tone].filter(Boolean).join(' | ');
  }
  return '';
}

/** Validate per-mode required fields. Returns an error string for
 *  the client when something is missing. Empty string = pass. */
function validateBody(body: GenerateBody): string {
  if (!body.mode || body.mode === 'world') {
    if (!('title' in body) || !body.title || body.title.trim().length < 2) {
      return 'Book title is required (minimum 2 characters).';
    }
    return '';
  }
  if (body.mode === 'classroom') {
    const p = body.payload;
    if (!p?.gradeBand || p.gradeBand.trim().length === 0) {
      return 'Class / grade is required for classroom stories.';
    }
    if (!p.chapter && !p.subject) {
      return 'A topic, chapter, or subject is required for classroom stories.';
    }
    return '';
  }
  if (body.mode === 'personalized_text') {
    const p = body.payload;
    if (!p?.consent) {
      return 'Parental consent is required to create a personalized story.';
    }
    if (!p.childName || p.childName.trim().length === 0) {
      return 'Child name is required.';
    }
    // Last names rejected — first name only. Splits on whitespace.
    if (p.childName.trim().split(/\s+/).length > 1) {
      return 'Please enter the child’s first name only.';
    }
    if (typeof p.age !== 'number' || p.age < 3 || p.age > 12) {
      return 'Child age must be between 3 and 12.';
    }
    return '';
  }
  return 'Unknown generation mode.';
}

// ── Route handler ────────────────────────────────────────────

export async function POST(request: Request) {
  // Resolve the session first so admin allowlist callers can skip
  // the per-IP rate limit and moderation gates that would otherwise
  // throttle a deployment-owner doing live QA. Anonymous callers
  // get null back essentially for free (no cookie → no DB hit).
  const session = await getSessionFromRouteRequest(request);
  const isAdmin = isAdminSession(session);

  if (!isAdmin) {
    const limited = await checkRateLimit(request, { scope: 'expensive' });
    if (limited) return limited;
  }

  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: 'OPENAI_API_KEY is not set. The book generator is OpenAI-only.' }, { status: 503 });
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── Prompt injection guard ──
  // Sanitise every user-supplied text field before it reaches the LLM.
  if (!body.mode || body.mode === 'world') {
    const titleGuard = guardPromptInput((body as WorldBody).title, { maxLength: 200, strict: false, context: 'story_title' });
    if (!titleGuard.ok) {
      return NextResponse.json({ error: titleGuard.error }, { status: 400 });
    }
    (body as WorldBody).title = titleGuard.clean;
  }
  if (body.mode === 'classroom') {
    const p = (body as ClassroomBody).payload;
    const fields = {
      gradeBand: p.gradeBand,
      subject: p.subject,
      chapter: p.chapter,
      learningGoal: p.learningGoal,
      tone: p.tone,
    };
    const guard = sanitiseFields(fields, { maxLength: 300, strict: false });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: 400 });
    }
    p.gradeBand = guard.cleaned.gradeBand;
    p.subject = guard.cleaned.subject;
    p.chapter = guard.cleaned.chapter;
    p.learningGoal = guard.cleaned.learningGoal;
    p.tone = guard.cleaned.tone;
  }
  if (body.mode === 'personalized_text') {
    const p = (body as PersonalizedTextBody).payload;
    const fields = {
      childName: p.childName,
      interests: p.interests,
      prompt: p.prompt,
      moral: p.moral,
      tone: p.tone,
    };
    const guard = sanitiseFields(fields, { maxLength: 300, strict: false });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: 400 });
    }
    p.childName = guard.cleaned.childName;
    p.interests = guard.cleaned.interests;
    p.prompt = guard.cleaned.prompt;
    p.moral = guard.cleaned.moral;
    p.tone = guard.cleaned.tone;
  }

  // Validate per-mode shape before any expensive work.
  const validationError = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Auth gate: generation requires a signed-in user during the
  // free-era beta. Anonymous reading of existing books stays open.
  // The gate also enforces the first-100-users cap and the per-user
  // 1-book lifetime quota — admin sessions short-circuit it.
  const gate = await checkFreeEraGate(session);
  if (!gate.allowed) {
    const status = gate.reason === 'auth_required' ? 401
      : gate.reason === 'waitlist' ? 403
      : gate.reason === 'quota_exhausted' ? 402
      : 503;
    return NextResponse.json({ error: gate.message, reason: gate.reason }, { status });
  }

  // Owner cookie still used for read-time visibility checks on private
  // books. Authenticated users carry both the cookie AND a session;
  // newly-generated books are owned by the userId (preferred) but the
  // cookie ownerId is kept as a fallback for legacy reads.
  const ownerId = session?.userId ?? getOwnerIdFromRequest(request);
  const isPrivateMode = body.mode === 'classroom' || body.mode === 'personalized_text';
  if (isPrivateMode && !ownerId) {
    return NextResponse.json({
      error: 'Could not establish ownership. Please reload and try again.',
    }, { status: 400 });
  }

  // Daily per-cookie cap on child-mode generation. Runs AFTER the
  // per-IP rate limit so a determined attacker rotating IPs still
  // hits the cookie ceiling. World mode keeps only the per-IP cap
  // (anonymous public usage is fine to allow generously). Admin
  // sessions skip — they're doing live QA, not abuse.
  if (isPrivateMode && ownerId && !isAdmin) {
    const kind = body.mode === 'personalized_text' ? 'personalized' : 'classroom';
    const ownerLimited = await checkOwnerDailyLimit(ownerId, kind);
    if (ownerLimited) return ownerLimited;
  }

  // Pre-generation moderation. World mode keeps the V0 fail-OPEN
  // behaviour. Classroom + personalized are CHILD-related modes
  // and MUST fail-CLOSED — a moderation outage cannot allow a
  // child story to be generated unverified. Admin sessions bypass
  // entirely so the deployment owner can probe the system with
  // edge-case prompts without tripping over their own gates.
  if (!isAdmin) {
    const moderationText = moderationInputFor(body);
    const moderation = await moderatePrompt(moderationText, { failClosed: isPrivateMode });
    if (moderation.flagged) {
      // Log only the mode + category labels. The user's text NEVER
      // appears in this log line — keys/values are pre-scrubbed to
      // category names ('sexual/minors' etc.) which are safe.
      console.warn('[generate] moderation blocked; mode=%s categories=%s', body.mode || 'world', moderation.categories.join(','));
      return NextResponse.json({ error: moderation.reason }, { status: 400 });
    }
  }

  // ── Per-mode setup: title, slug, prompt, metadata ──
  const mode: GenerationMode = body.mode || 'world';
  let bookTitle: string;
  let slug: string;
  let outlinePrompt: string | undefined;
  let metadata: BookMetadata | undefined;
  let visibility: 'public' | 'private';

  if (mode === 'world') {
    bookTitle = (body as WorldBody).title.trim();
    // Slug includes a preset suffix so the same title in different
    // styles lands at different slugs and dedupe respects the style
    // choice.
    //
    // Key distinction: when the caller EXPLICITLY picks a preset
    // (the UI selector always does), photoreal also gets the
    // "-photoreal" suffix. That prevents a fresh photoreal Generate
    // from cache-hitting a legacy book at the bare slug (legacy
    // books pre-date the preset and may be rendered in a different
    // style than photoreal). Implicit/default callers (CLI scripts
    // without a preset) still hit the bare slug for backwards compat.
    const baseSlug = bookTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const userExplicit = !!body.stylePreset && body.stylePreset in STYLE_PRESETS;
    const presetForSlug: StylePreset = userExplicit
      ? body.stylePreset!
      : defaultPresetForBook({ title: bookTitle });
    slug = `${baseSlug}${slugSuffixForPreset(presetForSlug, userExplicit)}`;
    outlinePrompt = worldOutlinePrompt(bookTitle);
    visibility = 'public';
  } else if (mode === 'classroom') {
    const meta = (body as ClassroomBody).payload;
    bookTitle = classroomTitle(meta);
    slug = privateSlug('classroom');
    outlinePrompt = classroomOutlinePrompt(meta);
    metadata = { classroom: meta };
    visibility = 'private';
  } else if (mode === 'personalized_text') {
    const fullMeta = (body as PersonalizedTextBody).payload;
    const { consent: _consent, ...textMeta } = fullMeta;
    void _consent;
    bookTitle = personalizedTitle(textMeta);
    slug = privateSlug('personalized_text');
    outlinePrompt = personalizedOutlinePrompt(textMeta);
    metadata = {
      personalized: {
        ...textMeta,
        consentTimestamp: new Date().toISOString(),
      },
    };
    visibility = 'private';
  } else {
    return NextResponse.json({ error: 'Unknown generation mode.' }, { status: 400 });
  }

  // World-mode dedupe: re-asking for the same public book returns
  // the cached one. Private modes get random slugs so dedupe is
  // never reached for them — every personalized generation is its
  // own book.
  if (mode === 'world') {
    const existing = await getBook(slug);
    if (existing) {
      return NextResponse.json({ book: existing, cached: true });
    }
  }
  if (await hasActiveJob(slug) || (mode === 'world' && await isBookGenerating(slug))) {
    return NextResponse.json({ generating: true, slug });
  }

  // Create a persistent generation job before any LLM calls.
  // The job is the source of truth for resumable generation.
  const stylePreset = resolveStylePreset(body, bookTitle);
  const job = await createJob({
    slug,
    userId: session?.userId ?? ownerId ?? null,
    title: bookTitle,
    mode,
    stylePreset,
    metadata: {
      ...(metadata ? (metadata as Record<string, unknown>) : {}),
      outlinePrompt,
    },
  });

  // Mark "in flight" before scheduling the work so the very next
  // poll from the browser already sees a progress entry — even
  // before generateBook emits its first onProgress callback.
  await setProgress(slug, 'Starting...', 0);

  // Burn the user's free-era quota now that we're actually starting
  // a generation. Done AFTER setProgress so a 5xx from setProgress
  // doesn't burn the slot for nothing. Fire-and-forget — counter
  // bump shouldn't block the user's response. Admin sessions are a
  // no-op inside bookGenerationConsumed so testing doesn't drain
  // the owner's quota. Failure inside `after()` refunds via
  // bookGenerationRefund in the catch block below.
  if (session?.userId) {
    void bookGenerationConsumed(session).catch(err => {
      console.warn('[generate] failed to bump quota counter:', err instanceof Error ? err.message : err);
    });
  }

  after(async () => {
    let runningStep: GenerationStep = 'outline';

    const onStepComplete = async (step: 'outline' | 'portraits' | 'scenes' | 'images', data: unknown) => {
      try {
        if (step === 'outline') {
          const { outline, characters } = data as { outline: Record<string, unknown>; characters: GeneratedCharacter[] };
          await updateJob(job.id, {
            status: 'outline_generated',
            currentStep: 'portraits',
            completedSteps: 1,
            metadata: {
              ...job.metadata,
              outlineSubtitle: outline.book_subtitle,
              outlineDescription: outline.book_description,
              outlineSourceTradition: outline.source_tradition,
            },
          });
          await saveBookCharacters(slug, characters);
          runningStep = 'portraits';
        } else if (step === 'portraits') {
          const { characters } = data as { characters: GeneratedCharacter[] };
          await updateJob(job.id, { status: 'outline_generated', currentStep: 'scene_details', completedSteps: 2 });
          await saveBookCharacters(slug, characters);
          runningStep = 'scene_details';
        } else if (step === 'scenes') {
          const { scenes } = data as { scenes: GeneratedScene[] };
          await updateJob(job.id, { status: 'scenes_generated', currentStep: 'scene_images', completedSteps: 3 });
          const persisted: PersistedScene[] = scenes.map(s => ({
            ...s,
            savedAt: Date.now(),
            imageStatus: 'pending',
            ttsStatus: 'pending',
          }));
          await saveScenes(slug, persisted);
          runningStep = 'scene_images';
        } else if (step === 'images') {
          const { scenes } = data as { scenes: GeneratedScene[] };
          await updateJob(job.id, { status: 'images_generated', currentStep: 'scene_tts', completedSteps: 4 });
          await Promise.all(scenes.map(s =>
            updateScene(slug, s.scene_id, {
              background_asset_url: s.background_asset_url,
              beats: s.beats,
              imageStatus: s.background_asset_url ? 'completed' : 'failed',
            })
          ));
          runningStep = 'scene_tts';
        }
      } catch (err) {
        console.error('[generate] onStepComplete failed:', err instanceof Error ? err.message : err);
      }
    };

    try {
      const book = await generateBook(bookTitle, (step, percent) => {
        void setProgress(slug, step, percent).catch(err => {
          console.error('[generate] progress write failed:', scrubError(err).message);
        });
      }, { outlinePrompt, stylePreset, onStepComplete });

      // Stamp the book with mode-specific metadata. The generator
      // doesn't know about ownership — it just produces scenes /
      // characters / images / audio.
      const finalBook: GeneratedBook = {
        ...book,
        slug,                                   // override generator's title-derived slug
        mode,
        ownerId: isPrivateMode ? ownerId ?? undefined : undefined,
        visibility,
        metadata,
        stylePreset,                            // record the choice on the book
        updatedAt: Date.now(),
      };

      await saveGeneratedBook(finalBook);

      // Pre-render narration audio so the live reader's first visit
      // doesn't have to wait on /api/livebook/tts at every scene
      // change. Serial Gemini at ~1.5s/scene gap; 8 scenes ≈ 70s.
      // Budget-safe: text+images run ~250s, audio adds ~70s, total
      // stays under the 300s ceiling on a typical book. If this
      // step fails or the lambda hits its budget, the book is
      // still usable — the live reader falls back to /api/livebook/tts
      // (slower first scene, identical content).
      runningStep = 'scene_tts';
      try {
        await updateJob(job.id, { status: 'tts_generating', currentStep: 'scene_tts' });
        await setProgress(slug, 'Recording narration...', 95);
        const hydrated = await hydrateBookAudio(finalBook);
        await saveGeneratedBook(hydrated);
      } catch (audioErr) {
        // Don't fail the whole generation on audio hydration error —
        // /api/livebook/tts will pick up the slack on first read.
        console.warn('[generate] audio hydration failed (live reader will use lazy TTS):',
          audioErr instanceof Error ? audioErr.message : audioErr);
      }

      runningStep = 'stitch';
      await updateJob(job.id, { status: 'tts_generated', currentStep: 'stitch', completedSteps: 5 });
      await setProgress(slug, 'Complete!', 100, true);
      await completeJob(job.id, slug);
      void trackEvent({
        event: 'book_generated',
        distinctId: session?.userId ?? ownerId ?? slug,
        properties: { slug, mode, stylePreset, sceneCount: book.scenes?.length ?? 0 },
      });
    } catch (err: unknown) {
      // Scrub the error message before logging so any PII (child
      // name, prompt, slug) that landed in the thrown value is
      // redacted. The user-facing setProgress message keeps the
      // original text — that one only goes back to the cookie owner.
      const safe = scrubError(err);
      console.error('[generate] failed for', safe.name, ':', safe.message);
      const userMsg = err instanceof Error ? err.message : 'Generation failed';
      await failJob(job.id, runningStep, userMsg);
      await setProgress(slug, 'Error', 0, true, userMsg);
      // Refund the free-era slot we burned at request entry — a
      // failed generation shouldn't cost the user their one allowance.
      // No-op for admin (consume was a no-op too). Floors at zero so
      // a refund race against another success can't underflow.
      void bookGenerationRefund(session).catch(refundErr => {
        console.warn('[generate] refund failed:', refundErr instanceof Error ? refundErr.message : refundErr);
      });
      // Surface the unscrubbed error to Sentry — operator-only
      // destination, fine to include raw context tags.
      captureException(err, {
        tags: { route: 'books_generate', mode: mode || 'world' },
        extra: { slug },
      });
      void trackEvent({
        event: 'book_generation_failed',
        distinctId: session?.userId ?? ownerId ?? slug,
        properties: { slug, mode, stylePreset, error: safe.message },
      });
    }
  });

  return NextResponse.json({
    generating: true,
    slug,
    message: 'Agents are building your book. Poll /api/books/generate?slug=' + slug,
  });
}

// GET /api/books/generate?slug=xxx — check progress
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const book = await getBook(slug);
  if (book) {
    // For private books, only the owner sees the completed book;
    // anyone else gets a 404 to avoid revealing the slug exists.
    if (book.visibility === 'private') {
      const ownerId = getOwnerIdFromRequest(request);
      if (!ownerId || book.ownerId !== ownerId) {
        return NextResponse.json({ error: 'No generation found for this slug' }, { status: 404 });
      }
    }
    return NextResponse.json({ done: true, book });
  }

  // New: check persistent job registry first (7-day TTL vs 30-min progress)
  const job = await getJobBySlug(slug);
  if (job) {
    return NextResponse.json({ done: job.status === 'completed', job });
  }

  // Legacy fallback
  const progress = await getProgress(slug);
  if (!progress) return NextResponse.json({ error: 'No generation found for this slug' }, { status: 404 });

  return NextResponse.json({ ...progress, done: progress.done });
}
