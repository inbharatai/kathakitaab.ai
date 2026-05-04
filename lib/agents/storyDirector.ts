// ============================================================
// KathaKitaab.ai — Story Director Agent
//
// The brain of the live storybook engine.
// Uses OpenAI gpt-4o (primary) or Gemini (fallback).
// ============================================================

import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';

// ── Output Types ─────────────────────────────────────────────

export interface GeneratedHotspot {
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

export interface SceneGeneration {
  page_title: string;
  story_text: string;
  visual_description: string;
  learning_points: string[];
  source_notes: string;
  hotspots: GeneratedHotspot[];
  characters_present: string[];
  mood: string;
  continuity_summary: string;
}

// ── Context ──────────────────────────────────────────────────

export interface StoryDirectorContext {
  bookTitle: string;
  bookDescription?: string;
  previousSceneTitle?: string;
  previousSceneText?: string;
  previousSceneSummary?: string;
  characterNames?: string[];
  userInstruction?: string;
  actionType: 'continue' | 'change' | 'branch' | 'generate';
  worldStateSummary?: string;
  sceneIndex?: number;
  /** Web-grounded research context for accuracy */
  sourceContext?: string;
  /**
   * Narrative theme — guides the emotional motif of the scene
   * (duty / courage / sacrifice / devotion / loss / love / betrayal /
   * hope / wonder / fear / redemption, plus tradition-specific aliases
   * like dharma / bhakti / karma / hubris). Optional. When supplied,
   * the LLM is asked to lean into this motif without forcing it. The
   * same string is also passed through to the image prompt builder so
   * visual + narrative tone stay aligned.
   */
  theme?: string;
}

// ── System Prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Story Director for KathaKitaab.ai, an interactive AI storybook engine.
You create rich, educational, and engaging story scenes for Indian epic tales and world literature.

Rules:
- Write in a warm, vivid storytelling voice suitable for ages 8+
- Ground all content in authentic source material (cite the source tradition)
- Each scene should be a meaningful narrative moment with emotional depth
- visual_description must be detailed enough to generate a cinematic illustration
- Place 2-5 hotspots at realistic positions where characters/objects appear in the visual
- Hotspot x,y are percentages (0-100) representing position in a 16:9 scene
- Characters should have quick_speak: a short in-character line
- Never include violent, inappropriate, or scary content
- Maintain continuity with previous scenes if provided
- learning_points should teach real cultural/historical lessons
- story_text should be 150-250 words, warm storytelling voice

You MUST respond with valid JSON matching this schema:
{
  "page_title": "string",
  "story_text": "string (150-250 words)",
  "visual_description": "string (detailed scene for image generation)",
  "learning_points": ["string", "string", "string"],
  "source_notes": "string",
  "hotspots": [
    {
      "label": "string",
      "hotspot_type": "character|object|place",
      "target_type": "character|info",
      "target_id": "string (snake_case slug)",
      "x": number (0-100),
      "y": number (0-100),
      "width": number (5-20),
      "height": number (5-25),
      "tooltip": "string",
      "quick_speak": "string (optional, for characters)"
    }
  ],
  "characters_present": ["string"],
  "mood": "serene|tense|joyful|mysterious|dramatic|sacred|melancholy",
  "continuity_summary": "string (one sentence)"
}`;

// ── Main Generation (tries OpenAI, falls back to Gemini) ─────

export async function generateScene(ctx: StoryDirectorContext): Promise<SceneGeneration> {
  const userPrompt = buildUserPrompt(ctx);

  // Try OpenAI first
  if (isOpenAIConfigured()) {
    try {
      return await generateWithOpenAI(userPrompt);
    } catch (err) {
      console.error('[StoryDirector] OpenAI failed, trying Gemini:', err);
    }
  }

  // Fallback to Gemini
  if (isGeminiConfigured()) {
    return await generateWithGemini(userPrompt);
  }

  throw new Error('No AI API available. Set OPENAI_API_KEY or GEMINI_API_KEY.');
}

async function generateWithOpenAI(userPrompt: string): Promise<SceneGeneration> {
  const client = getOpenAIClient();
  const model = getOpenAIModel();

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.75,
    max_tokens: 2000,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI');

  return validateAndReturn(JSON.parse(content));
}

async function generateWithGemini(userPrompt: string): Promise<SceneGeneration> {
  const ai = getGeminiClient();
  const model = getTextModel();

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.75,
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
    },
  });

  const text = response.text;
  if (!text) throw new Error('Empty response from Gemini');

  // Try to repair truncated JSON
  let parsed: SceneGeneration;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Attempt repair: close open strings and brackets
    let repaired = text;
    // Close unclosed string
    const quoteCount = (repaired.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) repaired += '"';
    // Close arrays/objects
    const opens = (repaired.match(/[{[]/g) || []).length;
    const closes = (repaired.match(/[}\]]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) {
      // Guess based on last open bracket
      const lastOpen = Math.max(repaired.lastIndexOf('{'), repaired.lastIndexOf('['));
      repaired += repaired[lastOpen] === '[' ? ']}' : '}';
    }
    try {
      parsed = JSON.parse(repaired);
    } catch {
      throw new Error('Failed to parse Gemini response as JSON');
    }
  }

  return validateAndReturn(parsed);
}

function validateAndReturn(parsed: SceneGeneration): SceneGeneration {
  if (!parsed.page_title || !parsed.story_text || !parsed.visual_description) {
    throw new Error('Story Director: incomplete scene generation');
  }
  parsed.learning_points = parsed.learning_points ?? [];
  parsed.hotspots = parsed.hotspots ?? [];
  parsed.characters_present = parsed.characters_present ?? [];
  parsed.mood = parsed.mood ?? 'serene';
  parsed.continuity_summary = parsed.continuity_summary ?? '';
  parsed.source_notes = parsed.source_notes ?? '';
  return parsed;
}

function buildUserPrompt(ctx: StoryDirectorContext): string {
  const lines: string[] = [];
  lines.push(`Book: "${ctx.bookTitle}"`);
  if (ctx.bookDescription) lines.push(`Description: ${ctx.bookDescription}`);

  // Web-grounded source material (most important for accuracy)
  if (ctx.sourceContext) {
    lines.push(`\n=== VERIFIED SOURCE MATERIAL (from web research) ===`);
    lines.push(ctx.sourceContext.slice(0, 800));
    lines.push(`=== Use this as your PRIMARY source. Do not contradict it. ===`);
  }

  if (ctx.previousSceneTitle) {
    lines.push(`\nPrevious Scene: "${ctx.previousSceneTitle}"`);
    if (ctx.previousSceneText) lines.push(`Previous Narration: ${ctx.previousSceneText.slice(0, 500)}`);
    if (ctx.previousSceneSummary) lines.push(`Continuity: ${ctx.previousSceneSummary}`);
  }

  if (ctx.characterNames?.length) lines.push(`\nAvailable Characters: ${ctx.characterNames.join(', ')}`);

  // World state with consequences (game loop)
  if (ctx.worldStateSummary) {
    lines.push(`\n=== WORLD STATE & CONSEQUENCES ===`);
    lines.push(ctx.worldStateSummary);
    lines.push(`=== The story MUST reflect these consequences. ===`);
  }

  if (ctx.sceneIndex !== undefined) lines.push(`\nThis is scene #${ctx.sceneIndex + 1}`);

  // Theme — purely guidance. We do NOT want the LLM to bend the source
  // material to fit a theme. We only ask it to lean into the motif if
  // the canonical events naturally support it. This keeps the system
  // book-agnostic: any tradition can pass a theme without distorting
  // its source.
  if (ctx.theme) {
    lines.push(`\nNarrative motif: lean into the theme of "${ctx.theme}" where the canonical material naturally supports it. Do not invent events to force the motif.`);
  }

  switch (ctx.actionType) {
    case 'continue':
      lines.push('\nAction: Generate the NEXT scene. Continue naturally from where the previous scene left off.');
      break;
    case 'change':
      lines.push(`\nAction: CHANGE the scene. Instruction: "${ctx.userInstruction}"`);
      break;
    case 'branch':
      lines.push(`\nAction: BRANCH. Choice: "${ctx.userInstruction}"`);
      break;
    case 'generate':
      lines.push('\nAction: Generate a NEW scene for this book.');
      if (ctx.userInstruction) lines.push(`Scene focus: ${ctx.userInstruction}`);
      break;
  }

  lines.push('\nGenerate the scene now as valid JSON.');
  return lines.join('\n');
}
