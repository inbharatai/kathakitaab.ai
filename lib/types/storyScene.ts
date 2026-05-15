// ============================================================
// KathaKitaab — Live StoryScene Contract
//
// This is the core data model for the live scene engine.
// Every scene is a composable set of layers:
//   background + characters + objects + effects + hotspots
//
// The old flat Scene type is preserved and adapted into this
// via sceneAdapter.ts — no breaking changes.
// ============================================================

// ── Animation ────────────────────────────────────────────────

export type CharacterAnimation =
  | 'idle'
  | 'breathe'
  | 'blink'
  | 'walk'
  | 'glow'
  | 'none';

export type ObjectAnimation =
  | 'glow'
  | 'sway'
  | 'flicker'
  | 'float'
  | 'none';

export type EffectAnimation =
  | 'particles'
  | 'shimmer'
  | 'rain'
  | 'fire'
  | 'smoke'
  | 'glow'
  | 'none';

// ── Click Actions ────────────────────────────────────────────

// Base actions that exist for any book. The role-locked extensions
// below are universal too — any tradition with warrior/antagonist/
// witness archetypes can use them. Canon entries pick which subset is
// valid for a given character via `allowed_actions`.
export type CharacterClickAction =
  | 'talk' | 'move' | 'change' | 'continue'
  | 'leap' | 'fight' | 'confront' | 'observe'
  | 'comfort' | 'guard' | 'counsel' | 'ally' | 'learn'
  | 'petition' | 'honor' | 'follow';
export type ObjectClickAction = 'ask' | 'inspect' | 'change' | 'animate' | 'continue';
export type HotspotClickAction =
  | 'ask' | 'talk' | 'inspect' | 'move' | 'change' | 'animate' | 'continue'
  | 'leap' | 'fight' | 'confront' | 'observe'
  | 'comfort' | 'guard' | 'counsel' | 'ally' | 'learn'
  | 'petition' | 'honor' | 'follow';

// ── Safety ───────────────────────────────────────────────────

export type SafetyRating = 'child_safe' | 'teen_safe' | 'blocked';

// ── Background Layer ─────────────────────────────────────────

export interface SceneBackground {
  image_url: string | null;
  prompt: string;
  /** Fallback CSS gradient if image is not available */
  fallback_gradient?: string;
  /** Optional multi-beat visual track. When present, the live reader
   *  cross-fades between these images during narration instead of
   *  holding on `image_url` for the whole scene. The first beat
   *  matches `image_url` (the establishing shot); subsequent beats
   *  fade in at evenly-spaced intervals across the narration window.
   *  Backwards-compat: when missing, the reader behaves as before. */
  beats?: { image_url: string; prompt: string }[];
}

// ── Character Layer ──────────────────────────────────────────

export interface SceneCharacter {
  id: string;
  name: string;
  /** Position as percentage (0-100) of the scene canvas */
  x: number;
  y: number;
  width: number;
  height: number;
  /** URL to character layer image (can be null if not yet generated) */
  image_url: string | null;
  pose: string;
  mood: string;
  animation: CharacterAnimation;
  click_actions: CharacterClickAction[];
  /** Slug linking to the Character data in the existing system */
  character_slug?: string;
}

// ── Object Layer ─────────────────────────────────────────────

export interface SceneObject {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image_url: string | null;
  state: string;
  animation: ObjectAnimation;
  click_actions: ObjectClickAction[];
}

// ── Effect Layer ─────────────────────────────────────────────

export interface SceneEffect {
  id: string;
  label: string;
  type: EffectAnimation;
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number; // 0-1
  color?: string;
}

// ── Hotspot (interactive overlay zone) ───────────────────────

export type HotspotTargetType = 'character' | 'object' | 'place' | 'background';

export interface SceneHotspot {
  id: string;
  /** ID of the character or object this hotspot targets */
  target_id: string;
  label: string;
  type: HotspotTargetType;
  x: number;
  y: number;
  width: number;
  height: number;
  allowed_actions: HotspotClickAction[];
  /** Optional tooltip shown on hover */
  tooltip?: string;
  /** Quick one-liner shown on hover (for characters) */
  quick_speak?: string;
  /** Link to character image for drawer */
  character_image_url?: string;
}

// ── Story Choice ─────────────────────────────────────────────

export interface SceneChoice {
  label: string;
  action: string;
  /** Optional icon emoji */
  icon?: string;
}

// ── Previous Action Log ──────────────────────────────────────

export interface PreviousAction {
  action_type: string;
  target_id: string;
  target_label: string;
  result_summary: string;
  timestamp: number;
}

// ── The Full StoryScene Contract ─────────────────────────────

export interface StoryScene {
  scene_id: string;
  story_id: string;
  page_title: string;
  story_text: string;

  background: SceneBackground;

  characters: SceneCharacter[];
  objects: SceneObject[];
  effects: SceneEffect[];
  hotspots: SceneHotspot[];

  choices: SceneChoice[];

  /** Arbitrary world state for this scene (flags, NPC states, etc.) */
  world_state: Record<string, unknown>;

  /** Log of actions the user has taken in this scene */
  previous_actions: PreviousAction[];

  safety_rating: SafetyRating;

  // ── Metadata from the original Scene ──

  /** Learning points for educational mode */
  learning_points: string[];
  /** Source attribution */
  source_notes: string;
  /** Scene ordering */
  order_index: number;
  /** Navigation */
  previous_scene_id: string | null;
  next_scene_id: string | null;
  /** Visual description for image generation prompts */
  visual_description: string;
  /** Quiz questions attached to this scene */
  quiz_questions: Array<{
    id: string;
    question: string;
    options: string[];
    correct_answer: number;
    explanation: string;
  }>;

  /**
   * True when the scene was generated WITHOUT successful web/source
   * grounding. Seeded canonical scenes are always false.
   * The UI surfaces a small badge so the reader knows the scene
   * is an AI interpretation rather than verified canon.
   */
  unverified?: boolean;
  /** Human-readable explanation of why a scene is unverified. */
  verification_note?: string;

  /** Comic-book overlay track. Only consumed by the renderer when
   *  `style_preset === 'comic_book'`; other presets ignore it and
   *  use the bottom subtitle bar. Optional — missing on legacy
   *  books until the dialogue tagger runs. */
  dialogue?: Array<{
    speaker: string;
    text: string;
    kind?: 'speech' | 'thought' | 'caption' | 'shout';
  }>;
  /** Style preset the parent book was generated under. Drives which
   *  text-display layer the canvas mounts (subtitle bar vs comic
   *  bubbles). Missing → renderer treats as 'photoreal_cinematic'
   *  for visual contract, never as comic. */
  style_preset?: 'photoreal_cinematic' | 'storybook_watercolor' | 'cinematic_animation' | 'comic_book';
}

// ── Visual Bible (consistency across scenes) ─────────────────

export interface BookVisualBible {
  art_style: string;
  character_descriptions: Record<string, string>;
  color_palette: string[];
  lighting_style: string;
}

// ── Scene State (mutable at runtime) ─────────────────────────
// This is the live state that changes as the user interacts.

export interface SceneState {
  scene_id: string;
  /** Current story text (may differ from initial after interactions) */
  current_text: string;
  /** Updated character states */
  characters: Map<string, Partial<SceneCharacter>>;
  /** Updated object states */
  objects: Map<string, Partial<SceneObject>>;
  /** Active effects */
  active_effects: string[];
  /** Actions taken this session */
  action_history: PreviousAction[];
  /** Whether a major scene transition is needed */
  needs_regeneration: boolean;
}

export function createInitialSceneState(scene: StoryScene): SceneState {
  return {
    scene_id: scene.scene_id,
    current_text: scene.story_text,
    characters: new Map(),
    objects: new Map(),
    active_effects: scene.effects.map(e => e.id),
    action_history: [],
    needs_regeneration: false,
  };
}
