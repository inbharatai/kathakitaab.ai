// ============================================================
// KathaKitaab — Server-side MP4 export for BookMovie
// POST /api/livebook/render-movie
//
// Body: { bookSlug }
//
// Bundles the Remotion entry, renders the BookMovie composition
// with the book's manifest as inputProps, uploads the resulting
// MP4 to S3 (`{slug}/movie.{hash}.mp4`, served via CloudFront), and
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
//   - Output is cached in S3 by content hash so identical manifests
//     don't re-render.
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

import { getManifestForSlugAsync } from '@/lib/video/manifestRegistry';
import { synthesizeWorldManifest } from '@/lib/world/worldManifest';
import type { WorldManifest, WorldNode } from '@/lib/world/worldManifest';
// Type-only import — the WorldFlythrough composition module pulls in
// Remotion + R3F client code we must NOT execute in a server route. The
// manifest types are pure interfaces, safe to import as types.
import type { WorldFlythroughManifest, FlythroughNode } from '@/remotion/WorldFlythrough';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { analyzeImageForTargets } from '@/lib/agents/visionAgent';
import { getBook } from '@/lib/data/bookRegistry';
import { getOwnerIdFromRequest } from '@/lib/auth/ownerId';
import { getSessionFromRouteRequest } from '@/lib/auth/session';
import { isAdminSession } from '@/lib/auth/adminAllowlist';
import { resolveBookVisibility } from '@/lib/auth/bookAccess';
import { isSafeUrl } from '@/lib/safety/urlValidation';
import { putObject, objectExists, publicUrlFor, isS3Configured } from '@/lib/storage/s3Storage';

// 10 minutes — Remotion render of a 7-minute movie typically takes
// 2-4 minutes depending on hardware. This caps it so a runaway
// render can't hold the function instance forever.
export const maxDuration = 600;

interface RenderRequest {
  bookSlug: string;
  /** Force re-render even if a cached MP4 with the same manifest
   *  hash already exists. Useful when the composition itself changed. */
  force?: boolean;
  /** Which composition to render. 'movie' = full BookMovie (default).
   *  'trailer' = the cinematic teaser cut (BookTrailer). 'flythrough' =
   *  the World flythrough — a camera glide across the explorable planet
   *  (WorldFlythrough), built from the book's WorldManifest, not a
   *  scene manifest. All three write under different basenames so they
   *  cache independently. */
  mode?: 'movie' | 'trailer' | 'flythrough';
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

/** Render-quality env knobs (shared contract with scripts/render-movie.ts).
 *
 *  KATHA_RENDER_SCALE — output resolution multiplier. The composition's
 *  native size is 1920×1080; 0.5 → 960×540 (default, share-grade), 1.0 →
 *  1080p (archival), 2.0 → 4K. Only {0.5,1.0,2.0} are accepted —
 *  fractional scales like 0.667 break FFmpeg's integer-ratio stitch step.
 *  Any other value falls back to the default (0.5).
 *
 *  KATHA_RENDER_CRF — H.264 Constant Rate Factor. 18 = visually lossless
 *  (large), 28 = default share-grade, 32 = small. Clamped to [18,32].
 *
 *  Defaults keep the 540p / CRF-28 behaviour the route has always shipped
 *  unless an operator opts into higher quality.
 */
const ALLOWED_SCALES = new Set([0.5, 1.0, 2.0]);
const DEFAULT_SCALE = 0.5;
const DEFAULT_CRF = 28;

function readRenderScale(): number {
  const raw = process.env.KATHA_RENDER_SCALE;
  if (raw === undefined || raw === '') return DEFAULT_SCALE;
  const val = Number(raw);
  return ALLOWED_SCALES.has(val) ? val : DEFAULT_SCALE;
}

function readRenderCrf(): number {
  const raw = process.env.KATHA_RENDER_CRF;
  if (raw === undefined || raw === '') return DEFAULT_CRF;
  const val = Math.round(Number(raw));
  if (!Number.isFinite(val)) return DEFAULT_CRF;
  return Math.max(18, Math.min(32, val));
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
  if (mode !== 'movie' && mode !== 'trailer' && mode !== 'flythrough') {
    return NextResponse.json({ error: `mode must be 'movie', 'trailer', or 'flythrough', got '${mode}'` }, { status: 400 });
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

  // ── Manifest load ──────────────────────────────────────────────
  // movie/trailer use the scene manifest from the video registry.
  // flythrough is a DIFFERENT composition (WorldFlythrough) driven by
  // the book's WorldManifest — not a scene manifest — so it skips the
  // registry lookup AND the per-image vision-QA pass (which only makes
  // sense against scene images). The flythrough manifest is synthesized
  // from the book's scenes + worldIdentity (universal lexicon, no key),
  // preferring a pre-built JSON if scripts/build-world-flythrough.ts
  // already wrote one (which may carry pre-rendered TTS narration audio).
  const renderScale = readRenderScale();

  let compositionId: string;
  let filenameStem: string;
  // `inputProps` is what Remotion receives — { manifest } for all three
  // modes, but the manifest object differs (BookMovieManifest vs
  // WorldFlythroughManifest). Typed loosely here; selectComposition +
  // the composition's calculateMetadata interpret it.
  let inputProps: { manifest: unknown };
  let manifestHashInput: unknown;

  if (mode === 'flythrough') {
    const fly = await loadOrBuildFlythroughManifest(bookSlug, book);
    if (!fly) {
      return NextResponse.json(
        { error: `No flythrough manifest for book "${bookSlug}" (book not found in registry — pre-build via scripts/build-world-flythrough.ts for seed books)` },
        { status: 404 },
      );
    }
    compositionId = 'WorldFlythrough';
    filenameStem = 'flythrough';
    inputProps = { manifest: fly };
    manifestHashInput = { flythrough: fly, scale: renderScale };
  } else {
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
    // Cost: ~$0.05 for a 12-scene book. Skipped for flythrough (no
    // scene images in that composition).
    after(async () => {
      try {
        await runVisionQA(bookSlug, manifest);
      } catch (err) {
        console.warn('[render-movie] vision QA pass failed:',
          err instanceof Error ? err.message : err);
      }
    });

    compositionId = mode === 'trailer' ? 'BookTrailer' : 'BookMovie';
    filenameStem = mode === 'trailer' ? 'trailer' : 'movie';
    inputProps = { manifest };
    manifestHashInput = { manifest, mode, scale: renderScale };
  }

  // Cache key includes mode + render scale so movie/trailer/flythrough
  // and different resolutions don't collide in the S3/local cache.
  const manifestHash = hashManifest(manifestHashInput);
  const objectPath = `${bookSlug}/${filenameStem}.${manifestHash}.mp4`;

  // Cached path — if the same manifest already produced an MP4,
  // skip the multi-minute render and return the cached URL.
  if (!force) {
    if (isS3Configured() && await objectExists(objectPath)) {
      return NextResponse.json({ url: publicUrlFor(objectPath), cached: true, manifestHash, mode, storageMode: 's3' });
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
      inputProps,
    });

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `kk-${filenameStem}-`));
    outFile = path.join(tmpDir, `${bookSlug}.${filenameStem}.mp4`);

    await withTimeout(
      renderMedia({
        composition,
        serveUrl: bundled,
        codec: 'h264',
        outputLocation: outFile,
        inputProps,
        // Resolution multiplier — env-gated via KATHA_RENDER_SCALE.
        // Default 0.5 = 540p (share-grade). 1.0 = 1080p, 2.0 = 4K.
        scale: readRenderScale(),
        // CRF — env-gated via KATHA_RENDER_CRF. Default 28 = share-grade,
        // 18 = archival. See readRenderCrf() for the clamp range.
        crf: readRenderCrf(),
        audioBitrate: '96k',
      }),
      RENDER_BUDGET_MS,
      'Remotion render timed out',
    );

    const bytes = await fs.readFile(outFile);

    // Storage strategy:
    //   1. Try S3 first — that gives us a CloudFront URL anyone can hit.
    //   2. If S3 rejects (no creds, network, size), fall back to
    //      /public/movies/{hash}.mp4 so the file is still reachable
    //      from the same origin. The local fallback keeps `npm run
    //      dev` working end-to-end without infra changes.
    let publicUrl: string | null = null;
    let storageMode: 's3' | 'local' = 's3';

    const uploaded = await putObject(objectPath, bytes, 'video/mp4');
    if (uploaded) {
      publicUrl = uploaded.url;
    } else {
      console.warn('[render-movie] S3 upload unavailable/failed, falling back to local.');
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

/** Load (or synthesize) a WorldFlythroughManifest for the flythrough mode.
 *
 *  1. Prefer a pre-built JSON at `remotion/manifests/world-{slug}.json`
 *     — written by `scripts/build-world-flythrough.ts`, which may also
 *     pre-render TTS narration audio per node. This is the only path
 *     that carries narration audio; the on-the-fly synthesis is text-only.
 *  2. Otherwise synthesize a text-only flythrough manifest from the
 *     book's scenes + characters + worldIdentity (universal lexicon,
 *     no key needed). Per-node narration = the scene's deliver_fragment
 *     mission text, falling back to its title.
 *
 *  Returns null when the book isn't in the registry (seed books like
 *  Ramayana aren't — those must be pre-built via the build script, which
 *  fetches through /api/books/{slug} where seeds resolve). This keeps the
 *  route honest: it never fabricates scenes for a book it can't load. */
async function loadOrBuildFlythroughManifest(
  bookSlug: string,
  book: Awaited<ReturnType<typeof getBook>>,
): Promise<WorldFlythroughManifest | null> {
  // (1) Pre-built JSON.
  const prebuilt = path.join(process.cwd(), 'remotion', 'manifests', `world-${bookSlug}.json`);
  try {
    const raw = await fs.readFile(prebuilt, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WorldFlythroughManifest>;
    if (parsed && Array.isArray(parsed.nodes) && parsed.world && Array.isArray((parsed.world as WorldManifest).nodes)) {
      return parsed as WorldFlythroughManifest;
    }
  } catch { /* not pre-built — fall through to synthesis */ }

  // (2) On-the-fly synthesis — requires the registry book (has scenes,
  // characters, worldIdentity). Seed books return null from getBook.
  if (!book) return null;

  const world: WorldManifest = synthesizeWorldManifest(
    book as unknown as Parameters<typeof synthesizeWorldManifest>[0],
    book.scenes as unknown as Parameters<typeof synthesizeWorldManifest>[1],
    book.characters as unknown as Parameters<typeof synthesizeWorldManifest>[2],
    undefined,
    book.worldIdentity ?? null,
  );

  const nodes: FlythroughNode[] = world.nodes.map((n: WorldNode): FlythroughNode => {
    const scene = book.scenes.find(s => s.scene_id === n.id);
    const narration = scene?.short_summary || scene?.narration || narrationForWorldNode(n);
    return {
      nodeId: n.id,
      narration,
      narrationAudioUrl: null, // text-only on the fly; pre-built carries audio
      durationInFrames: framesForNarration(narration),
      mood: n.mood,
    };
  });

  return {
    bookSlug: book.slug,
    bookTitle: book.title,
    nodes,
    world,
  };
}

/** Narration text for a world node — the deliver_fragment mission's
 *  fragmentText, or the node's title. Mirrors scripts/build-world-flythrough.ts. */
function narrationForWorldNode(node: WorldNode): string {
  const frag = node.missions.find(m => m.kind === 'deliver_fragment');
  // fragmentText may be absent on synthesized nodes; title is the safe floor.
  return (frag as { fragmentText?: string } | undefined)?.fragmentText ?? node.title;
}

/** Duration in frames for a narration string — ~1 frame per 30 chars at
 *  30fps, clamped to [60, 240], 90 when empty. Mirrors
 *  scripts/build-world-flythrough.ts:framesForNode so the route-built and
 *  script-built manifests match. */
function framesForNarration(narration: string): number {
  if (!narration) return 90;
  const est = Math.ceil(narration.length / 30) * 10;
  return Math.max(60, Math.min(240, est));
}

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
