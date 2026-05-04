// ============================================================
// KathaKitaab.ai — Branch Image Job Tracker
//
// Tracks pending background image generations for branches so the
// /branch-image polling endpoint can answer "is it ready yet?".
//
// In-memory only. Works for dev (single Node process) and any
// long-running server. For multi-instance prod, swap for Redis
// or a real queue (BullMQ, etc.).
// ============================================================

type JobStatus =
  | { state: 'pending'; startedAt: number }
  | { state: 'ready'; imageUrl: string; finishedAt: number }
  | { state: 'failed'; error: string; finishedAt: number };

const jobs = new Map<string, JobStatus>();
const TTL_MS = 10 * 60_000; // forget jobs after 10 min

export function startBranchImageJob(
  branchId: string,
  generator: () => Promise<{ imageUrl?: string | null }>,
): void {
  jobs.set(branchId, { state: 'pending', startedAt: Date.now() });

  // Fire-and-forget. Works as long as the Node process stays alive
  // until the promise settles (true in `next dev` and self-hosted prod).
  generator()
    .then(result => {
      if (result.imageUrl) {
        jobs.set(branchId, { state: 'ready', imageUrl: result.imageUrl, finishedAt: Date.now() });
      } else {
        jobs.set(branchId, { state: 'failed', error: 'no image returned', finishedAt: Date.now() });
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'image generation failed';
      jobs.set(branchId, { state: 'failed', error: msg, finishedAt: Date.now() });
    })
    .finally(() => sweepStale());
}

export function getBranchImageJob(branchId: string): JobStatus | null {
  return jobs.get(branchId) ?? null;
}

function sweepStale() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    const ts = job.state === 'pending' ? job.startedAt : job.finishedAt;
    if (ts < cutoff) jobs.delete(id);
  }
}
