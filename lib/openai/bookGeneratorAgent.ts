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
import { generateSceneImage } from '@/lib/agents/visualAgent';
import { Type, Schema } from '@google/genai';

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
}

// ---- Main Generator (OpenAI primary, Gemini fallback) ----
export async function generateBook(
  bookTitle: string,
  onProgress?: (step: string, percent: number) => void
): Promise<GeneratedBook> {
  if (isOpenAIConfigured()) {
    return generateBookOpenAI(bookTitle, onProgress);
  }
  if (isGeminiConfigured()) {
    return generateBookGemini(bookTitle, onProgress);
  }
  throw new Error('No AI API configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
}

// ============================================================
// OpenAI-powered generation (primary)
// ============================================================
async function generateBookOpenAI(
  bookTitle: string,
  onProgress?: (step: string, percent: number) => void
): Promise<GeneratedBook> {
  const client = getOpenAIClient();
  const model = getOpenAIModel();
  const slug = bookTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // STEP 1: Scene outline + characters
  onProgress?.('Planning the story...', 10);
  const outlineRes = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are an expert educational book architect. Create engaging, accurate, age-appropriate interactive books. Respond with valid JSON.' },
      { role: 'user', content: `Create a 10-12 scene outline for an interactive educational LiveBook about: "${bookTitle}".

Return JSON with this structure:
{
  "book_subtitle": "string",
  "book_description": "string",
  "source_tradition": "string (e.g., Valmiki Ramayana)",
  "scenes": [
    { "scene_id": "snake_case_id", "title": "string", "short_summary": "string", "visual_description": "string (detailed for image generation)" }
  ],
  "characters": [
    { "slug": "lowercase-slug", "name": "string", "role": "string", "short_summary": "string", "traits": ["string"], "speech_tone": "string", "talk_examples": ["string"], "source_notes": "string" }
  ]
}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 4000,
  });

  const outline = JSON.parse(outlineRes.choices[0]?.message?.content || '{}');
  const sceneOutlines: Array<{ scene_id: string; title: string; short_summary: string; visual_description: string }> = outline.scenes || [];
  const characters: GeneratedCharacter[] = outline.characters || [];

  if (sceneOutlines.length === 0) throw new Error('Failed to generate scene outline');

  // STEP 2: Generate scene details + images
  const scenesWithDetails: GeneratedScene[] = [];

  for (let i = 0; i < sceneOutlines.length; i++) {
    const scene = sceneOutlines[i];
    onProgress?.(`Writing scene ${i + 1}/${sceneOutlines.length}: ${scene.title}`, 20 + (i / sceneOutlines.length) * 50);

    // Generate scene narrative + hotspots + quiz
    const detailRes = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You create detailed scene content for interactive storybooks. Respond with valid JSON.' },
        { role: 'user', content: `Book: "${bookTitle}"
Scene: "${scene.title}" — ${scene.short_summary}
Visual: ${scene.visual_description}
Characters: ${characters.map(c => c.name).join(', ')}

Generate JSON:
{
  "narration": "string (150-200 words, warm storytelling voice)",
  "learning_points": ["string", "string", "string"],
  "source_notes": "string",
  "hotspots": [
    { "label": "string", "hotspot_type": "character|object|place", "target_type": "character|info", "target_id": "slug", "x": number (0-100), "y": number (0-100), "width": number (5-20), "height": number (5-25), "tooltip": "string", "quick_speak": "string (for characters)" }
  ],
  "quiz_questions": [
    { "question": "string", "options": ["string","string","string","string"], "correct_answer": number (0-3), "explanation": "string" }
  ]
}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.65,
      max_tokens: 2000,
    });

    const detail = JSON.parse(detailRes.choices[0]?.message?.content || '{}');
    const prev = i > 0 ? sceneOutlines[i - 1].scene_id : null;
    const next = i < sceneOutlines.length - 1 ? sceneOutlines[i + 1].scene_id : null;

    // Generate scene background image — pass canon context so character
    // appearance + book style auto-inject (works for canon books;
    // gracefully no-ops for new generated books).
    onProgress?.(`Illustrating: ${scene.title}...`, 70 + (i / sceneOutlines.length) * 25);
    let backgroundUrl = '';
    try {
      const slug = bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const imageResult = await generateSceneImage(scene.visual_description, {
        bookSlug: slug,
        characters: characters.map(c => c.name),
        mood: 'serene',
      });
      backgroundUrl = imageResult.imageUrl;
    } catch (err) {
      console.error(`[BookGenerator] Image failed for scene ${scene.scene_id}:`, err);
    }

    scenesWithDetails.push({
      scene_id: scene.scene_id,
      title: scene.title,
      order_index: i + 1,
      short_summary: scene.short_summary,
      visual_description: scene.visual_description,
      background_asset_url: backgroundUrl,
      narration: detail.narration || scene.short_summary,
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
    });
  }

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
        },
        required: ['slug', 'name', 'role', 'short_summary', 'traits', 'speech_tone', 'talk_examples', 'source_notes'],
      },
    },
  },
  required: ['characters'],
};

async function generateBookGemini(
  bookTitle: string,
  onProgress?: (step: string, percent: number) => void
): Promise<GeneratedBook> {
  const ai = getGeminiClient();
  const model = getTextModel();
  const slug = bookTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // STEP 1: Scene outline
  onProgress?.('Generating scene outline...', 10);
  const outlineRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: `You are an expert educational book architect.
Create a 10-12 scene outline for an interactive educational LiveBook about: "${bookTitle}".
Rules:
- Base all content on accurate, public-domain source material
- scene_id: short snake_case identifier
- visual_description: detailed 2D painting description
Generate now for: ${bookTitle}` }] }],
    config: {
      systemInstruction: 'You are an expert educational book architect.',
      temperature: 0.7, maxOutputTokens: 3000,
      responseMimeType: 'application/json', responseSchema: SCENE_OUTLINE_SCHEMA,
    },
  });
  const outline = JSON.parse(outlineRes.text!);
  const sceneOutlines = outline.scenes;

  // STEP 2: Characters
  onProgress?.('Creating character bibles...', 30);
  const charRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: `Book: "${bookTitle}"
Scenes: ${sceneOutlines.map((s: { short_summary: string }) => s.short_summary).join(' | ')}
Generate complete character profiles for all main characters.` }] }],
    config: { temperature: 0.6, maxOutputTokens: 3000, responseMimeType: 'application/json', responseSchema: CHARACTER_BIBLE_SCHEMA },
  });
  const { characters }: { characters: GeneratedCharacter[] } = JSON.parse(charRes.text!);

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
        mood: 'serene',
      });
      backgroundUrl = imageResult.imageUrl;
    } catch { /* fallback to gradient */ }

    scenesWithDetails.push({
      scene_id: s.scene_id, title: s.title, order_index: i + 1,
      short_summary: s.short_summary, visual_description: s.visual_description,
      background_asset_url: backgroundUrl,
      narration: detail.narration, learning_points: detail.learning_points,
      source_notes: detail.source_notes,
      hotspots: detail.hotspots.map((h: GeneratedHotspot, idx: number) => ({ ...h, id: `hs-${s.scene_id}-${idx}` })),
      quiz_questions: detail.quiz_questions.map((q: GeneratedQuiz, idx: number) => ({ ...q, id: `quiz-${s.scene_id}-${idx}`, scene_id: s.scene_id })),
      previous_scene_id: prev, next_scene_id: next,
    });
  }

  onProgress?.('Book complete!', 100);

  return {
    id: `book-${slug}`, slug, title: bookTitle,
    subtitle: outline.book_subtitle, description: outline.book_description,
    source_tradition: outline.source_tradition,
    scenes: scenesWithDetails, characters, generatedAt: Date.now(),
  };
}
