import { NextResponse, after } from 'next/server';
import { generateBook } from '@/lib/openai/bookGeneratorAgent';
import { saveGeneratedBook, getBook, setProgress, isBookGenerating, getProgress } from '@/lib/data/bookRegistry';
import { isGeminiConfigured } from '@/lib/openai/client';
import { isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { moderatePrompt } from '@/lib/safety/moderation';

// Generation runs ~60–180s for a 10–12 scene book (one OpenAI
// chat per scene plus image generation). Default Vercel hobby
// timeout is 60s; this raises it to the platform max so the
// `after()` callback below has time to finish.
export const maxDuration = 300;

// POST /api/books/generate
// Body: { title: string }
// Kicks off generation and returns immediately; the actual work
// runs inside `after()` so it survives past the response and
// completes even though Vercel would otherwise freeze the lambda.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  if (!isGeminiConfigured() && !isOpenAIConfigured()) {
    return NextResponse.json({ error: 'No AI API configured. Set OPENAI_API_KEY or GEMINI_API_KEY.' }, { status: 503 });
  }

  const { title } = await request.json();
  if (!title || title.trim().length < 2) {
    return NextResponse.json({ error: 'Book title is required (minimum 2 characters).' }, { status: 400 });
  }

  // Pre-generation moderation gate. Fails open on infra errors so a
  // moderation outage doesn't break legitimate creation, but blocks
  // anything that hits hard-stop categories (sexual/minors etc.) or
  // the model's overall flag. Logging the categories — never the
  // user's text — preserves user privacy in our logs.
  const moderation = await moderatePrompt(title);
  if (moderation.flagged) {
    console.warn('[generate] moderation blocked title; categories:', moderation.categories.join(', '));
    return NextResponse.json({ error: moderation.reason }, { status: 400 });
  }

  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const existing = await getBook(slug);
  if (existing) {
    return NextResponse.json({ book: existing, cached: true });
  }

  if (await isBookGenerating(slug)) {
    return NextResponse.json({ generating: true, slug });
  }

  // Mark "in flight" before scheduling the work so the very next
  // poll from the browser already sees a progress entry — even
  // before generateBook emits its first onProgress callback.
  await setProgress(slug, 'Starting agents...', 0);

  after(async () => {
    try {
      const book = await generateBook(title, (step, percent) => {
        // Fire-and-forget: a dropped progress write is acceptable
        // because the next callback will overwrite it. We don't
        // want to block scene generation on Redis round-trips.
        void setProgress(slug, step, percent).catch(err => {
          console.error('[generate] progress write failed:', err);
        });
      });
      await saveGeneratedBook(book);
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
  if (book) return NextResponse.json({ done: true, book });

  const progress = await getProgress(slug);
  if (!progress) return NextResponse.json({ error: 'No generation found for this slug' }, { status: 404 });

  return NextResponse.json({ ...progress, done: progress.done });
}
