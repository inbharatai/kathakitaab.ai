// ============================================================
// KathaKitaab — Server-side MP4 export for BookMovie
// POST /api/livebook/render-movie
//
// Body: { bookSlug }
//
// Bundles the Remotion entry, renders the BookMovie composition
// with the book's manifest as inputProps, uploads the resulting
// MP4 to Supabase Storage (`scene-images/{slug}/movie.mp4`), and
// returns the public URL.
//
// Why server-side:
//   - The Remotion live <Player> shows the book in the browser, but
//     to share or embed we need a real downloadable MP4.
//   - @remotion/renderer drives a headless Chromium and stitches
//     frames + audio with FFmpeg. Both are Node-only.
//
// Performance:
//   - 13 scenes × ~32s ≈ 7 minutes of video at 1920×1080 takes a few
//     minutes to render even on a fast machine. The route is gated
//     by maxDuration = 600s and rate-limited to expensive scope.
//   - Output is cached in Supabase by content hash so identical
//     manifests don't re-render.
//
// Required: @remotion/renderer + @remotion/bundler in deps. The
// route fails gracefully if either is missing or if the local OS
// cannot run the bundled Chromium (e.g. constrained CI sandboxes).
// ============================================================

import { NextResponse, after } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'crypto';

import { getSupabaseService } from '@/lib/supabase';
import { getManifestForSlugAsync } from '@/lib/video/manifestRegistry';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { analyzeImageForTargets } from '@/lib/agents/visionAgent';
import { getBook } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { resolveBookVisibility } from '@/lib/auth/bookAccess';
import { isSafeUrl } from '@/lib/safety/urlValidation';

// 10 minutes — Remotion render of a 7-minute movie typically takes
// 2-4 minutes depending on hardware. This caps it so a runaway
// render can't hold the function instance forever.
export const maxDuration = 600;

const BUCKET = 'scene-images';

interface RenderRequest {
  bookSlug: string;
  /** Force re-render even if a cached MP4 with the same manifest
   *  hash already exists. Useful when the composition itself changed. */
  force?: boolean;
  /** Which composition to render. 'movie' = full BookMovie (default).
   *  'trailer' = the cinematic teaser cut (BookTrailer). Both write
   *  to the same `public/movies/` folder under different basenames
   *  so they cache independently. */
  mode?: 'movie' | 'trailer';
}

/** Returns true when this process is explicitly authorized to run
 *  @remotion/renderer. Headless Chromium + FFmpeg are required, and
 *  Vercel's standard serverless functions don't ship Chromium —
 *  trying anyway results in a Lambda timeout and an ugly stack trace.
 *
 *  Default is HARD-DISABLED. Operators on a Chromium-bearing host
 *  (Render / Railway / Fly / their own laptop) explicitly opt in via
 *  KATHA_MP4_EXPORT_ENABLED=1. The CLI path (scripts/render-movie.ts)
 *  is completely separate — it runs `npx remotion render` directly
 *  and isn't gated by this route.
 */
function canRenderMp4(): boolean {
  return process.env.KATHA_MP4_EXPORT_ENABLED === '1';
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  // Gate before doing any work. Vercel deploys hit this path 100% of
  // the time; bailing here saves a rate-limit slot on the next user.
  if (!canRenderMp4()) {
    return NextResponse.json({
      error: 'Downloadable MP4 export is not available in this environment.',
      detail: 'The cinematic cut plays in your browser at full quality. Hosted MP4 export is coming soon — see PERSONALIZED_STORY_PLAN.md / project roadmap.',
    }, { status: 501 });
  }

  let body: RenderRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { bookSlug, force = false, mode = 'movie' } = body;
  if (!bookSlug) {
    return NextResponse.json({ error: 'bookSlug is required' }, { status: 400 });
  }
  // Path-traversal guard: slugs are always URL-safe lowercase alphanumerics
  // with hyphens. Reject anything else before it touches the filesystem.
  if (!/^[a-z0-9-]+$/.test(bookSlug)) {
    return NextResponse.json({ error: 'Invalid bookSlug format' }, { status: 400 });
  }
  if (mode !== 'movie' && mode !== 'trailer') {
    return NextResponse.json({ error: `mode must be 'movie' or 'trailer', got '${mode}'` }, { status: 400 });
  }

  // Visibility check: private books can only be rendered by owner or admin.
  const book = await getBook(bookSlug);
  if (book && resolveBookVisibility(book) === 'private') {
    const ownerId = getOwnerIdFromRequest(request);
    const session = await getSessionFromRouteRequest(request);
    const isAdmin = isAdminSession(session);
    const callerId = session?.userId ?? ownerId;
    if (!isAdmin && book.ownerId !== callerId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
  }

  const manifest = await getManifestForSlugAsync(bookSlug);
  if (!manifest) {
    return NextResponse.json({ error: `No manifest for book "${bookSlug}"` }, { status: 404 });
  }

  // Vision QA pass — non-blocking safety net. For each scene image,
  // ask gpt-4o-vision whether the scene's named characters actually
  // appear. Character consistency is supposed to be guaranteed by
  // the anchor-portrait + canon-appearance system at image generation
  // time; this is the belt-and-suspenders check that catches drift
  // before / while we render the MP4.
  //
  // Wrapped in after() so the lambda keeps it alive even when the
  // render path is a cache hit and returns instantly — a plain
  // `void runVisionQA()` would be killed when the response flushes.
  // Cost: ~$0.05 for a 12-scene book.
  after(async () => {
    try {
      await runVisionQA(bookSlug, manifest);
    } catch (err) {
      console.warn('[render-movie] vision QA pass failed:',
        err instanceof Error ? err.message : err);
    }
  });

  // Cache key includes mode so movie + trailer don't collide.
  const manifestHash = hashManifest({ manifest, mode });
  const compositionId = mode === 'trailer' ? 'BookTrailer' : 'BookMovie';
  const filenameStem = mode === 'trailer' ? 'trailer' : 'movie';
  const objectPath = `${bookSlug}/${filenameStem}.${manifestHash}.mp4`;

  const supabase = getSupabaseService();

  // Cached path — if the same manifest already produced an MP4,
  // skip the multi-minute render and return the cached URL.
  if (!force) {
    if (supabase) {
      const cached = await getPublicUrlIfExists(supabase, BUCKET, objectPath);
      if (cached) {
        return NextResponse.json({ url: cached, cached: true, manifestHash, mode, storageMode: 'supabase' });
      }
    }
    // Local fallback dedup — if a previous run wrote a matching MP4
    // under public/movies, serve that instead of re-rendering. Hash
    // collision is effectively impossible for SHA1 over the manifest.
    const localName = `${bookSlug}.${filenameStem}.${manifestHash}.mp4`;
    const localPath = path.join(process.cwd(), 'public', 'movies', localName);
    try {
      await fs.access(localPath);
      return NextResponse.json({
        url: `/movies/${localName}`,
        cached: true,
        manifestHash,
        mode,
        storageMode: 'local',
      });
    } catch { /* not cached locally — proceed to render */ }
  }

  // Lazily import the renderer so a missing dependency doesn't crash
  // the whole route module at import time. This lets the route exist
  // even on hosts where Chromium can't run, surfacing a clean 503
  // instead of a build-time failure.
  let bundle: typeof import('@remotion/bundler')['bundle'];
  let renderMedia: typeof import('@remotion/renderer')['renderMedia'];
  let selectComposition: typeof import('@remotion/renderer')['selectComposition'];
  try {
    ({ bundle } = await import('@remotion/bundler'));
    ({ renderMedia, selectComposition } = await import('@remotion/renderer'));
  } catch (err) {
    return NextResponse.json({
      error: 'Server-side rendering is not available on this host',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 503 });
  }

  let outFile: string | null = null;
  let tmpDir: string | null = null;
  try {
    const entry = path.join(process.cwd(), 'remotion', 'index.ts');
    // 9-minute soft cap on the bundle+render — gives us a margin under
    // the 10-minute Vercel function ceiling so a hung render returns
    // a clean error instead of a forced kill.
    const RENDER_BUDGET_MS = 9 * 60 * 1000;
    const bundled = await withTimeout(
      bundle({ entryPoint: entry }),
      RENDER_BUDGET_MS,
      'Remotion bundle timed out',
    );

    const composition = await selectComposition({
      serveUrl: bundled,
      id: compositionId,
      inputProps: { manifest },
    });

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `kk-${filenameStem}-`));
    outFile = path.join(tmpDir, `${bookSlug}.${filenameStem}.mp4`);

    await withTimeout(
      renderMedia({
        composition,
        serveUrl: bundled,
        codec: 'h264',
        outputLocation: outFile,
        inputProps: { manifest },
        // 540p (scale 0.5) keeps render time manageable for share embeds.
        // The composition's native size is 1920×1080, so 0.5 gives integer
        // dimensions (960×540) — fractional scales like 0.667 break the
        // FFmpeg stitch step. Bump to 1.0 for archival quality at 1080p.
        scale: 0.5,
        // Constant Rate Factor for H.264. Default 18 produces archival
        // quality at large file sizes (~250MB for a 7-min 1080p movie);
        // 28 cuts that to <50MB which fits Supabase free-tier object
        // limits while staying perceptually close to the original. This
        // is a share preview — visual fidelity > file precision.
        crf: 28,
        audioBitrate: '96k',
      }),
      RENDER_BUDGET_MS,
      'Remotion render timed out',
    );

    const bytes = await fs.readFile(outFile);

    // Storage strategy:
    //   1. Try Supabase first — that gives us a CDN URL anyone can hit.
    //   2. If Supabase rejects (size limit, no creds, network), fall
    //      back to /public/movies/{hash}.mp4 so the file is still
    //      reachable from the same origin. The local fallback keeps
    //      `npm run dev` working end-to-end without infra changes.
    let publicUrl: string | null = null;
    let storageMode: 'supabase' | 'local' = 'supabase';

    if (supabase) {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, bytes, {
          contentType: 'video/mp4',
          upsert: true,
          cacheControl: 'public, max-age=31536000, immutable',
        });
      if (!error) {
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
        publicUrl = data.publicUrl;
      } else {
        console.warn('[render-movie] Supabase upload failed, falling back to local:', error.message);
      }
    }

    if (!publicUrl) {
      const moviesDir = path.join(process.cwd(), 'public', 'movies');
      await fs.mkdir(moviesDir, { recursive: true });
      const localName = `${bookSlug}.${filenameStem}.${manifestHash}.mp4`;
      await fs.writeFile(path.join(moviesDir, localName), bytes);
      publicUrl = `/movies/${localName}`;
      storageMode = 'local';
    }

    return NextResponse.json({
      url: publicUrl,
      cached: false,
      sizeBytes: bytes.length,
      durationFrames: composition.durationInFrames,
      manifestHash,
      mode,
      storageMode,
    });
  } catch (err) {
    console.error('[render-movie]', err instanceof Error ? err.message : err);
    return NextResponse.json({
      error: 'Render failed. Please try again or contact support if the issue persists.',
    }, { status: 500 });
  } finally {
    // Best-effort cleanup of the tmp DIRECTORY (not just the file).
    // Earlier versions only unlinked outFile, leaving an empty
    // kk-{stem}-XXXX/ behind on every render — guaranteed leak on a
    // long-running dev server.
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Helpers ──────────────────────────────────────────────────

function hashManifest(manifest: unknown): string {
  return createHash('sha1').update(JSON.stringify(manifest)).digest('hex').slice(0, 12);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} (${Math.round(ms / 1000)}s)`)), ms),
    ),
  ]);
}

/**
 * Vision QA pre-render pass. For each scene's image, ask gpt-4o
 * vision whether the named characters are actually visible. Logs
 * warnings for any expected character that wasn't found — gives the
 * operator a heads-up that anchor-locking missed a beat. NOT a
 * blocker: the render proceeds regardless. Fire-and-forget from the
 * caller; failures are logged and swallowed.
 *
 * Cost: ~$0.005-0.01 per scene at gpt-4o high-detail. For a typical
 * 10-scene book that's $0.05-0.10 per movie render. Skipped silently
 * when the book record carries no `characters[]` list — for those
 * the QA pass has nothing to verify against.
 */
async function runVisionQA(
  bookSlug: string,
  manifest: { scenes: Array<{ sceneId?: string; title?: string; imagePath?: string }> },
): Promise<void> {
  const book = await getBook(bookSlug);
  if (!book?.characters?.length) return;

  // Run per-scene probes in parallel with a small concurrency cap.
  // Serial 12 × ~5s = 60s — right at Vercel's after() budget on Pro.
  // Concurrency 4 brings a 12-scene book in under 20s with headroom
  // for retries / cold starts; small enough not to thunder the
  // OpenAI rate limit.
  const QA_CONCURRENCY = 4;
  const jobs = manifest.scenes
    .map(mScene => ({ mScene, sceneId: mScene.sceneId }))
    .filter(j => !!j.sceneId);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(QA_CONCURRENCY, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const i = cursor++;
      const { mScene, sceneId } = jobs[i];
      const bScene = book.scenes.find(s => s.scene_id === sceneId);
      if (!bScene) continue;

      const expectedCharacters = (bScene.hotspots ?? [])
        .filter(h => h.hotspot_type === 'character')
        .map(h => h.label);
      if (expectedCharacters.length === 0) continue;

      const imageUrl = mScene.imagePath;
      if (!imageUrl) continue;

      const fullUrl = imageUrl.startsWith('http')
        ? imageUrl
        : `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:5009'}${imageUrl}`;
      if (!isSafeUrl(fullUrl)) {
        console.warn(`[vision-qa] Skipped unsafe URL: ${fullUrl}`);
        continue;
      }

      try {
        const imageRes = await fetch(fullUrl);
        if (!imageRes.ok) continue;
        const buf = Buffer.from(await imageRes.arrayBuffer());
        const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
        const found = await analyzeImageForTargets(dataUri, expectedCharacters);
        const missing = found.filter(r => !r.found).map(r => r.label);
        if (missing.length > 0) {
          console.warn(
            `[vision-qa] ${bookSlug}/${sceneId}: expected ` +
            `${expectedCharacters.join(', ')} — missing: ${missing.join(', ')}`,
          );
        }
      } catch (err) {
        console.warn(`[vision-qa] ${bookSlug}/${sceneId} probe failed:`,
          err instanceof Error ? err.message : err);
      }
    }
  });
  await Promise.all(workers);
}


async function getPublicUrlIfExists(
  supabase: NonNullable<ReturnType<typeof getSupabaseService>>,
  bucket: string,
  objectPath: string,
): Promise<string | null> {
  // Supabase Storage doesn't have a cheap "exists" check; we list the
  // parent directory with a name filter, which is one round-trip.
  const dir = path.posix.dirname(objectPath);
  const file = path.posix.basename(objectPath);
  const { data, error } = await supabase.storage.from(bucket).list(dir, {
    search: file,
    limit: 1,
  });
  if (error || !data || data.length === 0) return null;
  const exact = data.find(d => d.name === file);
  if (!exact) return null;
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return pub.publicUrl;
}
