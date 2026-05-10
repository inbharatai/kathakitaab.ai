import { NextResponse, after } from 'next/server';
import { generateBook, type GeneratedBook, type GenerationMode, type BookMetadata } from '@/lib/openai/bookGeneratorAgent';
import { saveGeneratedBook, getBook, setProgress, isBookGenerating, getProgress } from '@/lib/data/bookRegistry';
import { isGeminiConfigured } from '@/lib/openai/client';
import { isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { moderatePrompt } from '@/lib/safety/moderation';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
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
interface WorldBody { mode?: 'world'; title: string; }
interface ClassroomBody { mode: 'classroom'; payload: ClassroomMeta; }
interface PersonalizedTextBody {
  mode: 'personalized_text';
  payload: PersonalizedTextMeta & { consent: boolean };
}
type GenerateBody = WorldBody | ClassroomBody | PersonalizedTextBody;

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
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  if (!isGeminiConfigured() && !isOpenAIConfigured()) {
    return NextResponse.json({ error: 'No AI API configured. Set OPENAI_API_KEY or GEMINI_API_KEY.' }, { status: 503 });
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate per-mode shape before any expensive work.
  const validationError = validateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Owner cookie. World mode permits anonymous; private modes
  // require a valid cookie (the middleware always sets one — if
  // it's missing here something is upstream-broken).
  const ownerId = getOwnerIdFromRequest(request);
  const isPrivateMode = body.mode === 'classroom' || body.mode === 'personalized_text';
  if (isPrivateMode && !ownerId) {
    return NextResponse.json({
      error: 'Could not establish ownership. Please reload and try again.',
    }, { status: 400 });
  }

  // Pre-generation moderation. World mode keeps the V0 fail-OPEN
  // behaviour. Classroom + personalized are CHILD-related modes
  // and MUST fail-CLOSED — a moderation outage cannot allow a
  // child story to be generated unverified.
  const moderationText = moderationInputFor(body);
  const moderation = await moderatePrompt(moderationText, { failClosed: isPrivateMode });
  if (moderation.flagged) {
    console.warn('[generate] moderation blocked; mode=%s categories=%s', body.mode || 'world', moderation.categories.join(','));
    return NextResponse.json({ error: moderation.reason }, { status: 400 });
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
    slug = bookTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
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
    if (await isBookGenerating(slug)) {
      return NextResponse.json({ generating: true, slug });
    }
  }

  // Mark "in flight" before scheduling the work so the very next
  // poll from the browser already sees a progress entry — even
  // before generateBook emits its first onProgress callback.
  await setProgress(slug, 'Starting...', 0);

  after(async () => {
    try {
      const book = await generateBook(bookTitle, (step, percent) => {
        void setProgress(slug, step, percent).catch(err => {
          console.error('[generate] progress write failed:', err);
        });
      }, { outlinePrompt });

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
        updatedAt: Date.now(),
      };

      await saveGeneratedBook(finalBook);
      await setProgress(slug, 'Complete!', 100, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      console.error('[generate] failed for', slug, ':', msg);
      await setProgress(slug, 'Error', 0, true, msg);
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

  const progress = await getProgress(slug);
  if (!progress) return NextResponse.json({ error: 'No generation found for this slug' }, { status: 404 });

  return NextResponse.json({ ...progress, done: progress.done });
}
