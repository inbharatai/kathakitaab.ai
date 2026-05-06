// ============================================================
// scripts/derive-hotspots.ts
//
// Runs the vision agent over each scene image and emits a tightened
// hotspot map as `lib/data/hotspots.derived.json`. The current
// `lib/data/hotspots.ts` was hand-placed by clicking the image —
// often off by 3-5%. The derived map fits actual character figures.
//
// Usage:
//   npx tsx scripts/derive-hotspots.ts --slug=ramayana
//   npx tsx scripts/derive-hotspots.ts --slug=ramayana --dry-run
//
// Output is JSON, not a TS file, so it can be diffed cleanly and
// the hand-authored hotspots.ts stays as the canonical fallback.
// The reader can be wired to prefer derived when present.
//
// Cost: ~$0.01-0.03 per scene × 12 scenes = ~$0.30 for Ramayana.
// ============================================================

import './_loadEnv';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeImageForTargets } from '../lib/agents/visionAgent';
import { ramayanaHotspots } from '../lib/data/hotspots';

const PUBLIC_DIR = join(process.cwd(), 'public');
const OUT_DIR = join(process.cwd(), 'lib', 'data', 'derived');

interface DerivedHotspot {
  scene_id: string;
  target_id: string;
  label: string;
  /** Percentages (0..100) — same coordinate system the renderer uses. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Vision-agent confidence; if false, the entry is the hand-authored
   *  position passed through unchanged so the consumer can still
   *  render *something* even when vision missed. */
  vision_found: boolean;
  /** SHA1 of the source image bytes, so a downstream consumer can
   *  invalidate the derivation when the image changes. */
  image_hash: string;
}

interface DerivedFile {
  bookSlug: string;
  generatedAt: string;
  hotspots: DerivedHotspot[];
}

function parseSlug(): string {
  const a = process.argv.slice(2).find(s => s.startsWith('--slug='));
  if (a) return a.slice('--slug='.length);
  return 'ramayana';
}

function readImageBase64(imagePath: string): string {
  const abs = join(PUBLIC_DIR, imagePath.replace(/^\//, ''));
  if (!existsSync(abs)) throw new Error(`image not found: ${abs}`);
  const bytes = readFileSync(abs);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex').slice(0, 12);
}

async function deriveForRamayana(dryRun: boolean): Promise<DerivedFile> {
  // Group hand-authored hotspots by scene so we can ask the vision
  // agent for all of one scene's targets in a single pass.
  const bySceneId: Record<string, typeof ramayanaHotspots> = {};
  for (const h of ramayanaHotspots) {
    if (!bySceneId[h.scene_id]) bySceneId[h.scene_id] = [];
    bySceneId[h.scene_id].push(h);
  }

  const out: DerivedHotspot[] = [];
  for (const [sceneId, hotspots] of Object.entries(bySceneId)) {
    const imagePath = `/images/scene_${sceneId}.png`;
    const abs = join(PUBLIC_DIR, imagePath.replace(/^\//, ''));
    if (!existsSync(abs)) {
      console.log(`[derive-hotspots] skip ${sceneId}: ${abs} not found`);
      // Pass through hand-authored coordinates as a graceful fallback.
      for (const h of hotspots) {
        out.push({
          scene_id: sceneId,
          target_id: h.target_id,
          label: h.label,
          x: h.x, y: h.y, width: h.width, height: h.height,
          vision_found: false,
          image_hash: '',
        });
      }
      continue;
    }
    const imageHash = sha1(readFileSync(abs));
    const labels = hotspots.map(h => h.label);
    console.log(`[derive-hotspots] ${sceneId} (${labels.length} targets)…`);

    if (dryRun) {
      for (const h of hotspots) {
        out.push({
          scene_id: sceneId,
          target_id: h.target_id,
          label: h.label,
          x: h.x, y: h.y, width: h.width, height: h.height,
          vision_found: false,
          image_hash: imageHash,
        });
      }
      continue;
    }

    const dataUri = readImageBase64(imagePath);
    const results = await analyzeImageForTargets(dataUri, labels);

    for (const h of hotspots) {
      const r = results.find(x => x.label.toLowerCase() === h.label.toLowerCase());
      if (r && r.found) {
        out.push({
          scene_id: sceneId,
          target_id: h.target_id,
          label: h.label,
          x: r.x, y: r.y, width: r.width, height: r.height,
          vision_found: true,
          image_hash: imageHash,
        });
        console.log(`[derive-hotspots]   ${h.label}: hand=(${h.x},${h.y},${h.width}×${h.height}) → vision=(${r.x},${r.y},${r.width}×${r.height})`);
      } else {
        out.push({
          scene_id: sceneId,
          target_id: h.target_id,
          label: h.label,
          x: h.x, y: h.y, width: h.width, height: h.height,
          vision_found: false,
          image_hash: imageHash,
        });
        console.log(`[derive-hotspots]   ${h.label}: NOT FOUND, keeping hand-authored coords`);
      }
    }
  }

  return {
    bookSlug: 'ramayana',
    generatedAt: new Date().toISOString(),
    hotspots: out,
  };
}

async function main() {
  const slug = parseSlug();
  const dryRun = process.argv.includes('--dry-run');

  let result: DerivedFile;
  if (slug === 'ramayana') {
    result = await deriveForRamayana(dryRun);
  } else {
    console.error(`[derive-hotspots] slug "${slug}" not yet supported — only ramayana has hand-authored hotspots to derive from.`);
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${slug}-hotspots.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  const found = result.hotspots.filter(h => h.vision_found).length;
  console.log(`[derive-hotspots] wrote ${outPath}`);
  console.log(`[derive-hotspots] vision_found=${found}/${result.hotspots.length} (${Math.round(found / result.hotspots.length * 100)}%)`);
  void dirname; // satisfy import
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
