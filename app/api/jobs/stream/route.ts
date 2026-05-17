import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { listUserJobs, type GenerationJob } from '@/lib/data/jobRegistry';

/** SSE stream of generation jobs for the current user.
 *
 *  Opens a long-lived HTTP connection and pushes job updates
 *  every 1.5 seconds. Closes when all jobs are terminal
 *  (completed/failed/cancelled) or the client disconnects.
 *
 *  This replaces the 5-second polling from /api/jobs with a
 *  single persistent connection — lower latency, fewer requests,
 *  and ready for push notifications in the future.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const session = await getSessionFromRouteRequest(request);
  const ownerId = getOwnerIdFromRequest(request);
  const userId = session?.userId ?? ownerId;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = (event: string, data: unknown) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  // Heartbeat to keep the connection alive through proxies.
  const heartbeat = setInterval(() => {
    writer.write(encoder.encode(':heartbeat\n\n')).catch(() => {});
  }, 15000);

  // Poll Redis every 1.5s and push updates when state changes.
  // Vercel serverless can't do true pub/sub across lambdas, so
  // we use a tight polling loop inside the SSE stream. This still
  // beats client polling because it's one HTTP connection, the
  // server sleeps between checks, and latency drops from 5s to 1.5s.
  let lastHash = '';
  let loop = true;

  (async () => {
    try {
      // Initial state
      const jobs = userId ? await listUserJobs(userId) : [];
      lastHash = hashJobs(jobs);
      send('jobs', { jobs });

      while (loop) {
        await sleep(1500);
        if (!loop) break;

        const jobs = userId ? await listUserJobs(userId) : [];
        const hash = hashJobs(jobs);
        if (hash !== lastHash) {
          lastHash = hash;
          send('jobs', { jobs });
        }

        // Auto-close when all jobs are terminal.
        const allTerminal = jobs.every(j =>
          j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled',
        );
        if (allTerminal && jobs.length > 0) {
          send('done', {});
          break;
        }
      }
    } catch (err) {
      console.warn('[jobs/stream] SSE loop error:', err instanceof Error ? err.message : err);
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

function hashJobs(jobs: GenerationJob[]): string {
  return jobs
    .map(j => `${j.id}:${j.status}:${j.completedSteps}:${j.errorMessage || ''}`)
    .join('|');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
