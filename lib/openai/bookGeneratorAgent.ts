// ============================================================
// KathaKitaab — Book Generator Agent
//
// The user types ANY book name → a complete illustrated LiveBook.
//
// Pipeline:
//   1. Story Director → scene outline + characters
//   2. Per-scene: narrative + hotspots + quiz (OpenAI JSON mode)
//   3. Per-scene: background image (gpt-image-1 / Gemini Imagen)
//
// Uses OpenAI as primary, Gemini as fallback.
// All output is cached. Books are NEVER regenerated unless reset.
// ============================================================

import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from './openaiClient';
import { generateSceneImage, generateCharacterPortrait } from '@/lib/agents/visualAgent';
import { uploadGeneratedImage } from '@/lib/storage/imageStorage';
import { registerRuntimeCanon } from '@/lib/data/canonLookup';
import type { CanonEntry } from '@/lib/types/canon';
import { inferArchetypeFromRole, type CharacterArchetype } from '@/lib/audio/characterVoices';
import type { StylePreset } from '@/lib/types/style';
import { scoreBook, type QualityReport } from '@/lib/engine/qualityScorer';
// S2 — whole-arc QA critic (opt-in via KATHA_ARC_CRITIC_ENABLED).
import { critiqueArc } from '@/lib/agents/arcCriticAgent';
// Universal World-engine identity (opt-in via KATHA_WORLD_IDENTITY_ENABLED).
import { synthesizeWorldIdentity } from '@/lib/agents/worldIdentityAgent';
// S3 — vision-verify hotspots against the rendered image (opt-in via
// KATHA_VISION_HOTSPOTS_ENABLED). analyzeImageForTargets already no-ops
// when unconfigured (visionAgent.ts:70-72), but the gate is checked once
// outside the hot path so default-OFF adds zero cost.
import { analyzeImageForTargets } from '@/lib/agents/visionAgent';
// S4 — outline language directive helper.
import { outlineLanguageDirective } from './modePrompts';

// Universal moods + themes that downstream modules already consume.
// Keep these in sync with lib/video/manifestSchema.ts and the
// scene-stream route's mood/theme expectations.
export type SceneMood = 'serene' | 'dramatic' | 'somber' | 'joyful' | 'sacred' | 'mysterious' | 'tense';
export type SceneMotion = 'slow_zoom_in' | 'slow_zoom_out' | 'pan_left' | 'pan_right' | 'divine_glow' | 'battle_push' | 'fade_only';

// 150 wpm is roughly Sarvam Bulbul's neutral pace. ~2.5s tail accounts
// for the breath the narrator needs at the end of the scene before the
// movie cuts to the next one.
function estimateNarrationSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(8, Math.round((words / 150) * 60 + 2.5));
}

/**
 * Retry an async operation with exponential backoff.
 * Used for LLM calls so a single transient error doesn't kill the book.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 1000, maxDelayMs = 10000 }: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i >= attempts - 1) break;
      const delay = Math.min(baseDelayMs * (2 ** i), maxDelayMs);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Validate an LLM-supplied camera_action against the SceneMotion union.
 * Returns the typed motion or undefined when the value is missing,
 * malformed, or a token we don't render. Used to safely persist beat
 * motions without letting a misspelled "slow_zoom" past the boundary.
 */
function normaliseSceneMotion(raw: string | undefined): SceneMotion | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const valid: SceneMotion[] = [
    'slow_zoom_in',
    'slow_zoom_out',
    'pan_left',
    'pan_right',
    'divine_glow',
    'battle_push',
    'fade_only',
  ];
  return (valid as string[]).includes(v) ? (v as SceneMotion) : undefined;
}

/**
 * Sanitises the outline LLM's dialogue[] before it lands on a Scene.
 * Drops entries with empty text, validates `kind` against the four
 * supported bubble shapes, falls back to 'speech' for unknown / missing
 * kinds, and clamps the array to 6 entries per scene so a runaway LLM
 * can't blow up the comic renderer's overlay layer. Returns undefined
 * (not []) when nothing usable came back so the consumer can short-
 * circuit on `dialogue` truthiness checks. Universal — same shape
 * comes out for every preset, only the comic renderer reads it.
 */
function normaliseSceneDialogue(
  raw: Array<{ speaker?: string; text?: string; kind?: string }> | undefined,
): SceneDialogue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const validKinds = new Set(['speech', 'thought', 'caption', 'shout']);
  const out: SceneDialogue[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const text = (entry.text ?? '').toString().trim();
    if (text.length === 0) continue;
    const kindRaw = (entry.kind ?? '').toString().trim().toLowerCase();
    const kind = validKinds.has(kindRaw) ? (kindRaw as SceneDialogue['kind']) : 'speech';
    out.push({
      speaker: (entry.speaker ?? '').toString().trim(),
      text,
      kind,
    });
    if (out.length >= 6) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Project the in-flight characters[] into universal CanonEntry shape
 * so registerRuntimeCanon can index them. Filters out anything that
 * lacks both an appearance and an anchor — those don't help the
 * prompt builder (and would just bloat the index). Used twice during
 * generation: once after the outline (appearance-only canon for
 * scene-image prompts) and once after anchor baking (full canon
 * with anchor URLs for face-locked images.edit).
 */
function charactersToCanonEntries(characters: GeneratedCharacter[]): CanonEntry[] {
  return characters
    .filter(c => c.appearance || c.anchor_image_url)
    .map(c => ({
      id: c.slug,
      label: c.name,
      aliases: c.aliases ?? [],
      kind: 'character' as const,
      summary: c.short_summary || c.role || c.name,
      appearance: c.appearance,
      divine: c.divine,
      anchor_image_url: c.anchor_image_url,
    }));
}

/**
 * Concurrency-limited Promise.all. We can't fan out 12 gpt-image-1
 * calls simultaneously — OpenAI tier-1 rate limits cap us around 5
 * images/minute, and even when the limit is higher, hammering the
 * API can produce timeouts. Three to four in flight is the sweet
 * spot: image gen runs ~30-60s each, so 12 scenes complete in
 * 3-5 waves ≈ 90-180s, well inside Vercel's 300s function budget.
 */
async function pMapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: (R | undefined)[] = new Array(items.length);
  const errors: (Error | undefined)[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        errors[i] = err instanceof Error ? err : new Error(String(err));
      }
    }
  });
  await Promise.all(workers);
  const firstError = errors.find(Boolean);
  if (firstError) throw firstError;
  return out as R[];
}

/**
 * Fetch a remote (or same-origin /-prefixed) image URL and return it as a
 * base64 string suitable for analyzeImageForTargets (visionAgent.ts accepts
 * either a `data:` URL or raw base64). Returns '' on any fetch / decode
 * failure so the S3 vision-verify pass can skip the scene instead of
 * crashing generation. Server-side only — the generator runs in the API
 * route, never on the client. */
async function fetchImageAsBase64(url: string): Promise<string> {
  if (!url) return '';
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  } catch {
    return '';
  }
}

// ---- Output types ----
export interface GeneratedScene {
  scene_id: string;
  title: string;
  order_index: number;
  narration: string;
  short_summary: string;
  visual_description: string;
  background_asset_url: string;
  learning_points: string[];
  source_notes: string;
  hotspots: GeneratedHotspot[];
  quiz_questions: GeneratedQuiz[];
  previous_scene_id: string | null;
  next_scene_id: string | null;
  /** Emotional register for this scene. Drives TTS prosody, music
   *  bed selection, and effect recipes. The LLM picks one of the
   *  seven universal moods so the downstream router doesn't have to
   *  reverse-engineer it from text. */
  mood?: SceneMood;
  /** One-word noun describing the scene's narrative beat — "duty",
   *  "wit", "sacrifice", "betrayal", "trick". Used by deriveTheme
   *  in scene-stream when present, else falls back to keywords. */
  theme?: string;
  /** Per-scene camera motion. Optional — manifest synthesis derives
   *  one from `mood` when this is missing. */
  motion?: SceneMotion;
  /** ms estimate the synth pipeline uses for movie playback length.
   *  When absent, derived from narration word count. */
  duration_seconds?: number;
  /** Public CDN URL of pre-rendered scene narration. When set, the
   *  movie/trailer renderer feeds this directly into Remotion's
   *  <Audio> source so the MP4 ships with real narration, not just
   *  procedural music. The live reader still resolves through
   *  /api/livebook/tts (which hits the same TTS cache). */
  narration_audio_url?: string;
  /** Which TTS provider actually rendered the audio at narration_audio_url.
   *  Set by hydrateBookAudio after each successful render. Used by
   *  the global self-heal: any scene tagged non-Sarvam (or untagged
   *  with a URL that pre-dates the chunker fix) gets stripped and
   *  re-rendered on next manifest fetch so the listener never hears
   *  a Gemini-voiced legacy file when Sarvam is now reliable. */
  audio_provider?: 'sarvam' | 'gemini' | 'failed';
  /** Multi-beat visual track. When present, the scene cross-fades
   *  through these images during narration instead of holding on a
   *  single still. Backwards-compat: if `beats` is missing, the
   *  reader falls back to `background_asset_url` for the entire
   *  scene duration (existing books in Redis keep working).
   *
   *  The first beat's `imageUrl` is also written to
   *  `background_asset_url` so any downstream code that only knows
   *  about the legacy single-image field gets a sensible default. */
  beats?: SceneBeat[];
  /** Comic-book overlay track — speech bubbles, thought clouds,
   *  narrator captions. Only rendered when the book's stylePreset
   *  is 'comic_book'; other presets keep the bottom subtitle bar.
   *  Missing on legacy books — dialogueTagger backfills on demand. */
  dialogue?: SceneDialogue[];
  /** Characters physically present in this scene. Drives image-prompt
   *  character injection and appearance locks. */
  characters_present?: string[];
  /** Characters who must NOT appear in this scene (absent, kidnapped,
   *  dead, off-screen). Drives negative constraints in image prompts. */
  characters_absent?: string[];
  /** Ambient sound loop for the scene's setting (wind, rain, fire,
   *  temple bells, etc.). Suggested by the outline LLM; rendered by
   *  the movie composer as a low-level texture beneath the mood bed. */
  ambient_sound?: string;
}

/** Mirrors lib/types/livebook.ts:SceneDialogue. Kept duplicated here
 *  rather than re-exported to avoid pulling the broader UI type tree
 *  into the agent module. Any shape change must update both. */
export interface SceneDialogue {
  speaker: string;
  text: string;
  kind?: 'speech' | 'thought' | 'caption' | 'shout';
}

/** A single visual moment within a scene. Each beat gets its own
 *  image painted by the image phase; the live reader and movie
 *  cross-fade between them at sentence boundaries.
 *
 *  Timing is computed at manifest-synthesis time from the subtitle
 *  cues — the LLM doesn't pick ms values. Beats are equal-weighted
 *  across the scene's narration duration unless we add an explicit
 *  weight later. */
export interface SceneBeat {
  /** Public CDN URL of the painted beat image. Same S3 bucket as
   *  the legacy single-image path; cached by content hash. */
  imageUrl: string;
  /** What the image model paints. Distinct from the scene's overall
   *  visual_description (which describes the whole scene); each
   *  beat describes a specific visual moment. */
  visualDescription: string;
  /** Per-beat camera motion. Lets the LLM pick a different shot
   *  type for each beat (e.g. wide establishing → slow zoom on
   *  character → reveal). Optional — the manifest synthesizer
   *  fills missing motions deterministically from a rotation pool
   *  so every beat gets a distinct camera move regardless. */
  motion?: SceneMotion;
  /** Shot type the LLM assigned to this beat (wide, close_up,
   *  reverse, etc.). Forwarded to the manifest for coverage stats
   *  and future renderer behaviour. */
  shotType?: string;
  /** One-shot sound effect that fires when this beat begins.
   *  Rendered by the movie composer as a brief audio hit. */
  sfx?: string;
}

export interface GeneratedCharacter {
  slug: string;
  name: string;
  role: string;
  short_summary: string;
  traits: string[];
  speech_tone: string;
  talk_examples: string[];
  source_notes: string;
  /** Voice archetype for TTS — one of nine universal categories.
   *  When present, narration for this character uses the matching
   *  Sarvam/Gemini voice without needing a hardcoded slug→archetype
   *  table entry. The LLM is asked to pick this; if it returns
   *  garbage we fall back to inferArchetypeFromRole(). */
  voice_archetype?: CharacterArchetype;

  // ── Universal canon fields (added so AI-generated books get the
  // same character consistency Ramayana has via lib/data/canon/*.json) ──

  /** Detailed visual identity — skin tone, hair, eyes, age, build,
   *  signature clothing/items. Injected into every scene-image prompt
   *  via visualPromptBuilder so the same character looks the same
   *  across scenes. Required for face-locking. */
  appearance?: string;
  /** Alternative names the LLM or user might use when referring to
   *  this character (nicknames, honorifics, role-only references).
   *  Used by canon name matching. */
  aliases?: string[];
  /** Marks deities / sacred figures whose appearance must be
   *  especially guarded. Anchors are prioritised when there are too
   *  many candidates for gpt-image-1's 4-reference cap. */
  divine?: boolean;
  /** Public CDN URL of the pre-baked canonical portrait. Used by
   *  visualAgent.collectAnchorReferences for images.edit anchoring,
   *  so faces stay locked across scenes. Filled in by the generator's
   *  anchor-portrait phase; empty for characters whose appearance was
   *  not specific enough to lock. */
  anchor_image_url?: string;
}

export interface GeneratedHotspot {
  id: string;
  label: string;
  hotspot_type: 'character' | 'object' | 'place';
  target_type: 'character' | 'info';
  target_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tooltip: string;
  quick_speak?: string;
}

export interface GeneratedQuiz {
  id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}

/** Generation mode. World stories are public-by-default; classroom
 *  and personalized stories are private-by-default and tied to an
 *  ownerId. personalized_photo is reserved for a future ship —
 *  shipping it requires the full child-photo safety stack. */
export type GenerationMode = 'world' | 'classroom' | 'personalized_text' | 'personalized_photo';

/** Per-mode metadata stored alongside the book. Each mode populates
 *  exactly one optional field. World mode leaves metadata empty. */
export interface BookMetadata {
  classroom?: {
    gradeBand: string;        // free-form for now: "Class 6", "Grade 4-5"
    subject?: string;         // optional — Akbar/Birbal isn't really a subject
    chapter?: string;         // optional
    learningGoal?: string;
    language?: string;
    tone?: string;
  };
  personalized?: {
    /** Child's first name only. Stored so re-generation can keep the
     *  name consistent without the parent re-typing it. Never
     *  surfaced in slugs or public URLs. The UI rejects multi-word
     *  inputs to enforce first-name-only. */
    childName: string;
    age: number;
    language?: string;
    interests?: string;
    prompt?: string;
    moral?: string;
    tone?: string;
    /** ISO timestamp the parent ticked the consent box. Audit trail
     *  in case we need to demonstrate consent later. */
    consentTimestamp: string;
  };
}

export interface GeneratedBook {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  source_tradition: string;
  scenes: GeneratedScene[];
  characters: GeneratedCharacter[];
  generatedAt: number;

  // ── Ownership & visibility (added for V1 mode-aware shipping) ──
  // All four are optional so existing books in Redis (mode=world,
  // visibility=public, no ownerId) keep working without migration.
  /** Generation mode this book was created under. Older entries
   *  (created before V1 shipped) are read as 'world' implicitly via
   *  bookRegistry.getBook(). */
  mode?: GenerationMode;
  /** Anonymous owner cookie ID. Required for private books;
   *  undefined for public world books. */
  ownerId?: string;
  /** Default rule:
   *    world         → 'public'
   *    classroom     → 'private'
   *    personalized_*→ 'private'
   *  Set explicitly at create time so the read path doesn't have to
   *  re-derive it. */
  visibility?: 'public' | 'private';
  /** Per-mode metadata. Empty / absent for world. */
  metadata?: BookMetadata;
  /** Last-modified timestamp. `generatedAt` records initial creation;
   *  this advances on rename / re-generation. Optional so old books
   *  read fine. */
  updatedAt?: number;
  /** Visual style preset chosen at generation time. Drives the
   *  style clause in every scene-image prompt and anchor portrait.
   *  Optional so books created before the preset shipped still read
   *  fine — they fall back to the universal photoreal default. */
  stylePreset?: StylePreset;
  /** Post-generation quality score. Added by the quality scorer so
   *  the UI can surface a "preview quality" warning when the score
   *  is low. Optional so legacy books without scoring still read. */
  qualityScore?: QualityReport;
  /** Accuracy / canon classification label.
   *    CANONICAL          → backed by a static canon JSON file
   *    CREATIVE_RETELLING → AI-generated, openly creative
   *    EDUCATIONAL_SUMMARY → classroom/education mode
   *    UNVERIFIED         → AI-generated, no web research grounding
   *  Optional so legacy books still read. */
  accuracyLabel?: 'CANONICAL' | 'CREATIVE_RETELLING' | 'EDUCATIONAL_SUMMARY' | 'UNVERIFIED';
  /** Movie readiness status — not just text-ready, but all assets validated. */
  movieStatus?: 'ready' | 'pending' | 'partial' | 'failed';
  /** List of missing assets when movieStatus is partial. */
  movieMissingAssets?: Array<{ sceneId: string; missing: string }>;
  /** Whole-arc QA notes (S2). Populated by the opt-in arc critic
   *  (KATHA_ARC_CRITIC_ENABLED=1) when its score < 80 — a serialised
   *  list of arc-level breaks (unpaid setups, flat arcs, contradictions).
   *  Absent when the critic is off, not configured, or scored >= 80.
   *  Non-blocking: never triggers regeneration. */
  qaNotes?: string;
  /** Book-level narration language route (S4). 'hi' = Hindi (Devanagari)
   *  narration + dialogue; 'en' = English; 'auto' = unspecified / mixed.
   *  Derived from the mode metadata (classroom / personalized language
   *  field) at generation time. The Movie build agent + TTS route read
   *  this defensively to pick a matching voice. Absent on legacy books. */
  language?: 'hi' | 'en' | 'auto';
  /** Universal World-engine identity (universal rewrite). Per-scene
   *  mood/biome/ambient + a book-level palette family, used by
   *  `synthesizeWorldManifest` to OVERRIDE the deterministic universal
   *  lexicon so the explorable world reads FROM this story's actual
   *  prose. Populated by the opt-in world-identity agent
   *  (KATHA_WORLD_IDENTITY_ENABLED=1) when a key is configured; absent
   *  otherwise, in which case the World engine derives an identity
   *  deterministically via `deriveWorldIdentity` (no key needed). */
  worldIdentity?: import('@/lib/world/worldManifest').WorldIdentity;
}

/** Optional knobs for non-world generation modes. The pipeline is
 *  identical (outline → details → images → narration); only the
 *  outline prompt and the synthesised title differ. Each non-world
 *  mode supplies its own pre-built prompt via `outlinePrompt`.
 *
 *  `onStepComplete` is called after each major generation step so
 *  the caller can persist intermediate state (outline, scenes,
 *  images) for resumable generation. */
export interface GenerateBookOptions {
  /** Complete user-content for the outline LLM call. When omitted,
   *  the world-mode prompt is used (existing behaviour). */
  outlinePrompt?: string;
  /** Visual style preset for image generation. Defaults to
   *  photoreal_cinematic when omitted. */
  stylePreset?: StylePreset;
  /** Called after each major step completes with the intermediate
   *  data so the caller can persist it for resume. */
  onStepComplete?: (step: 'outline' | 'portraits' | 'scenes' | 'images', data: unknown) => void | Promise<void>;
  /** Book-level narration language route (S4). When 'hi', a Hindi
   *  directive is appended to the outline + scene-detail system
   *  prompts and the field is persisted on the GeneratedBook so the
   *  Movie build agent + TTS route can pick a matching voice. The
   *  generation route is expected to derive this from the mode
   *  metadata (classroom / personalized language field). Absent /
   *  'auto' → unchanged English pipeline. */
  language?: 'hi' | 'en' | 'auto';
}

// ---- Main Generator (OpenAI primary, Gemini fallback) ----
export async function generateBook(
  bookTitle: string,
  onProgress?: (step: string, percent: number) => void,
  options: GenerateBookOptions = {},
): Promise<GeneratedBook> {
  if (!isOpenAIConfigured()) {
    throw new Error('OPENAI_API_KEY is not set. The book generator runs on OpenAI only — no Gemini fallback.');
  }
  return generateBookOpenAI(bookTitle, onProgress, options);
}

// ============================================================
// OpenAI-powered generation (primary)
// ============================================================
async function generateBookOpenAI(
  bookTitle: string,
  onProgress?: (step: string, percent: number) => void,
  options: GenerateBookOptions = {},
): Promise<GeneratedBook> {
  const client = getOpenAIClient();
  const model = getOpenAIModel();
  const slug = bookTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // S4 — language route. The directive is appended to the English system
  // prompts (outline + scene-details) so the model writes narration + dialogue
  // in Hindi when routed. outlineLanguageDirective returns '' for 'en'/'auto'
  // so the default English system prompts are byte-identical to pre-S4.
  const languageCode = options.language;
  const langDirective = outlineLanguageDirective(languageCode);
  const outlineSystem = 'You are an expert educational book architect. Create engaging, accurate, age-appropriate interactive books. Respond with valid JSON.' + langDirective;

  // S3 — vision-verify hotspots gate. Checked ONCE here, outside the image
  // loop, so the default-OFF path adds zero per-beat cost. When enabled,
  // after the establishing (beat 0) image lands for each scene we run
  // analyzeImageForTargets and overwrite the LLM-guessed hotspot coords
  // with vision-verified ones. analyzeImageForTargets itself no-ops when
  // OpenAI vision isn't configured (visionAgent.ts:70-72), so even with
  // the flag on, a missing key degrades to the LLM-guessed coords.
  const visionHotspotsEnabled = process.env.KATHA_VISION_HOTSPOTS_ENABLED === '1';

  // STEP 1: Scene outline + characters
  // Default to the world-mode prompt (extracted into modePrompts.ts)
  // when the route hasn't supplied a mode-specific override.
  const { worldOutlinePrompt } = await import('./modePrompts');
  const outlineUserContent = options.outlinePrompt ?? worldOutlinePrompt(bookTitle);
  onProgress?.('Planning the story...', 10);
  const outlineRes = await withRetry(() => client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: outlineSystem },
      { role: 'user', content: outlineUserContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4000,
  }), { attempts: 3, baseDelayMs: 1000 });

  let outline: Record<string, unknown>;
  try {
    outline = JSON.parse(outlineRes.choices[0]?.message?.content || '{}');
  } catch {
    throw new Error(`Outline JSON parse failed for "${bookTitle}" — the LLM returned malformed JSON. Retrying recommended.`);
  }
  const sceneOutlines: Array<{
    scene_id: string;
    title: string;
    short_summary: string;
    visual_description: string;
    /** Additional visual moments inside the scene the camera cuts to
     *  during narration. The current prompt asks the LLM for objects
     *  with `description` + `camera_action`; we ALSO accept the legacy
     *  string[] shape so older prompts and Gemini-fallback paths still
     *  produce something usable. Missing entirely → single-beat scene. */
    visual_beats?: Array<string | { description: string; camera_action?: string; shot_type?: string; sfx?: string }>;
    mood?: SceneMood;
    theme?: string;
    ambient_sound?: string;
    /** Characters physically present in this scene. Used to build
     *  scene-specific image prompts and negative constraints. */
    characters_present?: string[];
    /** Main characters who are NOT in this scene (absent, kidnapped,
     *  dead, off-screen). Used to exclude them from image prompts. */
    characters_absent?: string[];
    /** Comic-book overlay track emitted by the outline LLM. Optional
     *  to keep backwards compat with prompt versions that pre-date
     *  the field — when missing, the comic-book renderer falls back
     *  to the bottom subtitle bar (other presets always do).
     *  Shape mirrors SceneDialogue but kind defaults to 'speech'. */
    dialogue?: Array<{ speaker?: string; text?: string; kind?: string }>;
  }> = ((outline.scenes ?? []) as Array<{
    scene_id: string; title: string; short_summary: string; visual_description: string;
    visual_beats?: Array<string | { description: string; camera_action?: string; shot_type?: string; sfx?: string }>;
    mood?: SceneMood; theme?: string; ambient_sound?: string;
    characters_present?: string[]; characters_absent?: string[];
    dialogue?: Array<{ speaker?: string; text?: string; kind?: string }>;
  }>);

  // ── Outline validation + repair ──
  // If the LLM returns an out-of-range scene count, retry once with
  // a stricter prompt before giving up. This recovers from vague
  // prompts that cause the model to under- or over-generate.
  if (sceneOutlines.length < 3 || sceneOutlines.length > 20) {
    console.warn(`[BookGenerator] Outline has ${sceneOutlines.length} scenes (target 6-12). Retrying with stricter prompt...`);
    const strictOutlineRes = await withRetry(() => client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: outlineSystem + ' IMPORTANT: produce EXACTLY 8-10 scenes. No more, no less.' },
        { role: 'user', content: outlineUserContent + '\n\nSTRICT REQUIREMENT: Return exactly 8-10 scenes. Not fewer than 8, not more than 10.' },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 4000,
    }), { attempts: 2, baseDelayMs: 1000 });

    let strictOutline: Record<string, unknown>;
    try {
      strictOutline = JSON.parse(strictOutlineRes.choices[0]?.message?.content || '{}');
    } catch {
      strictOutline = {};
    }
    const strictScenes = ((strictOutline.scenes ?? []) as typeof sceneOutlines);
    if (strictScenes.length >= 3 && strictScenes.length <= 20) {
      sceneOutlines.length = 0;
      sceneOutlines.push(...strictScenes);
      console.log(`[BookGenerator] Repair succeeded: ${strictScenes.length} scenes.`);
    } else {
      throw new Error(`Outline repair failed. Got ${strictScenes.length} scenes after retry. Minimum 3, maximum 20.`);
    }
  }
  const charactersRaw: GeneratedCharacter[] = ((outline.characters ?? []) as GeneratedCharacter[]);
  // Backstop the LLM's voice_archetype: if it returned an unknown
  // value (typo, omitted entry), infer from the role text. The
  // downstream TTS router will trust whatever ends up here.
  const characters: GeneratedCharacter[] = charactersRaw.map(c => ({
    ...c,
    voice_archetype: c.voice_archetype ?? inferArchetypeFromRole(c.role, c.speech_tone),
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
    divine: c.divine ?? false,
  }));

  if (sceneOutlines.length === 0) throw new Error('Failed to generate scene outline');

  // ── Visual beats backstop ──
  // The outline prompt asks for 2-3 visual beats per scene, but the
  // LLM sometimes omits them. Without beats every scene renders as a
  // single static image — children lose attention and the user sees
  // "just one image". We backfill missing beats with deterministic
  // heuristics (close-up, reaction, detail) so every scene ALWAYS has
  // at least one follow-up shot.
  for (const scene of sceneOutlines) {
    const hasBeats = Array.isArray(scene.visual_beats) && scene.visual_beats.length > 0
      && scene.visual_beats.some(b => {
        const desc = typeof b === 'string' ? b : b?.description;
        return (desc ?? '').trim().length > 8;
      });
    if (!hasBeats) {
      const present = scene.characters_present ?? [];
      const mood = scene.mood ?? 'serene';
      const synthetic: Array<{ description: string; camera_action: string; shot_type: string }> = [];
      if (present.length > 0) {
        synthetic.push({
          description: `Close-up on ${present[0]}'s face — eyes, expression, and subtle emotional reaction during this ${mood} moment. Intimate framing that connects the viewer to the character's inner state.`,
          camera_action: 'slow_zoom_in',
          shot_type: 'close_up',
        });
      }
      if (present.length > 1) {
        synthetic.push({
          description: `Medium shot of ${present[1]} responding — body language, gesture, or posture that reveals their emotional reaction. Natural framing with soft background depth.`,
          camera_action: 'pan_right',
          shot_type: 'medium',
        });
      } else if (synthetic.length === 0) {
        synthetic.push({
          description: `Detail shot — a key object, symbolic element, or environmental texture from the scene that carries narrative weight. Intimate framing inviting closer inspection.`,
          camera_action: 'slow_zoom_out',
          shot_type: 'detail',
        });
      }
      scene.visual_beats = synthetic;
    }
  }

  await options.onStepComplete?.('outline', { outline, characters });

  // STEP 2.5: Bake canonical character anchor portraits.
  // For each character with an `appearance` description, render a
  // single canonical portrait via the universal visualAgent so the
  // scene-image phase can use it as an images.edit reference and
  // lock the face across every scene. Without this, AI books get
  // the "Rama looks different every scene" drift that Ramayana
  // solved years ago via hand-curated canon. Universal — works for
  // any book in any genre.
  //
  // Concurrency 3: portraits are ~20-30s on gpt-image-1, and we want
  // them done quickly because the scene-image phase is gated on them.
  //
  // Failure mode: a single character whose portrait gen errors keeps
  // its anchor_image_url empty; the visualPromptBuilder still injects
  // its appearance text, just without face-locking. Better than
  // dropping the whole generation.
  //
  // We also push the partial canon (characters with appearance but no
  // anchor yet) into the runtime registry BEFORE scene images run so
  // visualPromptBuilder can inject appearance text immediately. Once
  // the portraits land we re-register with the anchor URLs.
  registerRuntimeCanon(slug, charactersToCanonEntries(characters), {
    book_slug: slug,
    book_title: bookTitle,
    source: 'AI-generated narrative',
  });

  const portraitTargets = characters.filter(c => c.appearance && c.appearance.length > 20);
  if (portraitTargets.length > 0) {
    onProgress?.('Locking character looks...', 15);
    let portraitsDone = 0;
    await pMapLimit(portraitTargets, 3, async (c) => {
      try {
        const r = await generateCharacterPortrait(c.name, c.appearance!, slug, options.stylePreset);
        if (!r.imageUrl) return;
        // Re-upload to the stable anchor path so the URL stays
        // permanent across regenerations and any later canon-JSON
        // promotion can drop straight in.
        const stable = await uploadGeneratedImage(r.imageUrl, {
          path: `${slug}/anchors/character-${c.slug}.png`,
          mimeType: 'image/png',
        });
        c.anchor_image_url = stable;
      } catch (err) {
        console.warn(`[BookGenerator] anchor portrait failed for ${c.slug}:`,
          err instanceof Error ? err.message : err);
      } finally {
        portraitsDone++;
        onProgress?.(
          `Locked ${portraitsDone}/${portraitTargets.length} character looks`,
          15 + (portraitsDone / portraitTargets.length) * 5,
        );
      }
    });
    // Re-register so subsequent visualAgent calls see the new anchor URLs.
    registerRuntimeCanon(slug, charactersToCanonEntries(characters));
  }

  await options.onStepComplete?.('portraits', { characters });

  // STEP 2: Detail LLM calls (parallel, fast).
  // Each detail call is ~5-10s; with concurrency 4 the 11 calls
  // complete in ~25-30s instead of 80s+ serial.
  onProgress?.('Writing all scenes...', 22);
  let completedDetails = 0;
  const details = await pMapLimit(sceneOutlines, 4, async (scene) => {
    const detailRes = await withRetry(() => client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: `You create detailed scene content for interactive storybooks. Respond with valid JSON matching this exact schema:
{
  "narration": "string (150-200 words, warm storytelling voice; match the mood — sorrow plays slow, action plays urgent)",
  "learning_points": ["string", "string", "string"],
  "source_notes": "string",
  "motion": "slow_zoom_in|slow_zoom_out|pan_left|pan_right|divine_glow|battle_push|fade_only — pick what suits this beat",
  "hotspots": [
    { "label": "string", "hotspot_type": "character|object|place", "target_type": "character|info", "target_id": "slug", "x": number (0-100), "y": number (0-100), "width": number (5-20), "height": number (5-25), "tooltip": "string", "quick_speak": "string (for characters)" }
  ],
  "quiz_questions": [
    { "question": "string", "options": ["string","string","string","string"], "correct_answer": number (0-3), "explanation": "string" }
  ]
}

motion guide:
- slow_zoom_in: introductions, contemplative beats, sacred moments
- slow_zoom_out: revelations, scope reveals, kingdom-wide shots
- battle_push: combat, chase, peak intensity
- divine_glow: blessings, miracles, transformative moments
- pan_left / pan_right: travel, journey, reveal-by-sweep
- fade_only: dialogue scenes where the camera should stay still` + langDirective },
        { role: 'user', content: `Book: "${bookTitle}"
Scene: "${scene.title}" — ${scene.short_summary}
Mood: ${scene.mood ?? 'serene'}
Visual: ${scene.visual_description}
Characters: ${characters.map(c => c.name).join(', ')}

Generate the scene JSON now.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.65,
      max_tokens: 2000,
    }), { attempts: 3, baseDelayMs: 800 });
    completedDetails++;
    onProgress?.(`Wrote ${completedDetails}/${sceneOutlines.length} scenes`, 22 + (completedDetails / sceneOutlines.length) * 18);
    try {
      return JSON.parse(detailRes.choices[0]?.message?.content || '{}');
    } catch {
      console.error(`[BookGenerator] Scene detail JSON parse failed for "${scene.title}" — returning fallback.`);
      return {
        narration: scene.short_summary,
        learning_points: [],
        source_notes: '',
        motion: undefined,
        hotspots: [],
        quiz_questions: [],
      };
    }
  });

  // Build base scenes (without images) so the caller can persist
  // intermediate state before the slow image phase begins.
  const baseScenes: GeneratedScene[] = sceneOutlines.map((scene, i) => {
    const detail = details[i] ?? {};
    const narration = (detail.narration || scene.short_summary) as string;
    const prev = i > 0 ? sceneOutlines[i - 1].scene_id : null;
    const next = i < sceneOutlines.length - 1 ? sceneOutlines[i + 1].scene_id : null;
    return {
      scene_id: scene.scene_id,
      title: scene.title,
      order_index: i + 1,
      short_summary: scene.short_summary,
      visual_description: scene.visual_description,
      background_asset_url: '',
      narration,
      learning_points: detail.learning_points || [],
      source_notes: detail.source_notes || outline.source_tradition || '',
      hotspots: (detail.hotspots || []).map((h: GeneratedHotspot, idx: number) => ({
        ...h,
        id: `hs-${scene.scene_id}-${idx}`,
      })),
      quiz_questions: (detail.quiz_questions || []).map((q: GeneratedQuiz, idx: number) => ({
        ...q,
        id: `quiz-${scene.scene_id}-${idx}`,
        scene_id: scene.scene_id,
      })),
      previous_scene_id: prev,
      next_scene_id: next,
      mood: scene.mood,
      theme: scene.theme,
      characters_present: scene.characters_present,
      characters_absent: scene.characters_absent,
      motion: detail.motion as SceneMotion | undefined,
      duration_seconds: estimateNarrationSeconds(narration),
      beats: undefined,
      dialogue: normaliseSceneDialogue(scene.dialogue),
      ambient_sound: scene.ambient_sound,
    };
  });

  await options.onStepComplete?.('scenes', { scenes: baseScenes });

  // STEP 3: Image generation (parallel, the slow phase).
  // Each scene now wants 1-5 visual beats: the establishing shot
  // (visual_description, beat 0) plus 0-4 follow-up beats from
  // visual_beats[]. Each follow-up may carry an optional camera_action
  // — when present, that motion preset is persisted on the SceneBeat
  // so BookMovie plays a distinct shot per beat. When the LLM didn't
  // emit camera_action, manifestSynthesizer fills it from a deterministic
  // mood-themed rotation pool so every beat still has a unique camera.
  //
  // gpt-image-1 dominates the time budget — ~45s/call median.
  // Cap at 3 in flight: high enough to fit in Vercel's 300s budget,
  // low enough that one stuck call doesn't deadlock the others by
  // holding all the slots.
  type BeatJob = {
    sceneIndex: number;
    beatIndex: number;
    prompt: string;
    /** Camera motion the LLM picked for this beat (if any). */
    cameraAction?: string;
    /** Shot type the LLM assigned (wide, close_up, reverse, etc.). */
    shotType?: string;
    /** One-shot SFX suggested for this beat. */
    sfx?: string;
  };
  const beatJobs: BeatJob[] = sceneOutlines.flatMap((scene, sIdx) => {
    const jobs: BeatJob[] = [
      { sceneIndex: sIdx, beatIndex: 0, prompt: scene.visual_description },
    ];
    for (const extra of scene.visual_beats ?? []) {
      // Tolerate both shapes: object {description, camera_action} (new
      // prompt) or bare string (legacy / fallback). Drop empties so
      // visual_beats=[""] doesn't cost us a $0.04 image of nothing.
      const desc = typeof extra === 'string' ? extra : extra?.description;
      const cam = typeof extra === 'object' && extra !== null
        ? extra.camera_action
        : undefined;
      const shotType = typeof extra === 'object' && extra !== null
        ? extra.shot_type
        : undefined;
      const sfx = typeof extra === 'object' && extra !== null
        ? extra.sfx
        : undefined;
      const trimmed = (desc ?? '').trim();
      if (trimmed.length > 8 && trimmed !== scene.visual_description.trim()) {
        jobs.push({
          sceneIndex: sIdx,
          beatIndex: jobs.length,
          prompt: trimmed,
          cameraAction: cam,
          shotType,
          sfx,
        });
      }
    }
    return jobs;
  });

  onProgress?.('Illustrating scenes...', 42);
  let completedImages = 0;
  const beatResults = await pMapLimit(beatJobs, 3, async (job) => {
    try {
      const sceneOutline = sceneOutlines[job.sceneIndex];
      const present = sceneOutline.characters_present ?? [];
      const absent = sceneOutline.characters_absent ?? [];
      // If the LLM didn't emit presence fields (legacy / fallback),
      // fall back to scanning the prompt for character names so we
      // don't lose appearance locks entirely.
      const fallbackCharacters = present.length === 0 && absent.length === 0
        ? characters.map(c => c.name)
        : present;
      const imageResult = await generateSceneImage(job.prompt, {
        bookSlug: slug,
        sceneId: sceneOutline.scene_id,
        characters: fallbackCharacters,
        forbiddenCharacters: absent,
        mood: sceneOutline.mood ?? 'serene',
        stylePreset: options.stylePreset,
      });
      completedImages++;
      onProgress?.(
        `Illustrated ${completedImages}/${beatJobs.length} beats`,
        42 + (completedImages / beatJobs.length) * 38,
      );
      return { ...job, imageUrl: imageResult.imageUrl };
    } catch (err) {
      console.error(`[BookGenerator] Image failed for scene ${sceneOutlines[job.sceneIndex].scene_id} beat ${job.beatIndex}:`, err);
      completedImages++;
      return { ...job, imageUrl: '' };
    }
  });

  // Collect beats back per scene, preserving order. Each entry in
  // sceneBeats[i] is { imageUrl, visualDescription } for the beats
  // that successfully rendered. The legacy `imageUrls` array (one
  // url per scene) keeps the existing scene-stitching code path
  // working — it points at the first beat (the establishing shot).
  const sceneBeats: SceneBeat[][] = sceneOutlines.map(() => []);
  for (const r of beatResults) {
    if (r.imageUrl) {
      sceneBeats[r.sceneIndex][r.beatIndex] = {
        imageUrl: r.imageUrl,
        visualDescription: r.prompt,
        // Only persist motion when the LLM picked one we recognise.
        // Manifest synthesizer fills missing motions deterministically
        // from a mood pool, so legacy beats still get distinct cameras.
        motion: normaliseSceneMotion(r.cameraAction),
        shotType: r.shotType,
        sfx: r.sfx,
      };
    }
  }
  // Compact (drop empty slots from any failed beats so the array is
  // dense). Also fall back to a single-beat array when all beats for
  // a scene failed — better to render no image than crash the reader.
  for (let i = 0; i < sceneBeats.length; i++) {
    sceneBeats[i] = sceneBeats[i].filter(Boolean);
  }
  const imageUrls = sceneBeats.map(beats => beats[0]?.imageUrl ?? '');

  // Patch base scenes with generated images/beats.
  for (let i = 0; i < baseScenes.length; i++) {
    const beats = sceneBeats[i] ?? [];
    baseScenes[i].background_asset_url = imageUrls[i] ?? '';
    // Always persist beats when at least one image rendered successfully.
    // The first beat is the establishing shot; follow-ups come from
    // visual_beats (LLM or synthetic). Requiring >=2 silently dropped
    // scenes where only the establishing shot survived image gen —
    // the reader then fell back to a single static image and children
    // lost the Ken-Burns motion that multi-beat scenes provide.
    baseScenes[i].beats = beats.length >= 1 ? beats : undefined;
  }

  // ── S3: Vision-verify hotspots against the rendered establishing image ──
  // For each scene with at least one hotspot, fetch the beat-0 image and
  // ask GPT-4o vision where each hotspot label actually is, then overwrite
  // the LLM-guessed x/y/width/height with the verified coords. Targets the
  // model doesn't find (found=false) keep their LLM-guessed coords so we
  // never zero out a good guess. Skipped entirely when the flag is off —
  // the gate is computed once above, so default-OFF is a no-op.
  if (visionHotspotsEnabled) {
    for (let i = 0; i < baseScenes.length; i++) {
      const scene = baseScenes[i];
      const img = scene.background_asset_url || scene.beats?.[0]?.imageUrl;
      const hotspots = scene.hotspots;
      if (!img || !hotspots || hotspots.length === 0) continue;
      const labels = hotspots.map(h => h.label);
      try {
        const b64 = await fetchImageAsBase64(img);
        if (!b64) continue;
        const targets = await analyzeImageForTargets(b64, labels);
        for (const t of targets) {
          if (!t.found) continue;
          const hs = hotspots.find(h => h.label.toLowerCase().trim() === t.label.toLowerCase().trim());
          if (!hs) continue;
          hs.x = t.x;
          hs.y = t.y;
          hs.width = t.width;
          hs.height = t.height;
        }
      } catch (err) {
        console.warn(`[BookGenerator] vision hotspot verify failed for scene ${scene.scene_id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  await options.onStepComplete?.('images', { scenes: baseScenes });

  onProgress?.('Scenes illustrated', 80);

  const book: GeneratedBook = {
    id: `book-${slug}`,
    slug,
    title: bookTitle,
    subtitle: (outline.book_subtitle as string | undefined) || `An interactive journey through ${bookTitle}`,
    description: (outline.book_description as string | undefined) || `Explore ${bookTitle} as a living storybook.`,
    source_tradition: (outline.source_tradition as string | undefined) || 'Public domain traditions',
    scenes: baseScenes,
    characters,
    generatedAt: Date.now(),
    // S4 — persist the language route so the Movie build agent + TTS path
    // can pick a matching voice on later reads.
    language: languageCode,
  };

  // ── Quality scoring ──
  try {
    book.qualityScore = scoreBook(book);
    if (!book.qualityScore.isSafeToShow) {
      console.warn('[BookGenerator] Quality score below threshold:', book.qualityScore.totalScore, book.qualityScore.warnings);
    }
  } catch (err) {
    console.warn('[BookGenerator] Quality scoring failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  // ── S2: Whole-arc QA critic (opt-in, non-blocking) ──
  // Runs ONE gpt-4o-mini pass over the full arc after scenes finalize to
  // catch setup-without-payoff, flatlining character arcs, and cross-scene
  // contradictions. Default OFF (KATHA_ARC_CRITIC_ENABLED=1 to enable).
  // When the critic isn't configured it returns score:100 (degrade-to-skip,
  // mirroring branchQAAgent.ts:93-95). NEVER auto-regenerates — issues are
  // serialised into book.qaNotes for the operator / UI to surface.
  if (process.env.KATHA_ARC_CRITIC_ENABLED === '1') {
    try {
      const critique = await critiqueArc({
        title: book.title,
        scenes: book.scenes.map(s => ({ scene_id: s.scene_id, title: s.title, narration: s.narration })),
        characters: book.characters.map(c => ({ name: c.name, role: c.role, short_summary: c.short_summary })),
      });
      if (critique.score < 80 && critique.issues.length > 0) {
        book.qaNotes = critique.issues
          .map((issue, idx) => `${idx + 1}. ${issue}`)
          .join('\n');
        console.warn(`[BookGenerator] Arc critic score ${critique.score}: ${critique.issues.length} issue(s). Notes recorded (non-blocking).`);
      }
    } catch (err) {
      // Non-blocking: a critic failure must never break generation.
      console.warn('[BookGenerator] Arc critic failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  // ── Universal World-engine identity (opt-in, non-blocking) ──
  // ONE gpt-4o-mini pass reading the book's actual prose assigns each
  // scene a mood/biome/ambient + a book-level palette family, stored on
  // `book.worldIdentity`. `synthesizeWorldManifest` uses it to OVERRIDE
  // the deterministic universal lexicon so the explorable world reads
  // FROM this story (deserts read as deserts, tragedies feel cold) — the
  // universality lever the old Ramayana-tinted keyword dicts lacked.
  // Default OFF (KATHA_WORLD_IDENTITY_ENABLED=1). When off or no key,
  // the agent returns null and the World engine derives an identity
  // deterministically via `deriveWorldIdentity` (no key needed) — so the
  // no-key path is always real.
  if (process.env.KATHA_WORLD_IDENTITY_ENABLED === '1') {
    try {
      const identity = await synthesizeWorldIdentity({
        title: book.title,
        scenes: book.scenes.map(s => ({
          scene_id: s.scene_id,
          title: s.title,
          visual_description: s.visual_description,
          short_summary: s.short_summary,
        })),
      });
      if (identity) {
        book.worldIdentity = identity;
        console.log(`[BookGenerator] World identity synthesized: ${identity.paletteFamily}, ${identity.nodes.length} nodes.`);
      } else {
        console.log('[BookGenerator] World identity agent returned null — deterministic lexicon will drive the world.');
      }
    } catch (err) {
      console.warn('[BookGenerator] World identity failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  // ── Accuracy / canon label ──
  // AI-generated books are ALWAYS creative retellings. The CANONICAL label
  // is reserved for curated static seeds loaded from canon JSON files.
  book.accuracyLabel = 'CREATIVE_RETELLING';

  return book;
}

