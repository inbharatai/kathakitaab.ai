import { NextResponse } from 'next/server';
import { generateBook } from '@/lib/openai/bookGeneratorAgent';
import { saveGeneratedBook, getBook, setProgress, isBookGenerating } from '@/lib/data/bookRegistry';
import { isGeminiConfigured } from '@/lib/openai/client';
import { isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

// POST /api/books/generate
// Body: { title: string }
// Streams progress via SSE or returns completed book
export async function POST(request: Request) {
  const limited = checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  if (!isGeminiConfigured() && !isOpenAIConfigured()) {
    return NextResponse.json({ error: 'No AI API configured. Set OPENAI_API_KEY or GEMINI_API_KEY.' }, { status: 503 });
  }

  const { title } = await request.json();
  if (!title || title.trim().length < 2) {
    return NextResponse.json({ error: 'Book title is required (minimum 2 characters).' }, { status: 400 });
  }

  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // Already exists?
  const existing = getBook(slug);
  if (existing) {
    return NextResponse.json({ book: existing, cached: true });
  }

  // Already generating?
  if (isBookGenerating(slug)) {
    return NextResponse.json({ generating: true, slug });
  }

  // Start generation (non-blocking)
  setProgress(slug, 'Starting agents...', 0);

  generateBook(title, (step, percent) => {
    setProgress(slug, step, percent);
  })
    .then(book => {
      saveGeneratedBook(book);
      setProgress(slug, 'Complete!', 100, true);
    })
    .catch(err => {
      setProgress(slug, 'Error', 0, true, err.message);
    });

  return NextResponse.json({ generating: true, slug, message: 'Agents are building your book. Poll /api/books/generate/progress?slug=' + slug });
}

// GET /api/books/generate?slug=xxx — check progress
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const book = getBook(slug);
  if (book) return NextResponse.json({ done: true, book });

  const { getProgress } = await import('@/lib/data/bookRegistry');
  const progress = getProgress(slug);
  if (!progress) return NextResponse.json({ error: 'No generation found for this slug' }, { status: 404 });

  return NextResponse.json({ ...progress, done: progress.done });
}
