// ============================================================
// scripts/verify-manifest.ts
//
// Hard-fails CI / pre-commit if a book's manifest is missing any
// of the Phase 10 spec fields. Walks every scene and reports
// every gap before exiting non-zero — so a single run surfaces
// all problems instead of one-at-a-time bisection.
//
// Run:
//   npx tsx scripts/verify-manifest.ts --slug=ramayana
//   npx tsx scripts/verify-manifest.ts --all
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface ManifestSubtitleCue { text: string; startMs: number; endMs: number }
interface ManifestEffect { type: string; [k: string]: unknown }
interface ManifestScene {
  sceneId?: string;
  title?: string;
  narration?: string;
  imagePath?: string;
  audioPath?: string | null;
  narrationAudioUrl?: string;
  durationSeconds?: number;
  subtitles?: ManifestSubtitleCue[];
  motion?: string;
  mood?: string;
  backgroundMusicUrl?: string;
  effects?: ManifestEffect[];
}
interface BookManifest {
  bookSlug?: string;
  bookTitle?: string;
  scenes?: ManifestScene[];
  generatedAt?: string;
}

const MANIFESTS_DIR = join(process.cwd(), 'remotion', 'manifests');

const VALID_MOTIONS = new Set([
  'slow_zoom_in', 'slow_zoom_out', 'pan_left', 'pan_right',
  'divine_glow', 'battle_push', 'fade_only',
]);

const VALID_EFFECTS = new Set([
  'particles', 'glow', 'flash', 'tint', 'vignette', 'rim_light',
  'dust_shaft', 'shake', 'ripple', 'parallax', 'desaturation', 'bloom', 'fog',
]);

interface Issue { scene: string; field: string; problem: string }

function verify(slug: string): Issue[] {
  const path = join(MANIFESTS_DIR, `${slug}.json`);
  if (!existsSync(path)) {
    return [{ scene: '<manifest>', field: 'file', problem: `manifest not found: ${path}` }];
  }
  let manifest: BookManifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as BookManifest;
  } catch (err) {
    return [{ scene: '<manifest>', field: 'json', problem: `not valid JSON: ${err}` }];
  }

  const issues: Issue[] = [];
  if (!manifest.bookSlug) issues.push({ scene: '<manifest>', field: 'bookSlug', problem: 'missing' });
  if (!manifest.bookTitle) issues.push({ scene: '<manifest>', field: 'bookTitle', problem: 'missing' });
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    issues.push({ scene: '<manifest>', field: 'scenes', problem: 'missing or empty' });
    return issues;
  }

  for (const [i, scene] of manifest.scenes.entries()) {
    const id = scene.sceneId ?? `<index ${i}>`;

    // Required core fields.
    if (!scene.sceneId)        issues.push({ scene: id, field: 'sceneId',        problem: 'missing' });
    if (!scene.title)          issues.push({ scene: id, field: 'title',          problem: 'missing' });
    if (!scene.narration)      issues.push({ scene: id, field: 'narration',      problem: 'missing' });
    if (!scene.imagePath)      issues.push({ scene: id, field: 'imagePath',      problem: 'missing' });
    if (scene.audioPath === undefined)      issues.push({ scene: id, field: 'audioPath',      problem: 'missing' });
    else if (scene.audioPath === null)       issues.push({ scene: id, field: 'audioPath',      problem: 'narration unavailable (null) — regenerate the manifest to restore voiced narration' });
    if (!scene.narrationAudioUrl) issues.push({ scene: id, field: 'narrationAudioUrl', problem: 'missing (Phase 10 contract)' });

    // Numeric duration.
    if (typeof scene.durationSeconds !== 'number' || !(scene.durationSeconds > 0)) {
      issues.push({ scene: id, field: 'durationSeconds', problem: `must be positive number, got ${scene.durationSeconds}` });
    }

    // Subtitles[] with explicit timing.
    if (!Array.isArray(scene.subtitles) || scene.subtitles.length === 0) {
      issues.push({ scene: id, field: 'subtitles', problem: 'missing — narration cannot be subtitled at render time' });
    } else {
      for (const [j, cue] of scene.subtitles.entries()) {
        const tag = `subtitles[${j}]`;
        if (!cue.text) issues.push({ scene: id, field: `${tag}.text`, problem: 'missing' });
        if (typeof cue.startMs !== 'number') issues.push({ scene: id, field: `${tag}.startMs`, problem: 'not a number' });
        if (typeof cue.endMs   !== 'number') issues.push({ scene: id, field: `${tag}.endMs`,   problem: 'not a number' });
        if (typeof cue.startMs === 'number' && typeof cue.endMs === 'number' && cue.endMs <= cue.startMs) {
          issues.push({ scene: id, field: tag, problem: `endMs (${cue.endMs}) must be > startMs (${cue.startMs})` });
        }
      }
    }

    // Per-scene motion.
    if (!scene.motion) {
      issues.push({ scene: id, field: 'motion', problem: 'missing — render falls back to slow_zoom_in for every scene' });
    } else if (!VALID_MOTIONS.has(scene.motion)) {
      issues.push({ scene: id, field: 'motion', problem: `unknown motion '${scene.motion}', expected one of: ${[...VALID_MOTIONS].join(', ')}` });
    }

    // Music: either an explicit URL or a mood (which the composition
    // resolves to a procedural WAV). Fail only when neither is present.
    if (!scene.backgroundMusicUrl && !scene.mood) {
      issues.push({ scene: id, field: 'backgroundMusicUrl|mood', problem: 'set one — without it the scene plays silent under narration' });
    }

    // Effects DSL — universal layer vocabulary. The build script bakes
    // these from topic + mood; missing means the scene renders as a
    // flat image with no atmospheric layer.
    if (!Array.isArray(scene.effects) || scene.effects.length === 0) {
      issues.push({ scene: id, field: 'effects', problem: 'missing — scene will render flat with no particles/glow/atmospheric layer' });
    } else {
      for (const [j, eff] of scene.effects.entries()) {
        const tag = `effects[${j}]`;
        if (!eff.type) {
          issues.push({ scene: id, field: `${tag}.type`, problem: 'missing' });
        } else if (!VALID_EFFECTS.has(eff.type)) {
          issues.push({ scene: id, field: tag, problem: `unknown effect type '${eff.type}', expected one of: ${[...VALID_EFFECTS].join(', ')}` });
        }
      }
    }
  }

  return issues;
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const slugArg = args.find(a => a.startsWith('--slug='))?.slice('--slug='.length);

  let slugs: string[];
  if (all) {
    slugs = readdirSync(MANIFESTS_DIR)
      .filter(n => n.endsWith('.json'))
      .map(n => n.replace(/\.json$/, ''));
  } else if (slugArg) {
    slugs = [slugArg];
  } else {
    console.error('Usage: verify-manifest.ts --slug=<slug> | --all');
    process.exit(2);
  }

  let totalIssues = 0;
  for (const slug of slugs) {
    const issues = verify(slug);
    if (issues.length === 0) {
      console.log(`[verify] ${slug}: OK — manifest passes all Phase 10 contract checks`);
    } else {
      console.log(`[verify] ${slug}: ${issues.length} issue(s):`);
      for (const issue of issues) {
        console.log(`         · ${issue.scene} → ${issue.field}: ${issue.problem}`);
      }
      totalIssues += issues.length;
    }
  }

  process.exit(totalIssues === 0 ? 0 : 1);
}

main();
