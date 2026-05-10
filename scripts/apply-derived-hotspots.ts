// Apply derived hotspot coordinates back into the canonical
// lib/data/hotspots.ts source file. Reads vision_found=true entries
// from lib/data/derived/<slug>-hotspots.json and rewrites the
// matching x/y/width/height fields in-place. Hotspots where the
// vision agent didn't find a target keep their hand-authored coords.
//
// Usage:
//   npx tsx scripts/apply-derived-hotspots.ts ramayana
//
// Output is a normal git diff against lib/data/hotspots.ts — review
// before committing.

import './_loadEnv';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface DerivedHotspot {
  scene_id: string;
  target_id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  vision_found: boolean;
}

interface DerivedFile {
  bookSlug: string;
  generatedAt: string;
  hotspots: DerivedHotspot[];
}

function applyDerived(slug: string): { applied: number; skipped: number; missing: number } {
  const derivedPath = join(process.cwd(), 'lib', 'data', 'derived', `${slug}-hotspots.json`);
  const sourcePath = join(process.cwd(), 'lib', 'data', 'hotspots.ts');

  const derived: DerivedFile = JSON.parse(readFileSync(derivedPath, 'utf8'));
  const lines = readFileSync(sourcePath, 'utf8').split(/\r?\n/);

  // Index derived hotspots by (scene_id, target_id) for O(1) lookup.
  const byKey = new Map<string, DerivedHotspot>();
  for (const h of derived.hotspots) {
    byKey.set(`${h.scene_id}|${h.target_id}`, h);
  }

  let applied = 0;
  let skipped = 0;
  let missing = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match a single-line hotspot literal:
    //   { id: 'hs-1-1', scene_id: 'ayodhya_intro', ..., target_id: 'rama', ...,
    //     x: 35, y: 40, width: 12, height: 22, ... }
    const sceneMatch = line.match(/scene_id:\s*'([^']+)'/);
    const targetMatch = line.match(/target_id:\s*'([^']+)'/);
    if (!sceneMatch || !targetMatch) continue;

    const key = `${sceneMatch[1]}|${targetMatch[1]}`;
    const d = byKey.get(key);
    if (!d) { missing++; continue; }
    if (!d.vision_found) { skipped++; continue; }

    // Round decimals to whole percents — matches the existing style
    // in hotspots.ts and avoids visual snapping in the renderer.
    const rx = Math.round(d.x);
    const ry = Math.round(d.y);
    const rw = Math.round(d.width);
    const rh = Math.round(d.height);

    // Replace the four numeric fields. Each is in the form
    //   x: NUM,
    // The renderer doesn't care about decimals; we round for git
    // diff legibility.
    lines[i] = line
      .replace(/(\bx:\s*)-?[\d.]+/, `$1${rx}`)
      .replace(/(\by:\s*)-?[\d.]+/, `$1${ry}`)
      .replace(/(\bwidth:\s*)-?[\d.]+/, `$1${rw}`)
      .replace(/(\bheight:\s*)-?[\d.]+/, `$1${rh}`);

    applied++;
  }

  writeFileSync(sourcePath, lines.join('\n'), 'utf8');
  return { applied, skipped, missing };
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx scripts/apply-derived-hotspots.ts <slug>');
    process.exit(1);
  }
  const stats = applyDerived(slug);
  console.log(`[apply-hotspots] ${slug}: applied=${stats.applied} skipped(vision_missed)=${stats.skipped} no_derived_entry=${stats.missing}`);
}

main().catch(e => {
  console.error('failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
