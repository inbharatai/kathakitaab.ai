// ============================================================
// Kathakitab.ai — Core LiveBook Type Definitions
// ============================================================

// ---- Book ----
export interface Book {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  status: 'draft' | 'mvp' | 'published';
  cover_image_url: string;
  created_at: string;
  updated_at: string;
}

// ---- Book Source ----
export interface BookSource {
  id: string;
  book_id: string;
  source_type: 'text' | 'scripture' | 'commentary' | 'academic';
  title: string;
  url: string;
  citation_note: string;
  public_domain_status: boolean;
  created_at: string;
}

// ---- Scene ----
export interface Scene {
  id: string;
  book_id: string;
  scene_id: string;
  title: string;
  order_index: number;
  narration: string;
  short_summary: string;
  visual_description: string;
  background_asset_url: string;
  previous_scene_id: string | null;
  next_scene_id: string | null;
  mode: 'story' | 'learn' | 'quiz';
  learning_points: string[];
  quiz_questions: QuizQuestion[];
  source_notes: string;
  created_at: string;
  updated_at: string;
}

// ---- Hotspot ----
export type HotspotType = 'character' | 'object' | 'place' | 'event';
export type HotspotAction = 'open_character' | 'open_scene' | 'open_info' | 'open_learning';

export interface Hotspot {
  id: string;
  scene_id: string;
  label: string;
  hotspot_type: HotspotType;
  target_type: 'character' | 'scene' | 'info';
  target_id: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width: number; // percentage
  height: number; // percentage
  tooltip: string;
  action: HotspotAction;
  character_image_url?: string;
  /** One-line in-character phrase shown as a speech bubble on hover */
  quick_speak?: string;
  created_at: string;
}

// ---- Character Bible ----
export interface CharacterBible {
  canonical_identity: string;
  role: string;
  traits: string[];
  relationships: Record<string, string>;
  speech_tone: string;
  visual_description: string;
  clothing_style: string;
  color_palette: string[];
  emotional_range: string[];
  forbidden_changes: string[];
  source_notes: string;
}

// ---- Character ----
export interface Character {
  id: string;
  book_id: string;
  slug: string;
  name: string;
  role: string;
  short_summary: string;
  traits: string[];
  relationships: Record<string, string>;
  character_bible: CharacterBible;
  source_notes: string;
  talk_examples: string[];
  image_url?: string;
  created_at: string;
  updated_at: string;
}

// ---- Character Asset ----
export interface CharacterAsset {
  id: string;
  character_id: string;
  asset_type: 'portrait' | 'full_body' | 'icon' | 'scene_variant';
  asset_url: string;
  visual_prompt: string;
  is_master_reference: boolean;
  generation_model: string;
  consistency_notes: string;
  created_at: string;
}

// ---- Scene Asset ----
export interface SceneAsset {
  id: string;
  scene_id: string;
  asset_type: 'background' | 'overlay' | 'illustration';
  asset_url: string;
  visual_prompt: string;
  generation_model: string;
  created_at: string;
}

// ---- Source Reference ----
export interface SourceReference {
  id: string;
  book_id: string;
  scene_id?: string;
  character_id?: string;
  reference_title: string;
  reference_url: string;
  reference_note: string;
  created_at: string;
}

// ---- Quiz ----
export interface QuizQuestion {
  id: string;
  scene_id: string;
  question: string;
  options: string[];
  correct_answer: number; // index of correct option
  explanation: string;
  created_at: string;
}

// ---- AI Response ----
export type AnswerLabel = 'CANON' | 'EXPLANATION' | 'INTERPRETATION' | 'CREATIVE';

export interface AskCharacterRequest {
  bookSlug: string;
  sceneId: string;
  characterSlug: string;
  question: string;
  mode: 'canon' | 'explanation' | 'interpretation' | 'creative';
}

export interface AskCharacterResponse {
  label: AnswerLabel;
  answer: string;
  source_note: string;
  next_options: string[];
  safety_note: string;
}

// ---- Generated Response (DB) ----
export interface GeneratedResponse {
  id: string;
  book_id: string;
  scene_id?: string;
  character_id?: string;
  user_question: string;
  ai_answer: string;
  answer_label: AnswerLabel;
  source_note: string;
  model_used: string;
  cached_key: string;
  created_at: string;
}

// ---- User Progress ----
export interface UserProgress {
  id: string;
  user_id?: string;
  book_id: string;
  current_scene_id: string;
  completed_scenes: string[];
  quiz_scores: Record<string, number>;
  created_at: string;
  updated_at: string;
}

// ---- Scene with Hotspots (joined) ----
export interface SceneWithHotspots extends Scene {
  hotspots: Hotspot[];
}

// ---- Book with Scenes (joined) ----
export interface BookWithScenes extends Book {
  scenes: Scene[];
  characters: Character[];
}

// ---- Quiz Answer Request ----
export interface QuizAnswerRequest {
  quizId: string;
  sceneId: string;
  selectedAnswer: number;
}

export interface QuizAnswerResponse {
  correct: boolean;
  correctAnswer: number;
  explanation: string;
}

// ---- Feature Flags ----
export interface FeatureFlags {
  ENABLE_IMAGE_GENERATION: boolean;
  ENABLE_CREATIVE_MODE: boolean;
  ENABLE_TTS: boolean;
  ENABLE_VOICE_INPUT: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  ENABLE_IMAGE_GENERATION: false,
  ENABLE_CREATIVE_MODE: false,
  ENABLE_TTS: false,
  ENABLE_VOICE_INPUT: false,
};
