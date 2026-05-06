// ============================================================
// KathaKitaab.ai — SceneStream Manifest API
// GET /api/livebook/scene-stream/[sceneId]?bookSlug=ramayana
//
// The single read endpoint a live reader needs. Returns the full
// scene manifest the renderer can drive on:
//
//   - scene visuals (image URL, mood, theme, narration)
//   - entity hotspots with coordinates + bounding boxes
//   - per-entity action menus, each tagged 'ready' / 'pending' / 'none'
//     so the UI can render warm verbs as instant taps and pending
//     verbs as loading affordances
//   - prev/next scene IDs for the in-page navigator
//
// This collapses what was three round-trips (scene fetch + canon
// lookup + branch warming probe) into one read. The manifest is
// also the contract Phase E (SSE) and Phase G (movie export) build
// against — every consumer reads the same shape.
// ============================================================

import { NextResponse } from 'next/server';
import { getSceneWithHotspots } from '@/lib/data/ramayanaSeed';
import { getScene } from '@/lib/data/bookRegistry';
import { getCanonEntry } from '@/lib/data/canonLookup';
import { getCachedBranch, getPregenActions, type PreGeneratedBranch } from '@/lib/engine/branchPreGenerator';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

// ── Manifest shape ───────────────────────────────────────────

export interface EntityAction {
  /** Lowercased verb the user can click (talk, fight, leap, …). */
  verb: string;
  /** 'ready' = warmed branch in cache, 'pending' = canon-allowed but
   *  not yet warmed, 'none' = no canon entry, action is generic. */
  status: 'ready' | 'pending' | 'none';
  /** Pre-rendered branch title for ready actions, so the UI can
   *  preview "Talk to Rama → 'Dharma calls me to act…'" without
   *  paying for a separate fetch. */
  preview?: string;
}

export interface ManifestEntity {
  entityId: string;
  label: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** One-line in-character flavor text from the seed, displayed
   *  on hover before the user commits to an action. */
  quickSpeak?: string;
  /** Action menu — what verbs apply to this entity, with cache
   *  status. `null` if canon doesn't list the entity (the renderer
   *  falls back to a generic verb based on `type`). */
  actions: EntityAction[];
}

export interface SceneStreamManifest {
  sceneId: string;
  bookSlug: string;
  title: string;
  narration: string;
  visualDescription: string;
  imageUrl: string;
  mood: string;
  /** Universal narrative axis (e.g. "exile", "battle"). Used by
   *  generate-scene, image generation, and music ducking cues so
   *  the same theme yields a coherent multi-modal experience. */
  theme: string;
  entities: ManifestEntity[];
  prevSceneId: string | null;
  nextSceneId: string | null;
  /** 'static' = pulled from a curated seed (e.g. ramayana), 'brain'
   *  = AI-generated. UIs may show a "verified source" badge for
   *  static and an "AI interpretation" badge for brain. */
  source: 'static' | 'brain';
  generatedAt: number;
}

// ── Handler ──────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sceneId: string }> },
) {
  const limited = await checkRateLimit(request, { scope: 'default' });
  if (limited) return limited;

  const { sceneId } = await params;
  const url = new URL(request.url);
  const bookSlug = url.searchParams.get('bookSlug') ?? '';

  if (!bookSlug) {
    return NextResponse.json(
      { error: 'bookSlug query parameter is required' },
      { status: 400 },
    );
  }

  // Resolve scene from the static seed first — that's the authoritative
  // path for ramayana, mahabharata, etc. AI-generated books fall through
  // to the per-book registry. Brain-generated scenes are not exposed via
  // this endpoint yet (they don't have a stable sceneId in the seed).
  const scene = resolveScene(bookSlug, sceneId);
  if (!scene) {
    return NextResponse.json(
      { error: `Scene not found: ${sceneId} in book ${bookSlug}` },
      { status: 404 },
    );
  }

  const entities = await Promise.all(
    scene.hotspots.map(h => buildManifestEntity(bookSlug, sceneId, h)),
  );

  const manifest: SceneStreamManifest = {
    sceneId,
    bookSlug,
    title: scene.title,
    narration: scene.narration,
    visualDescription: scene.visualDescription,
    imageUrl: scene.backgroundAssetUrl,
    mood: deriveMood(scene.shortSummary, scene.title),
    theme: deriveTheme(sceneId, scene.title),
    entities,
    prevSceneId: scene.previousSceneId,
    nextSceneId: scene.nextSceneId,
    source: 'static',
    generatedAt: Date.now(),
  };

  return NextResponse.json(manifest);
}

// ── Helpers ──────────────────────────────────────────────────

// Internal shape both seed scenes (SceneWithHotspots) and registry
// scenes (GeneratedScene) collapse into. Normalizing at the boundary
// keeps the rest of the file independent of which source the scene
// came from.
interface NormalizedScene {
  title: string;
  narration: string;
  visualDescription: string;
  backgroundAssetUrl: string;
  shortSummary: string;
  previousSceneId: string | null;
  nextSceneId: string | null;
  hotspots: NormalizedHotspot[];
}

interface NormalizedHotspot {
  label: string;
  type: string;
  targetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  quickSpeak?: string;
}

function resolveScene(bookSlug: string, sceneId: string): NormalizedScene | null {
  if (bookSlug === 'ramayana') {
    const scene = getSceneWithHotspots(sceneId);
    if (scene) {
      return {
        title: scene.title,
        narration: scene.narration,
        visualDescription: scene.visual_description,
        backgroundAssetUrl: scene.background_asset_url || '',
        shortSummary: scene.short_summary,
        previousSceneId: scene.previous_scene_id,
        nextSceneId: scene.next_scene_id,
        hotspots: scene.hotspots.map(h => ({
          label: h.label,
          type: h.hotspot_type,
          targetId: h.target_id,
          x: h.x, y: h.y, width: h.width, height: h.height,
          quickSpeak: h.quick_speak,
        })),
      };
    }
  }
  const generic = getScene(bookSlug, sceneId);
  if (!generic) return null;
  return {
    title: generic.title,
    narration: generic.narration,
    visualDescription: generic.visual_description,
    backgroundAssetUrl: generic.background_asset_url || '',
    shortSummary: generic.short_summary,
    previousSceneId: generic.previous_scene_id,
    nextSceneId: generic.next_scene_id,
    hotspots: (generic.hotspots ?? []).map(h => ({
      label: h.label,
      type: h.hotspot_type,
      targetId: h.target_id,
      x: h.x, y: h.y, width: h.width, height: h.height,
      quickSpeak: h.quick_speak,
    })),
  };
}

async function buildManifestEntity(
  bookSlug: string,
  sceneId: string,
  hotspot: NormalizedHotspot,
): Promise<ManifestEntity> {
  // The hotspot's target_id is what we cache branches under. Look up
  // the entity's canon entry so we know which verbs are valid here.
  const canon = getCanonEntry(bookSlug, hotspot.targetId);
  const verbs = canon?.allowed_actions
    ? canon.allowed_actions.map(a => a.toLowerCase()).filter(a => !NAV_VERBS.has(a))
    : getPregenActions(bookSlug, hotspot.targetId, hotspot.type);

  const actions: EntityAction[] = await Promise.all(
    verbs.map(async verb => {
      const branch = await getCachedBranch(sceneId, hotspot.targetId, verb);
      return makeAction(verb, branch, !!canon);
    }),
  );

  return {
    entityId: hotspot.targetId,
    label: hotspot.label,
    type: hotspot.type,
    x: hotspot.x,
    y: hotspot.y,
    width: hotspot.width,
    height: hotspot.height,
    quickSpeak: hotspot.quickSpeak,
    actions,
  };
}

const NAV_VERBS = new Set(['continue', 'next', 'back']);

function makeAction(
  verb: string,
  branch: PreGeneratedBranch | null,
  hasCanon: boolean,
): EntityAction {
  if (branch && branch.status === 'ready' && branch.narration) {
    return { verb, status: 'ready', preview: branch.title };
  }
  return { verb, status: hasCanon ? 'pending' : 'none' };
}

// Mood/theme derivation is intentionally deterministic and lightweight
// — no LLM call. The manifest is read on every scene load and we want
// it to be cheap. A future Phase B+ task can enrich these from brain
// metadata if a brain-generated manifest is available.
function deriveMood(summary: string, title: string): string {
  const s = (summary + ' ' + title).toLowerCase();
  if (/(battle|war|fight|kill|abduct)/.test(s)) return 'dramatic';
  if (/(forest|exile|sorrow|farewell|grief)/.test(s)) return 'somber';
  if (/(palace|crown|return|coronation|reunion)/.test(s)) return 'joyful';
  if (/(temple|prayer|sage|wisdom|sacred)/.test(s)) return 'sacred';
  if (/(magic|enchant|illusion|hidden)/.test(s)) return 'mysterious';
  return 'serene';
}

function deriveTheme(sceneId: string, title: string): string {
  const s = (sceneId + ' ' + title).toLowerCase();
  if (s.includes('exile')) return 'exile';
  if (s.includes('battle') || s.includes('war')) return 'battle';
  if (s.includes('return') || s.includes('coronation')) return 'return';
  if (s.includes('forest')) return 'forest';
  if (s.includes('lanka')) return 'siege';
  if (s.includes('hanuman')) return 'devotion';
  if (s.includes('lessons')) return 'reflection';
  return 'introduction';
}
