// ============================================================
// KathaKitaab — Generation Job Registry (Redis-backed)
//
// Every generation starts as a persistent job. Jobs survive
// browser closes, lambda crashes, and page refreshes. They are
// the source of truth for "what is being generated right now."
//
// A job tracks:
//   - metadata (title, mode, user, timestamps)
//   - status (queued → planning → outline → scenes → images → tts → completed)
//   - per-step completion tracking
//   - error messages for failed steps
//   - resumeability
//
// Jobs are stored in Redis with a 7-day TTL (longer than the
// 30-minute progress entry they replace). A completed job stays
// alive so the user can see it in My Creations. Deleted jobs are
// removed from Redis and their associated scenes are cleaned up.
// ============================================================

import { getRedis } from '@/lib/redis';
// No bookGeneratorAgent imports needed — GenerationJob is self-contained.

export type GenerationMode =
  | 'world'
  | 'classroom'
  | 'personalized_text'
  | 'personalized_photo';

export type JobStatus =
  | 'queued'
  | 'planning'
  | 'outline_generated'
  | 'scenes_generating'
  | 'scenes_generated'
  | 'images_generating'
  | 'images_partial'
  | 'images_generated'
  | 'tts_generating'
  | 'tts_partial'
  | 'tts_generated'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GenerationStep =
  | 'outline'
  | 'characters'
  | 'portraits'
  | 'scene_details'
  | 'scene_images'
  | 'scene_tts'
  | 'movie'
  | 'stitch';

export interface GenerationJob {
  id: string;
  slug: string;
  userId: string | null;
  title: string;
  mode: GenerationMode;
  stylePreset?: string;
  status: JobStatus;
  currentStep: GenerationStep | null;
  totalSteps: number;
  completedSteps: number;
  failedStep?: GenerationStep;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  resumable: boolean;
  // When the job completes, this holds the finished book slug
  bookSlug?: string;
  // Optional metadata bag for mode-specific fields (grade band, etc.)
  metadata?: Record<string, unknown>;
  /** Optimistic-lock version to prevent lost updates across instances. */
  version?: number;
}

// 7 days — long enough that a generation from yesterday is still
// resumable; short enough that abandoned experiments clean up.
const JOB_TTL_SEC = 60 * 60 * 24 * 7;

const jobKey = (id: string) => `kk:job:${id}`;
const jobIndexKey = (userId: string) => `kk:jobs:user:${userId}`;
const jobSlugIndexKey = (slug: string) => `kk:job:slug:${slug}`;
const allJobsKey = () => `kk:jobs:all`;

// In-process hot cache (same-lambda reads)
const memJobs = new Map<string, GenerationJob>();
const MAX_MEM_JOBS = 500;

function capMap<K, V>(map: Map<K, V>, limit: number) {
  if (map.size <= limit) return;
  const evictCount = Math.ceil(limit * 0.2);
  let i = 0;
  for (const key of map.keys()) {
    if (i >= evictCount) break;
    map.delete(key);
    i++;
  }
}

function now() {
  return Date.now();
}

/** Distributed lock for atomic read-modify-write on a Redis key.
 *  Uses SET NX EX so even if the process crashes, the lock auto-releases.
 *  Falls back to a no-op in the in-memory path. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const r = getRedis();
  if (!r) return fn();

  const lockKey = `${key}:lock`;
  const token = `lock-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const acquired = await r.set(lockKey, token, { nx: true, ex: 5 });
    if (acquired) {
      try {
        return await fn();
      } finally {
        const current = await r.get<string>(lockKey);
        if (current === token) {
          await r.del(lockKey);
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
  }
  console.warn(`[jobRegistry] Could not acquire lock for ${key}`);
  return null;
}

/** Create a new generation job immediately when the user clicks
 *  Generate. This is the FIRST thing that happens — before any
 *  LLM calls, before any images. The job exists even if the
 *  lambda crashes 2 seconds later. */
export async function createJob(
  params: Pick<GenerationJob, 'slug' | 'userId' | 'title' | 'mode' | 'stylePreset' | 'metadata'>,
): Promise<GenerationJob> {
  const job: GenerationJob = {
    id: `job-${params.slug}-${now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...params,
    status: 'queued',
    currentStep: null,
    totalSteps: 6, // outline, portraits, scenes, images, tts, stitch
    completedSteps: 0,
    resumable: true,
    createdAt: now(),
    updatedAt: now(),
  };

  memJobs.set(job.id, job);
  capMap(memJobs, MAX_MEM_JOBS);
  const r = getRedis();
  if (r) {
    await r.set(jobKey(job.id), job, { ex: JOB_TTL_SEC });
    // Index by user for "My Creations" listing
    if (job.userId) {
      await r.sadd(jobIndexKey(job.userId), job.id);
    }
    // Global index for admin overview
    await r.sadd(allJobsKey(), job.id);
    // Index by slug so /api/books/generate can detect duplicates
    await r.set(jobSlugIndexKey(job.slug), job.id, { ex: JOB_TTL_SEC });
  }

  return job;
}

/** Update a job's status and step tracking. Called after every
 *  sub-step completes (outline done, scene N done, image N done, etc.).
 *  Uses a distributed lock to prevent lost updates across serverless instances. */
export async function updateJob(
  id: string,
  updates: Partial<Omit<GenerationJob, 'id' | 'createdAt'>>,
): Promise<GenerationJob | null> {
  return withLock(jobKey(id), async () => {
    const existing = memJobs.get(id) ?? await _fetchFromRedis(id);
    if (!existing) return null;

    const updated: GenerationJob = {
      ...existing,
      ...updates,
      updatedAt: now(),
      version: (existing.version ?? 0) + 1,
    };

    // Auto-set resumable based on status
    if (updated.status === 'failed' || updated.status === 'images_partial' || updated.status === 'tts_partial') {
      updated.resumable = true;
    } else if (updated.status === 'completed' || updated.status === 'cancelled') {
      updated.resumable = false;
    }

    memJobs.set(id, updated);
    capMap(memJobs, MAX_MEM_JOBS);
    const r = getRedis();
    if (r) {
      await r.set(jobKey(id), updated, { ex: JOB_TTL_SEC });
    }

    return updated;
  });
}

/** Mark a job as completed and link it to the finished book. */
export async function completeJob(id: string, bookSlug: string): Promise<GenerationJob | null> {
  return updateJob(id, {
    status: 'completed',
    currentStep: null,
    completedSteps: 6,
    bookSlug,
    resumable: false,
    errorMessage: undefined,
    failedStep: undefined,
  });
}

/** Mark a job as failed with the step and error that caused it. */
export async function failJob(
  id: string,
  failedStep: GenerationStep,
  errorMessage: string,
): Promise<GenerationJob | null> {
  return updateJob(id, {
    status: 'failed',
    currentStep: null,
    failedStep,
    errorMessage,
  });
}

/** Get a single job by ID. */
export async function getJob(id: string): Promise<GenerationJob | null> {
  const cached = memJobs.get(id);
  if (cached) return cached;
  return _fetchFromRedis(id);
}

/** Get a job by its book slug (used when the user polls
 *  /api/books/generate to check if their slug already has a job). */
export async function getJobBySlug(slug: string): Promise<GenerationJob | null> {
  const r = getRedis();
  if (!r) return null;
  const jobId = await r.get<string>(jobSlugIndexKey(slug));
  if (!jobId) return null;
  return getJob(jobId);
}

/** List all jobs for a user. Supports filtering by status.
 *  Stale IDs (jobs that have TTL-expired) are silently removed from the index. */
export async function listUserJobs(
  userId: string,
  statuses?: JobStatus[],
): Promise<GenerationJob[]> {
  const r = getRedis();
  if (!r) {
    // Fallback: scan in-memory cache
    const out: GenerationJob[] = [];
    for (const job of memJobs.values()) {
      if (job.userId === userId && (!statuses || statuses.includes(job.status))) {
        out.push(job);
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  const jobIds = await r.smembers(jobIndexKey(userId));
  if (!jobIds || jobIds.length === 0) return [];

  const jobs = await Promise.all(
    jobIds.map(id => getJob(id).catch(() => null)),
  );

  // Remove stale IDs from the set (jobs whose TTL expired but ID remains)
  const staleIds = jobIds.filter((_, i) => jobs[i] === null);
  if (staleIds.length > 0) {
    await r.srem(jobIndexKey(userId), ...staleIds);
  }

  return jobs
    .filter((j): j is GenerationJob => j !== null)
    .filter(j => !statuses || statuses.includes(j.status))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** List every job in the system (admin overview).
 *  Stale IDs (jobs that have TTL-expired) are silently removed from the index. */
export async function listAllJobs(): Promise<GenerationJob[]> {
  const r = getRedis();
  if (!r) {
    return Array.from(memJobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }
  const jobIds = await r.smembers(allJobsKey());
  if (!jobIds || jobIds.length === 0) return [];

  const jobs = await Promise.all(
    jobIds.map(id => getJob(id).catch(() => null)),
  );

  // Remove stale IDs from the set
  const staleIds = jobIds.filter((_, i) => jobs[i] === null);
  if (staleIds.length > 0) {
    await r.srem(allJobsKey(), ...staleIds);
  }

  return jobs
    .filter((j): j is GenerationJob => j !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete a job and its indexes. Does NOT delete the associated
 *  book — that is handled separately. */
export async function deleteJob(id: string): Promise<void> {
  const job = memJobs.get(id) ?? await _fetchFromRedis(id);
  memJobs.delete(id);

  const r = getRedis();
  if (!r) return;

  await r.del(jobKey(id));
  await r.srem(allJobsKey(), id);
  if (job?.userId) {
    await r.srem(jobIndexKey(job.userId), id);
  }
  if (job?.slug) {
    await r.del(jobSlugIndexKey(job.slug));
  }
}

/** Check if a slug already has an active (non-completed, non-cancelled) job. */
export async function hasActiveJob(slug: string): Promise<boolean> {
  const job = await getJobBySlug(slug);
  if (!job) return false;
  return job.status !== 'completed' && job.status !== 'cancelled';
}

// ---- Internal helpers ----

async function _fetchFromRedis(id: string): Promise<GenerationJob | null> {
  const r = getRedis();
  if (!r) return null;
  const job = await r.get<GenerationJob>(jobKey(id));
  if (job) {
    memJobs.set(id, job);
  }
  return job ?? null;
}
