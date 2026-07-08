// ============================================================
// Kathakitab.ai — Core LiveBook Type Definitions
// ============================================================

// ---- Book ----
export type AccuracyLabel = 'CANONICAL' | 'CREATIVE_RETELLING' | 'EDUCATIONAL_SUMMARY' | 'UNVERIFIED';

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
  /** Canon accuracy label — AI-generated books are 'CREATIVE_RETELLING' by default;
   *  static canon books are 'CANONICAL'. */
  accuracyLabel?: AccuracyLabel;
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
  /** AI-generated books only — S3/CloudFront URL for pre-rendered
   *  scene narration. When present, the live reader streams it directly
   *  instead of round-tripping through /api/livebook/tts. */
  narration_audio_url?: string;
  /** Cinematic multi-beat track. Each beat is a distinct shot the
   *  movie engine cross-fades through with its own camera motion.
   *  When present the live reader + movie play this sequence; when
   *  absent both fall back to background_asset_url as a single beat. */
  beats?: SceneBeat[];
  /** Scene-level visual rules: characters physically present in this scene.
   *  Used to ensure image prompts only show characters who belong. */
  characters_present?: string[];
  /** Scene-level visual rules: main characters who are NOT physically
   *  present (absent, kidnapped, dead, off-screen). Used to build
   *  negative constraints in image prompts. */
  characters_absent?: string[];
  /** Comic-book overlay track — speech bubbles, thought clouds, and
   *  narrator captions anchored to character hotspots. Only rendered
   *  when the book's stylePreset is 'comic_book'; other presets keep
   *  the bottom subtitle bar driven by planSubtitles(). Lines play
   *  in order, one at a time, timed to the sentence cues derived
   *  from narration. Empty / absent on legacy books — the dialogue
   *  tagger backfills it on the next comic-style regeneration. */
  dialogue?: SceneDialogue[];
}

// ---- Scene dialogue ----
/** A single beat of in-frame dialogue or narration overlay used by
 *  the Comic Book style preset. Universal across all books — the
 *  outline prompt emits it for new generations, dialogueTagger
 *  backfills it for legacy books. */
export interface SceneDialogue {
  /** Character slug the line is attributed to. Must match a slug in
   *  the book's Character[] roster for the speech-bubble anchor to
   *  find a hotspot. For unattributed narrator lines, set kind to
   *  'caption' and leave speaker empty or use 'narrator'. */
  speaker: string;
  /** The line itself. Plain text — the renderer wraps long lines
   *  but lines under ~140 chars present best in a bubble. */
  text: string;
  /** Visual presentation:
   *    - 'speech'  : classic bubble + tail pointing to the speaker
   *    - 'thought' : cloud-shaped bubble with trailing dots
   *    - 'caption' : rectangular narrator box, no tail
   *    - 'shout'   : jagged-edge bubble for action / yelling
   *  Defaults to 'speech' when omitted. */
  kind?: 'speech' | 'thought' | 'caption' | 'shout';
}

// ---- Scene beat ----
export interface SceneBeat {
  /** Local /-prefixed path or absolute CDN URL — same rules as
   *  background_asset_url so the renderer's resolver doesn't need
   *  to know the source. */
  imageUrl: string;
  /** What gpt-image-1 painted for this beat (prompt fragment). Kept
   *  for traceability + future regen runs. */
  visualDescription: string;
  /** Per-beat camera motion. Optional — manifestSynthesizer fills in
   *  a mood-rotated default when omitted. */
  motion?: 'slow_zoom_in' | 'slow_zoom_out' | 'pan_left' | 'pan_right' | 'divine_glow' | 'battle_push' | 'fade_only';
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
  /** Book slug — universal lookup. The route falls back to the
   *  bookRegistry when the seed Ramayana doesn't have the quiz. */
  bookSlug?: string;
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
