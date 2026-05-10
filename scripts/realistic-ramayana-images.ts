// Re-render the 12 curated Ramayana scene images in photorealistic
// Bollywood-cinematic style, replacing public/images/scene_<id>.png
// in place. Manifest paths stay valid so the landing page Player and
// live reader pick up the new art on next load.
//
// Cost: ~12 × $0.17 (gpt-image-1 high quality, 1536x1024) ≈ $2.

import './_loadEnv';

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { ramayanaScenes } from '../lib/data/scenes';

const OUT_DIR = join(process.cwd(), 'public', 'images');

const STYLE_PREFIX =
  'Photorealistic cinematic still from a high-budget Bollywood mythological epic film. ';

const STYLE_SUFFIX =
  ' Real Indian actors in ornate ancient Vedic-era costume — silk dhotis, gold-embroidered saris, intricate jewelry, woven garlands. Authentic period setting: stone temples, ornate palace interiors with carved pillars, lush riverbank forests. Dramatic golden-hour lighting, warm devotional atmosphere, rich saturated color grading, shallow depth of field, subtle film grain, anamorphic widescreen composition. Professional cinematography, hyper-detailed, painterly realism. NO cartoon, NO anime, NO flat illustration — this is a film still.';

// Soft character notes prepended when a scene mentions the character.
// Keeps faces and dress roughly consistent across scenes despite
// gpt-image-1 not having anchor images.
const CHARACTER_NOTES: Array<[RegExp, string]> = [
  [/\brama\b/i, 'Prince Rama — tall young man, calm noble face, dark-blue-tinted skin, simple yellow silk dhoti, gold ornaments, bow on his back. '],
  [/\bsita\b/i, 'Princess Sita — graceful young woman, long dark hair in a single braid, saffron-gold silk sari, delicate gold jewelry, serene gaze. '],
  [/\blakshmana\b/i, 'Lakshmana — Rama\'s younger brother, athletic, dark green silk dhoti, quiver of arrows. '],
  [/\bhanuman\b/i, 'Hanuman — powerful monkey-form deity with reddish-orange complexion, muscular, golden mace, devoted expression. '],
  [/\bravana\b/i, 'Ravana — imposing demon king, dark-skinned, ten heads or a single crowned regal head, dark red and black silk robes, gold ornaments, fierce gaze. '],
  [/\bdasharatha\b/i, 'King Dasharatha — aged dignified king, long white beard, deep red and gold royal robes, tall crown. '],
  [/\bvishwamitra\b/i, 'Sage Vishwamitra — lean ascetic, long white beard, saffron robes, wooden staff. '],
  [/\bjanaka\b/i, 'King Janaka — middle-aged philosopher-king, simple white robes with gold trim, contemplative face. '],
  [/\bjatayu\b/i, 'Jatayu — giant noble eagle deity, brown and gold plumage, regal bearing. '],
  [/\bbharata\b/i, 'Bharata — Rama\'s loyal younger brother, simple white robes, sorrowful but resolute face. '],
];

function buildPrompt(scene: typeof ramayanaScenes[number]): string {
  const lower = `${scene.title} ${scene.narration} ${scene.visual_description}`;
  const charNotes = CHARACTER_NOTES
    .filter(([re]) => re.test(lower))
    .map(([, note]) => note)
    .join('');
  return `${STYLE_PREFIX}${charNotes}Scene: ${scene.visual_description}${STYLE_SUFFIX}`;
}

async function renderOne(client: OpenAI, scene: typeof ramayanaScenes[number]): Promise<void> {
  const prompt = buildPrompt(scene);
  const t0 = Date.now();
  const r = await client.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1536x1024',
    quality: 'high',
    n: 1,
  });
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image returned');
  const out = join(OUT_DIR, `scene_${scene.scene_id}.png`);
  writeFileSync(out, Buffer.from(b64, 'base64'));
  const ms = Date.now() - t0;
  console.log(`  ✓ ${scene.scene_id} (${ms}ms, ${b64.length} b64 chars)`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const client = new OpenAI();
  console.log(`Re-rendering ${ramayanaScenes.length} scenes in photorealistic cinematic style…\n`);
  const overall = Date.now();
  for (const scene of ramayanaScenes) {
    console.log(`${scene.order_index}. ${scene.title}`);
    try {
      await renderOne(client, scene);
    } catch (e) {
      console.error(`  ✗ ${scene.scene_id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`\nDone in ${((Date.now() - overall) / 1000).toFixed(1)}s.`);
  console.log('Refresh /books/ramayana to see the new images.');
}

main().catch(e => {
  console.error('failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
