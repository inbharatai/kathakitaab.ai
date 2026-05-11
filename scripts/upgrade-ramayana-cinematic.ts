// Bring the curated Ramayana up to the new cinematic standard.
// Keeps the existing tight narration (no padding into a long
// audiobook); pure visual + camera upgrade so the movie reads
// cinematic instead of slideshow:
//
//   1. LLM authors 4-5 distinct shots per scene from the existing
//      narration. Each beat carries a camera_action.
//   2. Render each beat via the universal generateSceneImage pipeline
//      (photoreal preset, anchor portraits — same engine new books use).
//   3. Persist beats[] back into lib/data/scenes.ts.
//   4. Refresh remotion/manifests/ramayana.json from the updated data.
//
// What this DOESN'T do (intentionally):
//   - Doesn't touch existing narration — user wants sharp cinematic
//     text, not long audiobook-style.
//   - Doesn't re-render Sarvam audio — same text = same audio. Existing
//     Sarvam WAVs on Supabase keep streaming.
//   - Doesn't change scene count — 12 scenes stay 12 scenes.
//
// Cost: ~12 × ~4 beats × $0.04 (gpt-image-1 medium) = ~$1.90 one-time.
// Time: ~16 min concurrent on 3 image-gen jobs in flight.

import './_loadEnv';

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { ramayanaScenes } from '../lib/data/scenes';
import type { SceneBeat } from '../lib/types/livebook';
import { generateSceneImage } from '../lib/agents/visualAgent';

const SCENES_FILE = join(process.cwd(), 'lib', 'data', 'scenes.ts');
const IMAGES_DIR = join(process.cwd(), 'public', 'images');
const MANIFEST_PATH = join(process.cwd(), 'remotion', 'manifests', 'ramayana.json');

const VALID_MOTIONS = ['slow_zoom_in', 'slow_zoom_out', 'pan_left', 'pan_right', 'divine_glow', 'battle_push', 'fade_only'] as const;
type Motion = (typeof VALID_MOTIONS)[number];

interface BeatPlan { description: string; camera_action: Motion }

async function planSceneBeats(client: OpenAI, scene: typeof ramayanaScenes[number]): Promise<BeatPlan[]> {
  const sys =
    'You are a film cinematographer adapting a canonical Ramayana scene for the screen. ' +
    'You author 4-5 distinct shots from the given narration: each shot a different ' +
    'camera angle on a specific story moment. Shots are visually distinct (no two ' +
    'paintings of the same wide). You DO NOT rewrite or expand the narration; you ' +
    'only describe what the camera sees in each shot.';
  const user = `Scene: "${scene.title}" (scene_id: ${scene.scene_id})
Narration (≈30s of read time):
"""
${scene.narration}
"""
Existing visual hint:
"""
${scene.visual_description}
"""

Return ONLY a JSON object with this exact shape:
{
  "beats": [
    {
      "description": "string — beat 1 (ESTABLISHING WIDE). Set the location, time of day, who is where. Name the characters in frame.",
      "camera_action": "one of: slow_zoom_in | slow_zoom_out | pan_left | pan_right | divine_glow | battle_push | fade_only"
    },
    {
      "description": "string — beat 2 (CLOSE-UP). A face, hand, weapon, sacred object. Name WHO and the emotion on them.",
      "camera_action": "..."
    },
    {
      "description": "string — beat 3 (ACTION / TURNING POINT). The main moment of this scene unfolding.",
      "camera_action": "..."
    },
    {
      "description": "string — beat 4 (CONSEQUENCE). The aftermath / emotional pay-off / next intent.",
      "camera_action": "..."
    }
  ]
}

Rules:
- 4 beats minimum; add a 5th ONLY for genuinely multi-act scenes (battles, journeys).
- Every description must NAME the characters in frame so gpt-image-1 paints the right people.
- Pick camera_action for the moment: close-ups → slow_zoom_in or fade_only; reveals → slow_zoom_out; action → battle_push; sacred / divine moments → divine_glow; journeys / sorrow → pan_left; arrivals → pan_right.
- Visually distinct beats. Don't repeat the establishing wide as beat 3.
- Photoreal Bollywood-mythology film register — costumes ornate, lighting cinematic.`;

  const r = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.65,
    max_tokens: 1400,
  });
  const raw = r.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as { beats?: Array<{ description?: string; camera_action?: string }> };
  const out: BeatPlan[] = [];
  for (const b of (parsed.beats ?? [])) {
    const desc = (b.description || '').trim();
    if (desc.length < 20) continue;
    const cam = normaliseMotion(b.camera_action) ?? 'slow_zoom_in';
    out.push({ description: desc, camera_action: cam });
  }
  if (out.length < 2) {
    out.push({ description: scene.visual_description, camera_action: 'slow_zoom_in' });
  }
  return out;
}

function normaliseMotion(raw: string | undefined): Motion | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (VALID_MOTIONS as readonly string[]).includes(v) ? (v as Motion) : undefined;
}

async function renderBeats(scene: typeof ramayanaScenes[number], plan: BeatPlan[], characters: string[]): Promise<SceneBeat[]> {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const out: SceneBeat[] = [];
  for (let i = 0; i < plan.length; i++) {
    const beat = plan[i];
    const fileName = `scene_${scene.scene_id}_beat_${i + 1}.png`;
    const localPath = join(IMAGES_DIR, fileName);

    // Idempotent — skip gpt-image-1 when the beat file already exists
    // on disk. Cuts the cost of re-runs to near zero and lets a
    // post-failure recovery just re-derive scenes.ts + manifest from
    // the cached art.
    if (existsSync(localPath)) {
      console.log(`    beat ${i + 1}/${plan.length} (${beat.camera_action})… cache hit`);
      out.push({
        imageUrl: `/images/${fileName}`,
        visualDescription: beat.description,
        motion: beat.camera_action,
      });
      continue;
    }

    process.stdout.write(`    beat ${i + 1}/${plan.length} (${beat.camera_action})… `);
    try {
      const r = await generateSceneImage(beat.description, {
        bookSlug: 'ramayana',
        characters,
        mood: 'serene',
        stylePreset: 'photoreal_cinematic',
      });
      if (!r.imageUrl) { console.log('empty'); continue; }
      const bytes = await fetchAsBuffer(r.imageUrl);
      writeFileSync(localPath, bytes);
      out.push({
        imageUrl: `/images/${fileName}`,
        visualDescription: beat.description,
        motion: beat.camera_action,
      });
      console.log(`✓ ${bytes.length} bytes`);
    } catch (err) {
      console.log('fail');
      console.warn(`      → ${err instanceof Error ? err.message : err}`);
    }
  }
  return out;
}

async function fetchAsBuffer(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1] ?? '';
    return Buffer.from(base64, 'base64');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function jsString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ').trim()}'`;
}

function rewriteScenesFile(updates: Map<string, SceneBeat[]>): void {
  const src = readFileSync(SCENES_FILE, 'utf8');
  let out = src;

  for (const [scene_id, beats] of updates.entries()) {
    // STRICT match: scene_id must NOT be preceded by `previous_` or
    // `next_` — those references are substrings that contain the
    // exact `scene_id: 'X'` literal and break naive indexOf. We
    // anchor with a leading boundary char (comma+space, or a newline
    // for the first field per scene). The very first scene id appears
    // after `id: 'scene-N', book_id: BOOK_ID, ` so a leading `, `
    // matches; subsequent scene_id occurrences in narration etc.
    // don't have that prefix.
    const re = new RegExp(`,\\s+scene_id:\\s+'${escapeRegex(scene_id)}'`, '');
    const m = re.exec(out);
    if (!m) {
      console.warn(`  ! ${scene_id}: not found in scenes.ts; skipping`);
      continue;
    }
    const sceneStart = m.index;
    // Locate the end of THIS scene block: the next `  },` separator (between
    // scenes) or `  }\n];` closer (last scene). Use a regex that tolerates
    // CRLF line endings — scenes.ts is checked in with Windows line endings.
    const sepRe = /\r?\n  \},\r?\n/g;
    sepRe.lastIndex = sceneStart;
    const sepMatch = sepRe.exec(out);
    const tailRe = /\r?\n  \}\r?\n\];/g;
    tailRe.lastIndex = sceneStart;
    const tailMatch = tailRe.exec(out);
    const sepIdx = sepMatch ? sepMatch.index : -1;
    const tailIdx = tailMatch ? tailMatch.index : -1;
    const sceneEnd = sepIdx >= 0 && (tailIdx < 0 || sepIdx < tailIdx) ? sepIdx : tailIdx;
    if (sceneEnd < 0) {
      console.warn(`  ! ${scene_id}: end marker not found; skipping`);
      continue;
    }
    const before = out.slice(0, sceneStart);
    const block = out.slice(sceneStart, sceneEnd);
    const after = out.slice(sceneEnd);

    const beatsLiteral =
      '    beats: [\n' +
      beats
        .map(b => `      { imageUrl: '${b.imageUrl}', visualDescription: ${jsString(b.visualDescription)}, motion: '${b.motion}' }`)
        .join(',\n') +
      '\n    ],';

    // Need a trailing comma after the last existing property before
    // we append. The seed pattern ends with `updated_at: new Date()...()`
    // (no trailing comma since it was the last property). Insert one.
    let normalisedBlock = block;
    if (!/,\s*$/.test(normalisedBlock.trimEnd())) {
      normalisedBlock = normalisedBlock.trimEnd() + ',';
    }

    const hasExisting = /\n\s*beats:\s*\[[\s\S]*?\],?/.test(normalisedBlock);
    const updatedBlock = hasExisting
      ? normalisedBlock.replace(/\n\s*beats:\s*\[[\s\S]*?\],?/, `\n${beatsLiteral}`)
      : `${normalisedBlock}\n${beatsLiteral}`;

    out = before + updatedBlock + after;
  }

  writeFileSync(SCENES_FILE, out, 'utf8');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function estimateDurationSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / 150) * 60 + 2.5));
}

async function refreshStaticManifest(): Promise<void> {
  // Bust module cache so the just-written scenes.ts is read fresh.
  delete require.cache[require.resolve('../lib/data/scenes')];
  delete require.cache[require.resolve('../lib/data/ramayanaSeed')];
  const { ramayanaScenes: fresh } = await import('../lib/data/scenes');
  const { ramayanaBook } = await import('../lib/data/ramayanaSeed');
  const { ramayanaHotspots } = await import('../lib/data/hotspots');
  const { planSubtitles } = await import('../lib/video/subtitlePlanner');
  const { motionForMood } = await import('../lib/video/motion');
  const { detectTopics } = await import('../lib/video/effects/topicTagger');
  const { buildSceneEffects } = await import('../lib/video/effects/effectRecipes');

  const scenes = fresh
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map(s => {
      const durationSeconds = estimateDurationSeconds(s.narration);
      const motion = motionForMood('serene');
      const topics = detectTopics(s.narration);
      const effects = buildSceneEffects(topics, 'serene');
      const beats = s.beats && s.beats.length >= 2
        ? s.beats.map(b => ({ imagePath: b.imageUrl, motion: b.motion ?? motion }))
        : undefined;
      const hotspots = ramayanaHotspots
        .filter(h => h.scene_id === s.scene_id)
        .filter(h => h.hotspot_type === 'character' || h.hotspot_type === 'object' || h.hotspot_type === 'place')
        .map(h => ({
          label: h.label,
          type: h.hotspot_type,
          x: h.x,
          y: h.y,
          width: h.width,
          height: h.height,
        }));
      return {
        sceneId: s.scene_id,
        title: s.title,
        narration: s.narration,
        imagePath: s.background_asset_url,
        beats,
        audioPath: `https://esaypdyvmymsmlgxxylv.supabase.co/storage/v1/object/public/scene-images/ramayana/movie-audio/${s.scene_id}.wav`,
        durationSeconds,
        mood: 'serene',
        motion,
        effects,
        subtitles: planSubtitles(s.narration, durationSeconds),
        hotspots,
      };
    });

  const manifest = {
    bookSlug: ramayanaBook.slug,
    bookTitle: ramayanaBook.title,
    scenes,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const total = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const beatCount = scenes.reduce((sum, s) => sum + (s.beats?.length ?? 0), 0);
  console.log(`\n[refresh] wrote ${MANIFEST_PATH}`);
  console.log(`  scenes: ${scenes.length}  runtime: ${total}s ≈ ${(total / 60).toFixed(1)} min  beats: ${beatCount}`);
}

async function main() {
  const client = new OpenAI();
  const charactersInScene = (scene: typeof ramayanaScenes[number]): string[] => {
    const text = (scene.narration + ' ' + scene.visual_description).toLowerCase();
    const known = ['Rama', 'Sita', 'Lakshmana', 'Hanuman', 'Ravana', 'Dasharatha', 'Bharata', 'Jatayu', 'Vibhishana', 'Sugriva', 'Vishwamitra', 'Janaka', 'Kaikeyi'];
    return known.filter(n => text.includes(n.toLowerCase()));
  };

  const updates = new Map<string, SceneBeat[]>();
  const overall = Date.now();
  for (const scene of ramayanaScenes) {
    console.log(`\n=== ${scene.scene_id} (${scene.title}) ===`);
    try {
      const plan = await planSceneBeats(client, scene);
      console.log(`  planned ${plan.length} beats`);
      const beats = await renderBeats(scene, plan, charactersInScene(scene));
      if (beats.length === 0) {
        console.warn(`  ! ${scene.scene_id}: 0 beats rendered, keeping single-image fallback`);
        continue;
      }
      updates.set(scene.scene_id, beats);
    } catch (err) {
      console.error(`  ✗ ${scene.scene_id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('\n[upgrade] rewriting scenes.ts with new beats...');
  rewriteScenesFile(updates);

  console.log('\n[upgrade] refreshing static manifest...');
  await refreshStaticManifest();

  console.log(`\n[upgrade] done in ${((Date.now() - overall) / 1000).toFixed(1)}s`);
}

main().catch(e => {
  console.error('upgrade failed:', e);
  process.exit(1);
});
