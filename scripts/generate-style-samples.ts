// Generates 4 sample images per visual-style preset for the
// landing-page style-card backgrounds. Each card animates a slow
// Ken-Burns crossfade through its own samples so visitors see the
// actual style they're picking instead of guessing from the label.
//
// Reuses what we already have:
//   - photoreal:  /images/scene_*_beat_*.png   (Ramayana cinematic upgrade)
//   - comic:      /images/comic/scene_*_beat_*.png (today's comic regen)
// Renders fresh for the two missing presets:
//   - watercolour: 4 establishing shots in storybook_watercolor preset
//   - animation:   4 establishing shots in cinematic_animation preset
//
// Idempotent: skips files that already exist on disk. Total fresh
// cost on first run: 8 images × $0.04 = ~$0.32.

import './_loadEnv';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateSceneImage } from '../lib/agents/visualAgent';
import type { StylePreset } from '../lib/types/style';

const OUT_DIR = join(process.cwd(), 'public', 'images', 'style-samples');

// Four scene briefs that read clearly in any style — chosen so the
// rendered samples have visual variety (wide / character / sacred /
// action) and the card cycle doesn't feel monotonous.
const PROMPTS = [
  {
    name: 'court',
    prompt: 'A grand royal court at golden hour — ornate pillars, jewel-toned banners, a wise king on a high throne, courtiers in rich silks gathered before him.',
    mood: 'serene',
  },
  {
    name: 'forest',
    prompt: 'A young warrior prince and a princess walking together through a sun-dappled ancient forest, deer in the background, soft river running by.',
    mood: 'serene',
  },
  {
    name: 'battle',
    prompt: 'A hero in mid-leap with bow drawn, arrow flying, dust kicked up, an enormous looming antagonist roaring beyond — dramatic shadows, dynamic action.',
    mood: 'dramatic',
  },
  {
    name: 'temple',
    prompt: 'A sage in meditation in a forest temple at dawn, divine golden light streaming through tall stone arches, lotus flowers floating on a pool.',
    mood: 'sacred',
  },
] as const;

// Only generate for the presets we don't already have local samples for.
// photoreal + comic reuse the existing Ramayana beats — see the
// landing page card data wiring.
const TARGETS: Array<{ preset: StylePreset; folder: string }> = [
  { preset: 'storybook_watercolor', folder: 'watercolour' },
  { preset: 'cinematic_animation', folder: 'animation' },
];

async function fetchAsBuffer(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    return Buffer.from(url.split(',')[1] ?? '', 'base64');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const overall = Date.now();
  for (const { preset, folder } of TARGETS) {
    const dir = join(OUT_DIR, folder);
    mkdirSync(dir, { recursive: true });
    console.log(`\n=== ${preset} → public/images/style-samples/${folder}/ ===`);
    for (let i = 0; i < PROMPTS.length; i++) {
      const p = PROMPTS[i];
      const file = join(dir, `${i + 1}-${p.name}.png`);
      if (existsSync(file)) {
        console.log(`  ${i + 1}/${PROMPTS.length} (${p.name})… cache hit`);
        continue;
      }
      process.stdout.write(`  ${i + 1}/${PROMPTS.length} (${p.name})… `);
      try {
        const r = await generateSceneImage(p.prompt, {
          characters: [],
          mood: p.mood,
          stylePreset: preset,
        });
        if (!r.imageUrl) { console.log('empty'); continue; }
        const bytes = await fetchAsBuffer(r.imageUrl);
        writeFileSync(file, bytes);
        console.log(`✓ ${bytes.length} bytes`);
      } catch (err) {
        console.log('fail');
        console.warn(`    → ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  console.log(`\n[style-samples] done in ${((Date.now() - overall) / 1000).toFixed(1)}s`);
}

main().catch(e => {
  console.error('style sample build failed:', e);
  process.exit(1);
});
