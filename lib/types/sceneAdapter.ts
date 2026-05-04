// ============================================================
// KathaKitaab.ai — Scene Adapter
//
// Converts the existing Scene/SceneWithHotspots/Hotspot types
// into the new StoryScene contract. This ensures backward
// compatibility — all seed data and generated books continue
// to work with the new layered renderer.
// ============================================================

import { SceneWithHotspots, Hotspot, Character } from './livebook';
import {
  StoryScene,
  SceneCharacter,
  SceneObject,
  SceneHotspot,
  CharacterAnimation,
  ObjectAnimation,
  CharacterClickAction,
  ObjectClickAction,
  HotspotClickAction,
  HotspotTargetType,
} from './storyScene';

// ── Gradient fallbacks (from SceneBackground.tsx) ────────────

const SCENE_GRADIENTS: Record<string, string> = {
  ayodhya_intro: 'linear-gradient(135deg, #2A1810 0%, #8B4513 30%, #D4A847 60%, #E8832A 80%, #2A1810 100%)',
  mithila_bow: 'linear-gradient(135deg, #1A0E0A 0%, #6B1D3A 30%, #D4A847 50%, #F0D78C 70%, #1A0E0A 100%)',
  exile: 'linear-gradient(135deg, #2A1810 0%, #4A3728 40%, #8B7355 60%, #5D6B3D 80%, #1A0E0A 100%)',
  forest_life: 'linear-gradient(135deg, #0D2818 0%, #2E5B2E 30%, #5D6B3D 50%, #8B7355 70%, #1A3A1A 100%)',
  ravana_jatayu: 'linear-gradient(135deg, #1A0E0A 0%, #4A1C2E 30%, #8B2252 50%, #E8832A 70%, #1A0E0A 100%)',
  hanuman_meets_rama: 'linear-gradient(135deg, #1A2A0A 0%, #4A6B28 30%, #8B7355 50%, #D4A847 70%, #1A0E0A 100%)',
  hanuman_lanka: 'linear-gradient(135deg, #0A1A2A 0%, #2A4A6A 30%, #E8832A 50%, #D4A847 70%, #0A1A2A 100%)',
  bridge_to_lanka: 'linear-gradient(135deg, #0A1A2A 0%, #1A3A5A 30%, #4A8AB8 50%, #D4A847 70%, #0A1A2A 100%)',
  battle_lanka: 'linear-gradient(135deg, #1A0A0A 0%, #6B1D1D 30%, #E8832A 50%, #8B2252 70%, #1A0A0A 100%)',
  return_ayodhya: 'linear-gradient(135deg, #1A0E0A 0%, #D4A847 30%, #F5A623 50%, #E8832A 70%, #D4A847 100%)',
  lessons: 'linear-gradient(135deg, #1A0E0A 0%, #6B1D3A 25%, #D4A847 50%, #2E8B57 75%, #1A0E0A 100%)',
  closing: 'radial-gradient(circle at center, #D4A847 0%, #E8832A 25%, #6B1D3A 50%, #1A0E0A 100%)',
};

// ── Convert old Hotspot → new SceneCharacter / SceneObject / SceneHotspot ──

function hotspotToCharacter(h: Hotspot, characters?: Character[]): SceneCharacter {
  const char = characters?.find(c => c.slug === h.target_id);
  return {
    id: h.target_id,
    name: h.label,
    x: h.x,
    y: h.y,
    width: h.width,
    height: h.height,
    image_url: char?.image_url ?? null,
    pose: 'standing',
    mood: 'neutral',
    animation: 'idle' as CharacterAnimation,
    click_actions: ['talk', 'move', 'change', 'continue'] as CharacterClickAction[],
    character_slug: h.target_id,
  };
}

function hotspotToObject(h: Hotspot): SceneObject {
  return {
    id: h.target_id,
    label: h.label,
    x: h.x,
    y: h.y,
    width: h.width,
    height: h.height,
    image_url: null,
    state: 'default',
    animation: 'none' as ObjectAnimation,
    click_actions: ['ask', 'inspect', 'change', 'animate', 'continue'] as ObjectClickAction[],
  };
}

function hotspotToSceneHotspot(h: Hotspot): SceneHotspot {
  const typeMap: Record<string, HotspotTargetType> = {
    character: 'character',
    object: 'object',
    place: 'place',
    event: 'background',
  };

  const actionsMap: Record<string, HotspotClickAction[]> = {
    character: ['talk', 'move', 'change', 'continue'],
    object: ['ask', 'inspect', 'change', 'animate', 'continue'],
    place: ['ask', 'change', 'continue'],
    event: ['ask', 'change', 'continue'],
  };

  return {
    id: h.id,
    target_id: h.target_id,
    label: h.label,
    type: typeMap[h.hotspot_type] ?? 'background',
    x: h.x,
    y: h.y,
    width: h.width,
    height: h.height,
    allowed_actions: actionsMap[h.hotspot_type] ?? ['ask', 'continue'],
    tooltip: h.tooltip,
    quick_speak: h.quick_speak,
    character_image_url: h.character_image_url,
  };
}

// ── Main Adapter ─────────────────────────────────────────────

export function sceneToStoryScene(
  scene: SceneWithHotspots,
  characters?: Character[],
): StoryScene {
  const hotspots = scene.hotspots ?? [];

  // Split hotspots into character vs object/place based on type
  const characterHotspots = hotspots.filter(h => h.hotspot_type === 'character');
  const objectHotspots = hotspots.filter(h => h.hotspot_type === 'object' || h.hotspot_type === 'place');

  // Deduplicate characters by target_id (same character may appear in multiple hotspots)
  const seenCharIds = new Set<string>();
  const sceneCharacters: SceneCharacter[] = [];
  for (const h of characterHotspots) {
    if (!seenCharIds.has(h.target_id)) {
      seenCharIds.add(h.target_id);
      sceneCharacters.push(hotspotToCharacter(h, characters));
    }
  }

  // Convert objects/places
  const sceneObjects = objectHotspots.map(hotspotToObject);

  // All hotspots become SceneHotspots (the overlay layer)
  const sceneHotspots = hotspots.map(hotspotToSceneHotspot);

  return {
    scene_id: scene.scene_id,
    story_id: scene.book_id,
    page_title: scene.title,
    story_text: scene.narration,

    background: {
      image_url: scene.background_asset_url || null,
      prompt: scene.visual_description,
      fallback_gradient: SCENE_GRADIENTS[scene.scene_id] ?? 'linear-gradient(135deg, #1A0E0A 0%, #2A1810 100%)',
    },

    characters: sceneCharacters,
    objects: sceneObjects,
    effects: [],
    hotspots: sceneHotspots,

    choices: [],

    world_state: {},
    previous_actions: [],

    safety_rating: 'child_safe',

    learning_points: scene.learning_points ?? [],
    source_notes: scene.source_notes ?? '',
    order_index: scene.order_index,
    previous_scene_id: scene.previous_scene_id,
    next_scene_id: scene.next_scene_id,
    visual_description: scene.visual_description,
    quiz_questions: (scene.quiz_questions ?? []).map(q => ({
      id: q.id,
      question: q.question,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
    })),
  };
}

// ── Convert StoryScene hotspots back to old Hotspot format ──
// Useful when passing to existing components that expect old types

export function storySceneHotspotToLegacy(h: SceneHotspot, sceneId: string): Hotspot {
  const typeMap: Record<string, 'character' | 'object' | 'place' | 'event'> = {
    character: 'character',
    object: 'object',
    place: 'place',
    background: 'event',
  };

  const targetTypeMap: Record<string, 'character' | 'scene' | 'info'> = {
    character: 'character',
    object: 'info',
    place: 'info',
    background: 'info',
  };

  return {
    id: h.id,
    scene_id: sceneId,
    label: h.label,
    hotspot_type: typeMap[h.type] ?? 'event',
    target_type: targetTypeMap[h.type] ?? 'info',
    target_id: h.target_id,
    x: h.x,
    y: h.y,
    width: h.width,
    height: h.height,
    tooltip: h.tooltip ?? h.label,
    action: h.type === 'character' ? 'open_character' : 'open_info',
    quick_speak: h.quick_speak,
    character_image_url: h.character_image_url,
    created_at: new Date().toISOString(),
  };
}
