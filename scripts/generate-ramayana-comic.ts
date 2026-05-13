// Generates the comic-book sibling of the curated Ramayana:
//
//   1. Pulls the existing photoreal Ramayana scenes from lib/data/scenes.ts
//      (same canon, same narration, same hotspots — the dataset is the
//      hand-tuned reference book).
//   2. Runs dialogueTagger over each scene to derive 2-5 in-character
//      lines per scene from narration + character roster. These drive
//      the comic-bubble overlay.
//   3. Re-renders each scene's beats with the comic_book style preset
//      via the universal generateSceneImage pipeline. Images saved to
//      /public/images/comic/scene_<id>_beat_<n>.png so they don't
//      collide with the photoreal beats.
//   4. Writes a new manifest remotion/manifests/ramayana-comic.json
//      with stylePreset:'comic_book' so BookMovie renders bubbles
//      instead of the subtitle bar.
//   5. Registers a seed book entry pointing to the new slug.
//
// Idempotent: skips image gen for beats whose files already exist
// (rerun cost is the LLM tagger pass only ~$0.06).
//
// Total cost on a fresh run: ~$2.40 image gen, ~$0.06 LLM, ~$2.50 total.

import './_loadEnv';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { ramayanaScenes } from '../lib/data/scenes';
import { ramayanaBook } from '../lib/data/ramayanaSeed';
import { ramayanaHotspots } from '../lib/data/hotspots';
import { ramayanaCharacters } from '../lib/data/characters';
import { generateSceneImage } from '../lib/agents/visualAgent';
import { tagBookDialogue, type TaggerCharacter } from '../lib/openai/dialogueTagger';
import { planSubtitles } from '../lib/video/subtitlePlanner';
import { motionForMood } from '../lib/video/motion';
import { detectTopics } from '../lib/video/effects/topicTagger';
import { buildSceneEffects } from '../lib/video/effects/effectRecipes';
import type { SceneBeat, SceneDialogue } from '../lib/types/livebook';

const IMAGES_DIR = join(process.cwd(), 'public', 'images', 'comic');
const MANIFEST_PATH = join(process.cwd(), 'remotion', 'manifests', 'ramayana-comic.json');
const COMIC_SLUG = 'ramayana-comic';

interface BeatPlan { description: string; camera_action: SceneBeat['motion'] }

const VALID_MOTIONS = ['slow_zoom_in', 'slow_zoom_out', 'pan_left', 'pan_right', 'divine_glow', 'battle_push', 'fade_only'] as const;

async function planSceneBeats(client: OpenAI, scene: typeof ramayanaScenes[number]): Promise<BeatPlan[]> {
  // Reuse the same beat-planning prompt as the cinematic upgrade —
  // beats are universal across presets; only the style clause in
  // the image prompt changes.
  const sys =
    'You are a comic-book panel artist adapting a canonical Ramayana scene. ' +
    'You author 4-5 distinct panels from the given narration: each panel a ' +
    'different camera angle on a specific story moment. Panels are visually ' +
    'distinct (no two paintings of the same wide). You leave clear negative ' +
    'space in the upper third of each panel for speech bubbles to be overlaid.';
  const user = `Scene: "${scene.title}" (scene_id: ${scene.scene_id})
Narration:
"""
${scene.narration}
"""
Existing visual hint:
"""
${scene.visual_description}
"""

Return ONLY a JSON object:
{
  "beats": [
    { "description": "panel 1 — ESTABLISHING WIDE: location, time of day, who's in it, with clear negative space top for a caption/bubble", "camera_action": "slow_zoom_out" },
    { "description": "panel 2 — CLOSE-UP: face / hand / weapon / sacred object. NAME the character.", "camera_action": "slow_zoom_in" },
    { "description": "panel 3 — ACTION / TURNING POINT.", "camera_action": "battle_push" },
    { "description": "panel 4 — CONSEQUENCE.", "camera_action": "..." }
  ]
}

Rules:
- 4 beats minimum, 5 for battle / journey scenes.
- Each description names the characters in frame.
- Leave clear space in upper third for bubble overlay.
- Visually distinct beats — don't repeat the wide.`;

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
  return out;
}

function normaliseMotion(raw: string | undefined): SceneBeat['motion'] | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (VALID_MOTIONS as readonly string[]).includes(v) ? (v as SceneBeat['motion']) : undefined;
}

async function renderBeats(scene: typeof ramayanaScenes[number], plan: BeatPlan[], characters: string[]): Promise<SceneBeat[]> {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const out: SceneBeat[] = [];
  for (let i = 0; i < plan.length; i++) {
    const beat = plan[i];
    const fileName = `scene_${scene.scene_id}_beat_${i + 1}.png`;
    const localPath = join(IMAGES_DIR, fileName);
    if (existsSync(localPath)) {
      console.log(`    beat ${i + 1}/${plan.length} (${beat.camera_action})… cache hit`);
      out.push({
        imageUrl: `/images/comic/${fileName}`,
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
        mood: 'dramatic',
        // The whole point of this script — render in the new comic preset.
        stylePreset: 'comic_book',
      });
      if (!r.imageUrl) { console.log('empty'); continue; }
      const bytes = await fetchAsBuffer(r.imageUrl);
      writeFileSync(localPath, bytes);
      out.push({
        imageUrl: `/images/comic/${fileName}`,
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
    return Buffer.from(url.split(',')[1] ?? '', 'base64');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function estimateDurationSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / 150) * 60 + 2.5));
}

async function main() {
  const client = new OpenAI();

  // ── Step 1: tag dialogue for every scene ──
  console.log('[comic] tagging dialogue for', ramayanaScenes.length, 'scenes...');
  const tagged = await tagBookDialogue(
    ramayanaScenes.map(s => ({
      scene_id: s.scene_id,
      title: s.title,
      narration: s.narration,
    })),
    ramayanaCharacters.map<TaggerCharacter>(c => ({
      slug: c.slug,
      name: c.name,
      role: c.role,
    })),
    { concurrency: 4 },
  );
  const dialogueBySceneId = new Map<string, SceneDialogue[]>();
  for (const t of tagged) dialogueBySceneId.set(t.scene_id, t.dialogue);
  for (const t of tagged) {
    console.log(`  ${t.scene_id}: ${t.dialogue.length} dialogue beats`);
  }

  // ── Step 2: plan + render beats per scene ──
  const charactersInScene = (scene: typeof ramayanaScenes[number]): string[] => {
    const text = (scene.narration + ' ' + scene.visual_description).toLowerCase();
    const known = ['Rama', 'Sita', 'Lakshmana', 'Hanuman', 'Ravana', 'Dasharatha', 'Bharata', 'Jatayu', 'Vibhishana', 'Sugriva', 'Vishwamitra', 'Janaka', 'Kaikeyi'];
    return known.filter(n => text.includes(n.toLowerCase()));
  };

  const beatsBySceneId = new Map<string, SceneBeat[]>();
  const overall = Date.now();
  for (const scene of ramayanaScenes) {
    console.log(`\n=== ${scene.scene_id} (${scene.title}) ===`);
    try {
      const plan = await planSceneBeats(client, scene);
      console.log(`  planned ${plan.length} comic panels`);
      const beats = await renderBeats(scene, plan, charactersInScene(scene));
      if (beats.length > 0) beatsBySceneId.set(scene.scene_id, beats);
    } catch (err) {
      console.error(`  ✗ ${scene.scene_id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Step 3: write the comic manifest ──
  const scenes = ramayanaScenes
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map(s => {
      const durationSeconds = estimateDurationSeconds(s.narration);
      const motion = motionForMood('dramatic');
      const topics = detectTopics(s.narration);
      const effects = buildSceneEffects(topics, 'dramatic');
      const sceneBeats = beatsBySceneId.get(s.scene_id);
      const beats = sceneBeats && sceneBeats.length >= 2
        ? sceneBeats.map(b => ({ imagePath: b.imageUrl, motion: b.motion ?? motion }))
        : undefined;
      const hotspots = ramayanaHotspots
        .filter(h => h.scene_id === s.scene_id)
        .filter(h => h.hotspot_type === 'character' || h.hotspot_type === 'object' || h.hotspot_type === 'place')
        .map(h => ({
          label: h.target_id, // use target_id so dialogue.speaker matches the character slug
          type: h.hotspot_type,
          x: h.x, y: h.y, width: h.width, height: h.height,
        }));
      return {
        sceneId: s.scene_id,
        title: s.title,
        narration: s.narration,
        // First comic beat is the background; subtitle bar is hidden
        // in comic mode, so background_asset_url (photoreal) is never
        // shown — the comic beat image takes its place.
        imagePath: sceneBeats?.[0]?.imageUrl ?? s.background_asset_url,
        beats,
        audioPath: `https://esaypdyvmymsmlgxxylv.supabase.co/storage/v1/object/public/scene-images/ramayana/movie-audio/${s.scene_id}.wav`,
        durationSeconds,
        mood: 'dramatic',
        motion,
        effects,
        subtitles: planSubtitles(s.narration, durationSeconds),
        hotspots,
        dialogue: dialogueBySceneId.get(s.scene_id) ?? [],
      };
    });

  const manifest = {
    bookSlug: COMIC_SLUG,
    bookTitle: `${ramayanaBook.title} — Comic`,
    scenes,
    generatedAt: new Date().toISOString(),
    stylePreset: 'comic_book' as const,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const total = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const beatCount = scenes.reduce((sum, s) => sum + (s.beats?.length ?? 0), 0);
  const dialogueCount = scenes.reduce((sum, s) => sum + s.dialogue.length, 0);
  console.log(`\n[comic] wrote ${MANIFEST_PATH}`);
  console.log(`  scenes: ${scenes.length}  runtime: ${total}s ≈ ${(total / 60).toFixed(1)} min`);
  console.log(`  beats: ${beatCount}  dialogue: ${dialogueCount} bubbles`);
  console.log(`\n[comic] done in ${((Date.now() - overall) / 1000).toFixed(1)}s`);
}

main().catch(e => {
  console.error('comic build failed:', e);
  process.exit(1);
});
