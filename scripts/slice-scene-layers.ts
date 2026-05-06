// ============================================================
// scripts/slice-scene-layers.ts
//
// Per-scene layer slicer. Reads each scene PNG, asks the OpenAI
// Images API to regenerate the same scene with each named
// character isolated on a transparent background, and writes
// the cutouts to public/images/layers/{slug}/{sceneId}/.
//
// Output layout per scene:
//   public/images/layers/{slug}/{sceneId}/
//     bg.png            ← scene with all characters removed
//     {target_id}.png   ← one cutout per character hotspot
//
// SceneLayers.tsx auto-discovers these at render time via the
// `cutouts` prop wired by SceneCanvas. When a scene has no
// slices on disk, the live reader falls back to the virtual
// ellipse-clip mode (free, universal). When slices exist, the
// reader switches to "real cutouts" with proper alpha edges,
// which makes the verb-driven character motion read cleanly.
//
// Cost (OpenAI gpt-image-1):
//   ~$0.04 per character image × 35 characters ≈ $1.40 per book
//   ~$0.04 per bg plate × 12 scenes ≈ $0.48 per book
//   Total ~$2/book. One-time per scene image.
//
// Idempotent: existing files are skipped unless --force is set.
// Dry-run flag prints what would be done without API calls.
//
// Usage:
//   npm run slice:layers                     # ramayana, all scenes
//   npm run slice:layers -- --slug=ramayana
//   npm run slice:layers -- --scene=ayodhya_intro
//   npm run slice:layers -- --dry-run
//   npm run slice:layers -- --force
// ============================================================

import './_loadEnv';

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ramayanaHotspots } from '../lib/data/hotspots';
import { isOpenAIConfigured, getOpenAIClient } from '../lib/openai/openaiClient';

const PUBLIC_DIR = join(process.cwd(), 'public');
const LAYERS_DIR_BASE = join(PUBLIC_DIR, 'images', 'layers');

interface Args {
  slug: string;
  sceneFilter: string | null;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const slug = argv.find(a => a.startsWith('--slug='))?.slice('--slug='.length) ?? 'ramayana';
  const sceneFilter = argv.find(a => a.startsWith('--scene='))?.slice('--scene='.length) ?? null;
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  return { slug, sceneFilter, dryRun, force };
}

interface SliceTarget {
  sceneId: string;
  /** "bg" or character target_id. */
  layer: string;
  label: string;
  /** Character description for the prompt. */
  description: string;
}

/** Build the slicing job list from hand-authored hotspots. */
function planSlicingJobs(slug: string, sceneFilter: string | null): SliceTarget[] {
  if (slug !== 'ramayana') {
    throw new Error(`slug "${slug}" is not yet supported by the slicer (only ramayana for now)`);
  }
  // Group hotspots by scene; emit one bg job + one job per character
  // hotspot per scene. Object/place hotspots stay in the bg.
  const bySceneId: Record<string, typeof ramayanaHotspots> = {};
  for (const h of ramayanaHotspots) {
    if (sceneFilter && h.scene_id !== sceneFilter) continue;
    if (h.target_type !== 'character') continue;
    (bySceneId[h.scene_id] ??= []).push(h);
  }
  const jobs: SliceTarget[] = [];
  for (const [sceneId, characters] of Object.entries(bySceneId)) {
    const charLabels = characters.map(c => c.label).join(', ');
    jobs.push({
      sceneId,
      layer: 'bg',
      label: 'background plate',
      description: `Same scene with the characters (${charLabels}) cleanly removed and the area inpainted with what they would have been standing on/in front of (palace floor, forest ground, sky, etc.). Match the original style and lighting exactly.`,
    });
    for (const c of characters) {
      jobs.push({
        sceneId,
        layer: c.target_id,
        label: c.label,
        description: `Only the character "${c.label}" extracted from the scene "${sceneId}", isolated on a fully transparent background. PNG with alpha channel. Same pose, same outfit, same lighting as in the scene. No background, no other characters, no props they aren't holding.`,
      });
    }
  }
  return jobs;
}

async function slice(job: SliceTarget, slug: string, force: boolean, dryRun: boolean): Promise<void> {
  const outDir = join(LAYERS_DIR_BASE, slug, job.sceneId);
  const outPath = join(outDir, `${job.layer}.png`);
  if (!force && existsSync(outPath)) {
    console.log(`[slice]   ${job.sceneId}/${job.layer}: cached (${outPath})`);
    return;
  }
  if (dryRun) {
    console.log(`[slice]   ${job.sceneId}/${job.layer}: would slice "${job.label}"`);
    return;
  }

  const sourcePath = join(PUBLIC_DIR, 'images', `scene_${job.sceneId}.png`);
  if (!existsSync(sourcePath)) {
    console.log(`[slice]   ${job.sceneId}/${job.layer}: source missing (${sourcePath}) — skipping`);
    return;
  }

  const client = getOpenAIClient();
  // gpt-image-1 supports an `image` input plus a text prompt for
  // reference-conditioned generation. We use the original scene as the
  // reference and the layer description as the prompt. Output is
  // returned as a base64 PNG.
  console.log(`[slice]   ${job.sceneId}/${job.layer}: generating "${job.label}"…`);
  const sourceBytes = readFileSync(sourcePath);
  const sourceFile = await (await import('node:fs/promises')).readFile(sourcePath);
  // The OpenAI SDK accepts a File-like object for image inputs.
  const imageFile = new File([new Uint8Array(sourceFile)], `scene_${job.sceneId}.png`, { type: 'image/png' });
  void sourceBytes;

  const result = await client.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt: job.description,
    size: '1024x1024',
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    console.warn(`[slice]   ${job.sceneId}/${job.layer}: API returned no image — skipping`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
  console.log(`[slice]   ${job.sceneId}/${job.layer}: wrote ${outPath}`);
}

async function main() {
  const { slug, sceneFilter, dryRun, force } = parseArgs();
  if (!dryRun && !isOpenAIConfigured()) {
    console.error('[slice] OPENAI_API_KEY not set. Use --dry-run to preview the job list without API calls.');
    process.exit(2);
  }

  const jobs = planSlicingJobs(slug, sceneFilter);
  console.log(`[slice] ${slug}: ${jobs.length} layer(s) ${dryRun ? '(dry-run)' : ''}`);
  if (sceneFilter) console.log(`[slice] scene filter: ${sceneFilter}`);

  let done = 0;
  for (const job of jobs) {
    try {
      await slice(job, slug, force, dryRun);
      done++;
    } catch (err) {
      console.error(`[slice]   ${job.sceneId}/${job.layer}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[slice] done: ${done}/${jobs.length}`);
}

main().catch(err => {
  console.error('[slice] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
