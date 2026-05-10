// ============================================================
// KathaKitaab.ai — Book Generator Agent
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
import { isGeminiConfigured, getGeminiClient, getTextModel } from './client';
import { generateSceneImage, generateCharacterPortrait } from '@/lib/agents/visualAgent';
import { uploadGeneratedImage } from '@/lib/storage/imageStorage';
import { registerRuntimeCanon } from '@/lib/data/canonLookup';
import type { CanonEntry } from '@/lib/types/canon';
import { inferArchetypeFromRole, type CharacterArchetype } from '@/lib/audio/characterVoices';
import type { StylePreset } from '@/lib/types/style';
import { Type, Schema } from '@google/genai';

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
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
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
  /** Public CDN URL of the painted beat image. Same Supabase bucket
   *  as the legacy single-image path; cached by content hash. */
  imageUrl: string;
  /** What the image model paints. Distinct from the scene's overall
   *  visual_description (which describes the whole scene); each
   *  beat describes a specific visual moment. */
  visualDescription: string;
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
}

/** Optional knobs for non-world generation modes. The pipeline is
 *  identical (outline → details → images → narration); only the
 *  outline prompt and the synthesised title differ. Each non-world
 *  mode supplies its own pre-built prompt via `outlinePrompt`. */
export interface GenerateBookOptions {
  /** Complete user-content for the outline LLM call. When omitted,
   *  the world-mode prompt is used (existing behaviour). */
  outlinePrompt?: string;
  /** Visual style preset for image generation. Defaults to
   *  photoreal_cinematic when omitted. */
  stylePreset?: StylePreset;
}

// ---- Main Generator (OpenAI primary, Gemini fallback) ----
export async function generateBook(
  bookTitle: string,
  onProgress?: (step: string, percent: number) => void,
  options: GenerateBookOptions = {},
): Promise<GeneratedBook> {
  if (isOpenAIConfigured()) {
    return generateBookOpenAI(bookTitle, onProgress, options);
  }
  if (isGeminiConfigured()) {
    return generateBookGemini(bookTitle, onProgress, options);
  }
  throw new Error('No AI API configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
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

  // STEP 1: Scene outline + characters
  // Default to the world-mode prompt (extracted into modePrompts.ts)
  // when the route hasn't supplied a mode-specific override.
  const { worldOutlinePrompt } = await import('./modePrompts');
  const outlineUserContent = options.outlinePrompt ?? worldOutlinePrompt(bookTitle);
  onProgress?.('Planning the story...', 10);
  const outlineRes = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are an expert educational book architect. Create engaging, accurate, age-appropriate interactive books. Respond with valid JSON.' },
      { role: 'user', content: outlineUserContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4000,
  });

  const outline = JSON.parse(outlineRes.choices[0]?.message?.content || '{}');
  const sceneOutlines: Array<{
    scene_id: string;
    title: string;
    short_summary: string;
    visual_description: string;
    /** Additional visual moments inside the scene the camera cuts to
     *  during narration. Optional: older prompts and Gemini-fallback
     *  paths might return undefined. We treat absence as "single beat,
     *  use visual_description only". */
    visual_beats?: string[];
    mood?: SceneMood;
    theme?: string;
  }> = outline.scenes || [];
  const charactersRaw: GeneratedCharacter[] = outline.characters || [];
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
    onProgress?.('Locking character looks...', 36);
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
          36 + (portraitsDone / portraitTargets.length) * 4,
        );
      }
    });
    // Re-register so subsequent visualAgent calls see the new anchor URLs.
    registerRuntimeCanon(slug, charactersToCanonEntries(characters));
  }

  // STEP 2: Detail LLM calls (parallel, fast).
  // Each detail call is ~5-10s; with concurrency 4 the 11 calls
  // complete in ~25-30s instead of 80s+ serial.
  onProgress?.('Writing all scenes...', 22);
  let completedDetails = 0;
  const details = await pMapLimit(sceneOutlines, 4, async (scene, i) => {
    const detailRes = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You create detailed scene content for interactive storybooks. Respond with valid JSON.' },
        { role: 'user', content: `Book: "${bookTitle}"
Scene: "${scene.title}" — ${scene.short_summary}
Mood: ${scene.mood ?? 'serene'}
Visual: ${scene.visual_description}
Characters: ${characters.map(c => c.name).join(', ')}

Generate JSON:
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
- fade_only: dialogue scenes where the camera should stay still` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.65,
      max_tokens: 2000,
    });
    completedDetails++;
    onProgress?.(`Wrote ${completedDetails}/${sceneOutlines.length} scenes`, 22 + (completedDetails / sceneOutlines.length) * 18);
    return JSON.parse(detailRes.choices[0]?.message?.content || '{}');
    void i;
  });

  // STEP 3: Image generation (parallel, the slow phase).
  // Each scene now wants 1-3 visual beats: the establishing shot
  // (visual_description) plus 0-2 follow-up beats (visual_beats[]).
  // We flatten { sceneIndex, prompt } pairs and paint them with one
  // shared concurrency cap, so a 7-scene book with 3 beats each runs
  // 21 image jobs through the same gpt-image-1 throttle without
  // serializing per scene.
  //
  // gpt-image-1 dominates the time budget — ~45s/call median.
  // Cap at 3 in flight: high enough to fit in Vercel's 300s budget,
  // low enough that one stuck call doesn't deadlock the others by
  // holding all the slots.
  type BeatJob = { sceneIndex: number; beatIndex: number; prompt: string };
  const beatJobs: BeatJob[] = sceneOutlines.flatMap((scene, sIdx) => {
    const prompts: string[] = [scene.visual_description];
    for (const extra of scene.visual_beats ?? []) {
      // Drop empties / accidental duplicates so the LLM saying
      // visual_beats=[""] doesn't cost us a $0.04 image of nothing.
      const trimmed = (extra ?? '').trim();
      if (trimmed.length > 8 && trimmed !== scene.visual_description.trim()) {
        prompts.push(trimmed);
      }
    }
    return prompts.map((prompt, bIdx) => ({ sceneIndex: sIdx, beatIndex: bIdx, prompt }));
  });

  onProgress?.('Illustrating scenes...', 42);
  let completedImages = 0;
  const beatResults = await pMapLimit(beatJobs, 3, async (job) => {
    try {
      const imageResult = await generateSceneImage(job.prompt, {
        bookSlug: slug,
        characters: characters.map(c => c.name),
        mood: sceneOutlines[job.sceneIndex].mood ?? 'serene',
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

  // STEP 4: Stitch the book.
  // Note: scene narration audio is NOT pre-rendered here. The live
  // reader resolves it lazily via /api/livebook/tts (Redis-cached).
  // The movie manifest synthesizer pre-renders any missing audio
  // at first /api/livebook/manifest fetch — that step has its own
  // 300s lambda budget separate from the gen budget. Splitting the
  // work keeps book generation fast and reliable: the user lands on
  // a fully-readable book in ~2 minutes, and the cinematic cut warms
  // its audio when they open the movie page.
  const scenesWithDetails: GeneratedScene[] = sceneOutlines.map((scene, i) => {
    const detail = details[i] ?? {};
    const narration = (detail.narration || scene.short_summary) as string;
    const prev = i > 0 ? sceneOutlines[i - 1].scene_id : null;
    const next = i < sceneOutlines.length - 1 ? sceneOutlines[i + 1].scene_id : null;
    const beats = sceneBeats[i] ?? [];
    return {
      scene_id: scene.scene_id,
      title: scene.title,
      order_index: i + 1,
      short_summary: scene.short_summary,
      visual_description: scene.visual_description,
      background_asset_url: imageUrls[i] ?? '',
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
      motion: detail.motion as SceneMotion | undefined,
      duration_seconds: estimateNarrationSeconds(narration),
      // narration_audio_url left unset — see comment above. Filled in
      // by manifestSynthesizer when the movie is requested.
      // Multi-beat track: only set when at least 2 beats actually
      // rendered. A 1-beat result is identical to the legacy single-
      // image scene, so leaving `beats` undefined lets the reader
      // take its existing fast path.
      beats: beats.length >= 2 ? beats : undefined,
    };
  });

  onProgress?.('Book complete!', 100);

  return {
    id: `book-${slug}`,
    slug,
    title: bookTitle,
    subtitle: outline.book_subtitle || `An interactive journey through ${bookTitle}`,
    description: outline.book_description || `Explore ${bookTitle} as a living storybook.`,
    source_tradition: outline.source_tradition || 'Public domain traditions',
    scenes: scenesWithDetails,
    characters,
    generatedAt: Date.now(),
  };
}

// ============================================================
// Gemini-powered generation (fallback)
// ============================================================

// Gemini schemas (kept for fallback)
const SCENE_OUTLINE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          scene_id: { type: Type.STRING },
          title: { type: Type.STRING },
          short_summary: { type: Type.STRING },
          visual_description: { type: Type.STRING },
          mood: { type: Type.STRING },
          theme: { type: Type.STRING },
        },
        required: ['scene_id', 'title', 'short_summary', 'visual_description'],
      },
    },
    book_subtitle: { type: Type.STRING },
    book_description: { type: Type.STRING },
    source_tradition: { type: Type.STRING },
  },
  required: ['scenes', 'book_subtitle', 'book_description', 'source_tradition'],
};

const SCENE_DETAIL_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    narration: { type: Type.STRING },
    learning_points: { type: Type.ARRAY, items: { type: Type.STRING } },
    source_notes: { type: Type.STRING },
    motion: { type: Type.STRING },
    hotspots: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          hotspot_type: { type: Type.STRING },
          target_type: { type: Type.STRING },
          target_id: { type: Type.STRING },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          width: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          tooltip: { type: Type.STRING },
        },
        required: ['label', 'hotspot_type', 'target_type', 'target_id', 'x', 'y', 'width', 'height', 'tooltip'],
      },
    },
    quiz_questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correct_answer: { type: Type.NUMBER },
          explanation: { type: Type.STRING },
        },
        required: ['question', 'options', 'correct_answer', 'explanation'],
      },
    },
  },
  required: ['narration', 'learning_points', 'source_notes', 'hotspots', 'quiz_questions'],
};

const CHARACTER_BIBLE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slug: { type: Type.STRING },
          name: { type: Type.STRING },
          role: { type: Type.STRING },
          short_summary: { type: Type.STRING },
          traits: { type: Type.ARRAY, items: { type: Type.STRING } },
          speech_tone: { type: Type.STRING },
          talk_examples: { type: Type.ARRAY, items: { type: Type.STRING } },
          source_notes: { type: Type.STRING },
          voice_archetype: { type: Type.STRING },
        },
        required: ['slug', 'name', 'role', 'short_summary', 'traits', 'speech_tone', 'talk_examples', 'source_notes'],
      },
    },
  },
  required: ['characters'],
};

async function generateBookGemini(
  bookTitle: string,
  onProgress?: (step: string, percent: number) => void,
  // Gemini fallback path takes the same options shape so the route
  // doesn't have to know which provider answers. The outlinePrompt
  // override is honoured below.
  _options: GenerateBookOptions = {},
): Promise<GeneratedBook> {
  const ai = getGeminiClient();
  const model = getTextModel();
  const slug = bookTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // STEP 1: Scene outline. Honour the same outlinePrompt override
  // the OpenAI path uses so classroom/personalized modes work in
  // the Gemini fallback too.
  onProgress?.('Generating scene outline...', 10);
  const geminiOutlinePrompt = _options.outlinePrompt ?? `You are an expert educational book architect.
Create a 10-12 scene outline for an interactive educational LiveBook about: "${bookTitle}".
Walk the story chronologically — establish, raise conflict, follow rising action, turn, resolve. No repeated beats.
Rules:
- Base all content on accurate, public-domain source material
- scene_id: short snake_case identifier
- visual_description: detailed 2D painting description
- mood: one of serene, dramatic, somber, joyful, sacred, mysterious, tense (drives TTS prosody + music + effects)
- theme: one-word noun for the beat (duty, wit, sacrifice, trick, courage, loss, devotion, reflection)
Generate now for: ${bookTitle}`;
  const outlineRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: geminiOutlinePrompt }] }],
    config: {
      systemInstruction: 'You are an expert educational book architect.',
      temperature: 0.7, maxOutputTokens: 3000,
      responseMimeType: 'application/json', responseSchema: SCENE_OUTLINE_SCHEMA,
    },
  });
  const outline = JSON.parse(outlineRes.text!);
  const sceneOutlines = outline.scenes as Array<{
    scene_id: string;
    title: string;
    short_summary: string;
    visual_description: string;
    mood?: SceneMood;
    theme?: string;
  }>;

  // STEP 2: Characters
  onProgress?.('Creating character bibles...', 30);
  const charRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: `Book: "${bookTitle}"
Scenes: ${sceneOutlines.map((s) => s.short_summary).join(' | ')}
Generate complete character profiles for all main characters.

For voice_archetype, pick one of these — match the character's role and demeanour:
- noble-male: heroic male leads, warrior princes
- young-male: younger brothers, adolescent heroes
- wise-male: sages, ministers, scholars, elders
- commanding-male: antagonists, deep-voiced kings, villains
- bright-male: witty/playful male characters, tricksters
- noble-female: queens, princesses, dignified leads
- young-female: girls, younger female characters
- aged-female: queen mothers, elder female characters
- narrator: when no character voice fits` }] }],
    config: { temperature: 0.6, maxOutputTokens: 3000, responseMimeType: 'application/json', responseSchema: CHARACTER_BIBLE_SCHEMA },
  });
  const charactersRaw: GeneratedCharacter[] = JSON.parse(charRes.text!).characters;
  // Backstop the LLM's archetype with a role-based inference, same as
  // the OpenAI path. The TTS router reads voice_archetype directly.
  const characters: GeneratedCharacter[] = charactersRaw.map(c => ({
    ...c,
    voice_archetype: c.voice_archetype ?? inferArchetypeFromRole(c.role, c.speech_tone),
  }));

  // STEP 3: Scene details + images
  onProgress?.('Writing scenes...', 50);
  const scenesWithDetails: GeneratedScene[] = [];

  for (let i = 0; i < sceneOutlines.length; i++) {
    const s = sceneOutlines[i];
    onProgress?.(`Detailing scene ${i + 1}/${sceneOutlines.length}: ${s.title}`, 50 + (i / sceneOutlines.length) * 40);

    const detailRes = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: `Book: "${bookTitle}" Scene: "${s.title}" Summary: ${s.short_summary} Visual: ${s.visual_description} Characters: ${characters.map((c: GeneratedCharacter) => c.name).join(', ')}
Generate narration, learning_points, source_notes, hotspots, quiz_questions.` }] }],
      config: { temperature: 0.65, maxOutputTokens: 2000, responseMimeType: 'application/json', responseSchema: SCENE_DETAIL_SCHEMA },
    });

    const detail = JSON.parse(detailRes.text!);
    const prev = i > 0 ? sceneOutlines[i - 1].scene_id : null;
    const next = i < sceneOutlines.length - 1 ? sceneOutlines[i + 1].scene_id : null;

    // Try to generate image — with canon context for consistency.
    let backgroundUrl = '';
    try {
      const slug = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const imageResult = await generateSceneImage(s.visual_description, {
        bookSlug: slug,
        characters: characters.map((c: GeneratedCharacter) => c.name),
        mood: s.mood ?? 'serene',
      });
      backgroundUrl = imageResult.imageUrl;
    } catch { /* fallback to gradient */ }

    const narration = detail.narration as string;

    scenesWithDetails.push({
      scene_id: s.scene_id, title: s.title, order_index: i + 1,
      short_summary: s.short_summary, visual_description: s.visual_description,
      background_asset_url: backgroundUrl,
      narration, learning_points: detail.learning_points,
      source_notes: detail.source_notes,
      hotspots: detail.hotspots.map((h: GeneratedHotspot, idx: number) => ({ ...h, id: `hs-${s.scene_id}-${idx}` })),
      quiz_questions: detail.quiz_questions.map((q: GeneratedQuiz, idx: number) => ({ ...q, id: `quiz-${s.scene_id}-${idx}`, scene_id: s.scene_id })),
      previous_scene_id: prev, next_scene_id: next,
      mood: s.mood, theme: s.theme,
      motion: detail.motion as SceneMotion | undefined,
      duration_seconds: estimateNarrationSeconds(narration),
      // narration_audio_url is hydrated by manifestSynthesizer when
      // the movie is requested — keeps gen-time fast and reliable.
    });
  }

  onProgress?.('Book complete!', 100);

  return {
    id: `book-${slug}`, slug, title: bookTitle,
    subtitle: outline.book_subtitle, description: outline.book_description,
    source_tradition: outline.source_tradition,
    scenes: scenesWithDetails, characters, generatedAt: Date.now(),
    stylePreset: _options.stylePreset,
  };
}
