// ============================================================
// KathaKitaab — Branch Image Job Tracker
//
// Tracks pending background image generations for branches so the
// /branch-image polling endpoint can answer "is it ready yet?".
//
// Two backing stores, picked at runtime:
//   - Upstash Redis (when configured) — required for Vercel and any
//     multi-instance deploy: a poll request can land on a different
//     function instance than the one that started the job, so the
//     state has to live outside any single Node process.
//   - In-memory Map (fallback) — used when no Upstash credentials
//     are present, e.g. during local dev or single-container hosts
//     like Render where one process serves every request.
//
// 10-minute TTL on every entry. Branches are short-lived; if the
// client hasn't polled the result within ten minutes, it's stale
// and we'd re-queue from a fresh interaction anyway.
// ============================================================

import { getRedis } from '@/lib/redis';

type JobStatus =
  | { state: 'pending'; startedAt: number }
  | { state: 'ready'; imageUrl: string; finishedAt: number }
  | { state: 'failed'; error: string; finishedAt: number };

const TTL_SEC = 10 * 60;
const TTL_MS = TTL_SEC * 1000;

// In-memory fallback only.
const localJobs = new Map<string, JobStatus>();

function key(branchId: string): string {
  return `kk:branch-image:${branchId}`;
}

export async function startBranchImageJob(
  branchId: string,
  generator: () => Promise<{ imageUrl?: string | null }>,
): Promise<void> {
  // Returns a Promise that settles only when the image gen + final
  // status write are both done. The caller wraps this in `after()`
  // from `next/server` so Vercel's waitUntil extends the function's
  // lifetime until we resolve. If we returned synchronously here,
  // Vercel would terminate the function the moment the HTTP response
  // was sent and the generator() promise would get orphaned —
  // exactly the bug that left jobs stuck "pending" forever.

  const initial: JobStatus = { state: 'pending', startedAt: Date.now() };
  await writeJob(branchId, initial);

  try {
    const result = await generator();
    if (result.imageUrl) {
      await writeJob(branchId, { state: 'ready', imageUrl: result.imageUrl, finishedAt: Date.now() });
    } else {
      await writeJob(branchId, { state: 'failed', error: 'no image returned', finishedAt: Date.now() });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'image generation failed';
    await writeJob(branchId, { state: 'failed', error: msg, finishedAt: Date.now() });
  } finally {
    sweepStale();
  }
}

export async function getBranchImageJob(branchId: string): Promise<JobStatus | null> {
  const redis = getRedis();
  if (redis) {
    const raw = await redis.get<JobStatus>(key(branchId));
    return raw ?? null;
  }
  return localJobs.get(branchId) ?? null;
}

async function writeJob(branchId: string, status: JobStatus): Promise<void> {
  const redis = getRedis();
  if (redis) {
    // EX = TTL in seconds. Redis handles eviction; no sweep needed.
    await redis.set(key(branchId), status, { ex: TTL_SEC });
    return;
  }
  localJobs.set(branchId, status);
}

function sweepStale() {
  // Only relevant for the in-memory fallback. Redis evicts on its own.
  if (getRedis()) return;
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of localJobs) {
    const ts = job.state === 'pending' ? job.startedAt : job.finishedAt;
    if (ts < cutoff) localJobs.delete(id);
  }
}
