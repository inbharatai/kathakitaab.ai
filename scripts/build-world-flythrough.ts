// ============================================================
// scripts/build-world-flythrough.ts
//
// Synthesizes a WorldManifest for a given book slug and builds a
// flythrough manifest JSON that the Remotion WorldFlythrough
// composition consumes. Per-node narration audio is optionally
// pre-rendered via /api/livebook/tts — ONLY when:
//   KATHA_DIALOGUE_TTS_ENABLED=1  AND  a TTS key is configured.
// No-key → narration text-only (no audioPath), the composition
// shows the text card without audio.
//
// Mirrors the gating pattern from build-book-video.ts.
//
// Run after `next dev` is up on :5009:
//   npx tsx scripts/build-world-flythrough.ts --slug=ramayana
// ============================================================

import './_loadEnv';

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { putObject } from '../lib/storage/s3Storage';
import { synthesizeWorldManifest } from '../lib/world/worldManifest';
import type { WorldManifest, WorldNode, WorldIdentity } from '../lib/world/worldManifest';
import type { FlythroughNode, WorldFlythroughManifest } from '../remotion/WorldFlythrough';
import type { Book, Scene, Character } from '../lib/types/livebook';

const MANIFESTS_DIR = join(process.cwd(), 'remotion', 'manifests');
const BASE = process.env.MOVIE_BUILD_BASE || 'http://localhost:5009';

function parseSlugArg(): string {
  const fromArg = process.argv.slice(2).find(a => a.startsWith('--slug='));
  if (fromArg) return fromArg.slice('--slug='.length);
  const positional = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (positional) return positional;
  throw new Error('book slug required: pass --slug=<slug> or as the first positional arg');
}

function isTtsEnabled(): boolean {
  return process.env.KATHA_DIALOGUE_TTS_ENABLED === '1' &&
    (!!process.env.OPENAI_API_KEY || !!process.env.SARVAM_API_KEY || !!process.env.GEMINI_API_KEY);
}

interface BookPayload {
  book: { slug: string; title: string; worldIdentity?: WorldIdentity; language?: string };
  scenes: Array<{ scene_id: string; title: string; narration: string; short_summary: string; background_asset_url: string }>;
  characters: Array<{ slug: string }>;
}

async function fetchBook(slug: string): Promise<BookPayload> {
  const res = await fetch(`${BASE}/api/books/${slug}`);
  if (!res.ok) throw new Error(`/api/books/${slug} → ${res.status}`);
  return (await res.json()) as BookPayload;
}

/** Narration text for a node = the deliver_fragment mission's
 *  fragmentText, or the scene's short_summary as fallback. */
function narrationForNode(node: WorldNode): string {
  const frag = node.missions.find(m => m.kind === 'deliver_fragment');
  return frag?.fragmentText ?? node.title;
}

/** Duration in frames: ~1 frame per 30 chars of narration, clamped
 *  to [60, 240]. Falls back to 90 when no narration. */
function framesForNode(narration: string): number {
  if (!narration) return 90;
  const est = Math.ceil(narration.length / 30) * 10; // ~3 chars/frame at 30fps
  return Math.max(60, Math.min(240, est));
}

async function renderTtsForNode(
  slug: string,
  nodeId: string,
  narration: string,
): Promise<string | null> {
  if (!isTtsEnabled() || !narration) return null;
  try {
    const res = await fetch(`${BASE}/api/livebook/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: narration.slice(0, 1450), voice: 'narration', language: 'en' }),
    });
    if (!res.ok) {
      console.warn(`[world-flythrough] TTS for ${nodeId} → ${res.status}, text-only fallback`);
      return null;
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('audio/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = buf.subarray(0, 4).toString('ascii') === 'RIFF' ? 'wav' : 'mp3';
    const remoteName = `${nodeId}.${ext}`;
    const key = `${slug}/world-flythrough/${remoteName}`;
    const contentType = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
    const result = await putObject(key, buf, contentType);
    if (!result) {
      console.warn(`[world-flythrough] S3 upload failed for ${nodeId}, text-only fallback`);
      return null;
    }
    return result.url;
  } catch (err) {
    console.warn(`[world-flythrough] TTS error for ${nodeId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function main() {
  const slug = parseSlugArg();
  mkdirSync(MANIFESTS_DIR, { recursive: true });

  console.log(`[world-flythrough] slug: ${slug} | base: ${BASE} | tts=${isTtsEnabled() ? 'ON' : 'OFF'}`);

  const payload = await fetchBook(slug);
  console.log(`[world-flythrough] ${payload.scenes.length} scenes, ${payload.characters.length} characters`);

  // Synthesize the WorldManifest (pure code, deterministic). Pass the
  // book's worldIdentity (opt-in LLM override) so the flythrough reads
  // FROM the story when present; absent → universal lexicon.
  // The /api/books/[slug] payload is a structural subset; cast through
  // `unknown` to the synthesizer's full Book/Scene/Character types rather
  // than `any` (the synthesizer only reads the fields the API guarantees).
  const world = synthesizeWorldManifest(
    payload.book as unknown as Book,
    payload.scenes as unknown as Scene[],
    payload.characters as unknown as Character[],
    undefined,
    payload.book.worldIdentity,
  );
  console.log(`[world-flythrough] world synthesized: ${world.nodes.length} nodes, ${world.paths.length} paths`);

  const flyNodes: FlythroughNode[] = [];
  for (const node of world.nodes) {
    const narration = narrationForNode(node);
    const durationInFrames = framesForNode(narration);
    let narrationAudioUrl: string | null = null;

    if (isTtsEnabled()) {
      console.log(`[world-flythrough]   TTS: ${node.id} (${narration.length} chars)`);
      narrationAudioUrl = await renderTtsForNode(slug, node.id, narration);
    } else {
      console.log(`[world-flythrough]   text-only: ${node.id}`);
    }

    flyNodes.push({
      nodeId: node.id,
      narration,
      narrationAudioUrl,
      durationInFrames,
      mood: node.mood,
    });
  }

  const manifest: WorldFlythroughManifest = {
    bookSlug: slug,
    bookTitle: payload.book.title,
    nodes: flyNodes,
    world,
  };

  const outPath = join(MANIFESTS_DIR, `world-${slug}.json`);
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[world-flythrough] manifest written: ${outPath}`);
  console.log(`[world-flythrough] ${flyNodes.filter(n => n.narrationAudioUrl).length}/${flyNodes.length} nodes have narration audio`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});