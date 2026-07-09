// ============================================================
// scripts/render-movie.ts
//
// CLI entrypoint for the same Remotion bundle + render flow that
// `/api/livebook/render-movie` runs. Skips the HTTP layer so the
// long render (5-10 min) can be triggered without a running dev
// server, and so CI / a release script can rebuild MP4s from the
// committed manifest.
//
// Usage:
//   npm run movie:render                 # both, ramayana
//   npm run movie:render -- --mode=trailer
//   npm run movie:render -- --slug=ramayana --mode=movie
//
// Output: public/movies/{slug}.{stem}.{hash}.mp4 — same naming and
// hash strategy as the route, so the route's local-cache check
// finds these and serves them directly without re-rendering.
// ============================================================

import './_loadEnv';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'crypto';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { getManifestForSlug } from '../lib/video/manifestRegistry';

interface Args {
  slug: string;
  modes: Array<'movie' | 'trailer'>;
  force: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const slug = (argv.find(a => a.startsWith('--slug='))?.slice('--slug='.length)) || 'ramayana';
  const modeArg = argv.find(a => a.startsWith('--mode='))?.slice('--mode='.length);
  const force = argv.includes('--force');
  let modes: Array<'movie' | 'trailer'>;
  if (modeArg === 'movie') modes = ['movie'];
  else if (modeArg === 'trailer') modes = ['trailer'];
  else modes = ['trailer', 'movie']; // default: both, trailer first (smaller, validates pipeline fast)
  return { slug, modes, force };
}

// Render-quality env knobs — byte-identical contract with the API route
// (app/api/livebook/render-movie/route.ts). Kept duplicated rather than
// shared to avoid the CLI pulling in the Next.js route module graph.
//   KATHA_RENDER_SCALE : {0.5,1.0,2.0}, default 0.5 (540p)
//   KATHA_RENDER_CRF   : integer 18..32, default 28
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

function hashManifest(manifest: unknown, mode: string, scale: number): string {
  return createHash('sha1').update(JSON.stringify({ manifest, mode, scale })).digest('hex').slice(0, 12);
}

async function renderOne(slug: string, mode: 'movie' | 'trailer', force: boolean): Promise<void> {
  const manifest = getManifestForSlug(slug);
  if (!manifest) throw new Error(`No manifest for slug "${slug}"`);

  const manifestHash = hashManifest(manifest, mode, readRenderScale());
  const compositionId = mode === 'trailer' ? 'BookTrailer' : 'BookMovie';
  const filenameStem = mode === 'trailer' ? 'trailer' : 'movie';
  const localName = `${slug}.${filenameStem}.${manifestHash}.mp4`;
  const moviesDir = path.join(process.cwd(), 'public', 'movies');
  const localPath = path.join(moviesDir, localName);

  if (!force) {
    try {
      await fs.access(localPath);
      console.log(`[render-movie] cached: ${localPath} (use --force to re-render)`);
      return;
    } catch { /* not cached */ }
  }

  console.log(`[render-movie] ${slug}/${mode} → ${localName}`);
  const startedAt = Date.now();

  const entry = path.join(process.cwd(), 'remotion', 'index.ts');
  const bundled = await bundle({ entryPoint: entry });

  const composition = await selectComposition({
    serveUrl: bundled,
    id: compositionId,
    inputProps: { manifest },
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `kk-${filenameStem}-`));
  const outFile = path.join(tmpDir, `${slug}.${filenameStem}.mp4`);

  try {
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: 'h264',
      outputLocation: outFile,
      inputProps: { manifest },
      // Mirror the route's settings so this CLI produces byte-identical
      // output (modulo timestamps) to the API path. Scale + CRF are
      // env-gated (KATHA_RENDER_SCALE / KATHA_RENDER_CRF) — defaults
      // 540p / CRF 28 / 96k audio = share-grade fidelity at <50MB.
      scale: readRenderScale(),
      crf: readRenderCrf(),
      audioBitrate: '96k',
      onProgress: ({ progress }) => {
        // Single-line, not noisy — log every ~10% so a tail makes sense.
        const pct = Math.floor(progress * 100);
        if (pct % 10 === 0 && pct > 0) {
          process.stdout.write(`\r[render-movie]   ${slug}/${mode}: ${pct}% `);
        }
      },
    });
    process.stdout.write('\n');

    await fs.mkdir(moviesDir, { recursive: true });
    await fs.copyFile(outFile, localPath);
    const stat = await fs.stat(localPath);
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[render-movie] ${slug}/${mode} → ${localPath}  (${(stat.size / 1024 / 1024).toFixed(2)} MB, ${elapsedSec}s)`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const { slug, modes, force } = parseArgs();
  for (const mode of modes) {
    await renderOne(slug, mode, force);
  }
}

main().catch(err => {
  console.error('[render-movie] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
