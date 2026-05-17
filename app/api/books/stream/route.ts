import { NextResponse } from 'next/server';
import { getJobBySlug } from '@/lib/data/jobRegistry';
import { getBook } from '@/lib/data/bookRegistry';
import { getProgress } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';

/** SSE stream for a single book generation.
 *
 *  Client opens this when it starts a generation and stays
 *  connected until the book is done, failed, or not found.
 *
 *  Events:
 *    job  → { job }   when the job registry state changes
 *    book → { book }  when the finished book appears
 *    progress → { step, percent, done, error }
 *    done → {}        when everything is terminal
 *    error → { message }
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }

  // Authorize before opening SSE. Private books are not streamable
  // by non-owners — same semantics as /api/books/[slug].
  const bookCheck = await getBook(slug);
  if (bookCheck && bookCheck.visibility === 'private') {
    const ownerId = getOwnerIdFromRequest(request);
    const session = await getSessionFromRouteRequest(request);
    const isAdmin = isAdminSession(session);
    const callerId = session?.userId ?? ownerId;
    if (!isAdmin && bookCheck.ownerId !== callerId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = (event: string, data: unknown) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  const heartbeat = setInterval(() => {
    writer.write(encoder.encode(':heartbeat\n\n')).catch(() => {});
  }, 15000);

  let lastJobHash = '';
  let lastProgressHash = '';
  let loop = true;

  (async () => {
    try {
      // Check if book already exists (cached / completed before stream opened)
      const book = await getBook(slug);
      if (book) {
        send('book', { book });
        send('done', {});
        return;
      }

      // Stream loop: check job + progress every 1.5s
      while (loop) {
        const job = await getJobBySlug(slug);
        const progress = await getProgress(slug);

        const jobHash = job ? `${job.status}:${job.completedSteps}:${job.errorMessage || ''}` : 'none';
        if (jobHash !== lastJobHash) {
          lastJobHash = jobHash;
          if (job) send('job', { job });
        }

        const progressHash = progress
          ? `${progress.step}:${progress.percent}:${progress.done}:${progress.error || ''}`
          : 'none';
        if (progressHash !== lastProgressHash) {
          lastProgressHash = progressHash;
          if (progress) send('progress', progress);
        }

        // Book completed while we were polling
        const completedBook = await getBook(slug);
        if (completedBook) {
          send('book', { book: completedBook });
          send('done', {});
          break;
        }

        // Terminal states: no job, no progress, no book
        const terminal = !job && !progress;
        const jobTerminal = job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled');
        if ((terminal || jobTerminal) && !completedBook) {
          send('error', { message: 'Generation ended without producing a book.' });
          break;
        }

        await sleep(1500);
      }
    } catch (err) {
      console.warn('[books/stream] SSE loop error:', err instanceof Error ? err.message : err);
      send('error', { message: 'Stream error' });
    } finally {
      clearInterval(heartbeat);
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  request.signal.addEventListener('abort', () => {
    loop = false;
    clearInterval(heartbeat);
    try { writer.close(); } catch { /* already closed */ }
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
