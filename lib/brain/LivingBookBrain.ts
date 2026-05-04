// ============================================================
// KathaKitaab.ai — Living Book Brain
//
// The central orchestrator. Coordinates all specialist agents
// to prepare a complete interactive scene BEFORE the user clicks.
//
// Pipeline:
//   1. Cache Agent → check if scene already exists
//   2. Story Director → plan the scene narrative
//   3. Visual Director → create image prompt
//   4. Image Generation → create scene image
//   5. Vision Agent → detect entities in the image
//   6. Branch Agent → pre-generate branches for ALL entities (parallel)
//   7. Narration Agent → create TTS narration text
//   8. Safety Agent → validate everything
//   9. QA Agent → verify no dead hotspots exist
//   10. Cache Agent → store everything
//
// Result: a complete scene with pre-generated branches.
// Every click is instant.
// ============================================================

import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';
import { generateSceneImage } from '@/lib/agents/visualAgent';
import { analyzeImageForTargets } from '@/lib/agents/visionAgent';
import { checkContentSafety } from '@/lib/agents/safetyAgent';
import { researchTopic } from '@/lib/agents/researchAgent';
import { getCachedResponse, setCachedResponse, buildCacheKey } from '@/lib/cache/responseCache';
import { saveCachedBranch, saveManifest, type PreGeneratedBranch, type BranchManifest } from '@/lib/engine/branchPreGenerator';

// ── Types ────────────────────────────────────────────────────

export interface SceneEntity {
  entityId: string;
  label: string;
  type: 'character' | 'object' | 'location' | 'animal' | 'background';
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  hasReadyBranch: boolean;
}

export interface BrainSceneResult {
  sceneId: string;
  bookId: string;
  title: string;
  narration: string;
  visualDescription: string;
  imageUrl: string | null;
  mood: string;
  entities: SceneEntity[];
  branches: PreGeneratedBranch[];
  sourceNotes: string;
  learningPoints: string[];
  continuitySummary: string;
  safetyRating: string;
  qaReady: boolean;
  qaWarnings: string[];
  cached: boolean;
  /** True when web research returned no grounding for this scene. */
  unverified: boolean;
  /** Human-readable note explaining why the scene is unverified. */
  verificationNote?: string;
}

export interface BrainRequest {
  bookSlug: string;
  bookTitle: string;
  previousSceneTitle?: string;
  previousSceneText?: string;
  characterNames?: string[];
  actionType: 'continue' | 'generate' | 'change';
  userInstruction?: string;
  sceneIndex?: number;
  worldStateSummary?: string;
}

// ── The Brain ────────────────────────────────────────────────

export async function prepareScene(req: BrainRequest): Promise<BrainSceneResult> {
  const sceneKey = buildCacheKey({
    type: 'brain-scene',
    book: req.bookSlug,
    prev: req.previousSceneTitle || 'start',
    action: req.actionType,
    idx: String(req.sceneIndex ?? 0),
  });

  // ── Step 1: Cache Agent — check if we already have this scene
  const cached = getCachedResponse(sceneKey) as BrainSceneResult | null;
  if (cached) {
    return { ...cached, cached: true };
  }

  // ── Step 2: Research Agent — web-grounded source material.
  // Failure is no longer silent: we record it so the UI can show
  // an "AI interpretation, not verified to source" badge.
  const researchProviderConfigured = isOpenAIConfigured() || isGeminiConfigured();
  let sourceContext: string | undefined;
  let researchError: string | undefined;
  try {
    sourceContext = await researchTopic(req.bookTitle, req.previousSceneTitle || req.bookTitle);
    if (!sourceContext) researchError = 'Research returned no usable grounding.';
  } catch (err) {
    researchError = err instanceof Error ? err.message : 'Research call threw.';
  }
  const unverified = !sourceContext;
  const verificationNote = unverified
    ? (researchProviderConfigured
        ? `AI interpretation — generated without verified source material. ${researchError ?? ''}`.trim()
        : 'AI interpretation — no research provider configured. Set OPENAI_API_KEY for web-grounded scenes.')
    : undefined;

  // ── Step 3: Story Director Agent — plan the scene
  const scenePlan = await runStoryDirector(req, sourceContext);

  // ── Step 4: Safety Agent — check the plan
  const safety = checkContentSafety(scenePlan.narration + ' ' + scenePlan.visualDescription);
  if (!safety.passed) {
    throw new Error('Scene content blocked by safety filter');
  }

  // ── Step 5: Visual Director Agent + Image Generation (parallel with entity detection prep)
  const imageResult = await generateSceneImage(scenePlan.visualDescription, {
    bookSlug: req.bookSlug,
    characters: scenePlan.characters,
    mood: scenePlan.mood,
  });

  // ── Step 6: Vision/Entity Agent — detect entities in the generated image
  let entities: SceneEntity[] = [];
  if (imageResult.imageUrl && imageResult.source !== 'fallback') {
    try {
      const targets = scenePlan.characters.concat(scenePlan.objects || []);
      const visionResults = await analyzeImageForTargets(imageResult.imageUrl, targets);
      entities = visionResults
        .filter(v => v.found)
        .map(v => ({
          entityId: v.label.toLowerCase().replace(/\s+/g, '-'),
          label: v.label,
          type: classifyEntityType(v.label, scenePlan.characters),
          x: v.x, y: v.y, width: v.width, height: v.height,
          confidence: 0.8,
          hasReadyBranch: false,
        }));
    } catch { /* vision failed — use plan-based entities */ }
  }

  // Fallback: use entities from the story director plan
  if (entities.length === 0) {
    entities = scenePlan.hotspots.map(h => ({
      entityId: h.target_id,
      label: h.label,
      type: h.hotspot_type as SceneEntity['type'],
      x: h.x, y: h.y, width: h.width, height: h.height,
      confidence: 0.6,
      hasReadyBranch: false,
    }));
  }

  // ── Step 7: Branch Agent — pre-generate branches for ALL entities (parallel)
  const branches = await pregenerateBranches(req.bookTitle, scenePlan, entities);

  // Mark entities as having ready branches
  for (const entity of entities) {
    entity.hasReadyBranch = branches.some(b => b.entityId === entity.entityId && b.status === 'ready');
  }

  // ── Step 8: QA Agent — verify everything
  const qaWarnings: string[] = [];
  for (const entity of entities) {
    if (!entity.hasReadyBranch) {
      qaWarnings.push(`No branch for ${entity.label}`);
    }
  }

  const sceneId = `brain-${req.bookSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

  // ── Step 9: Assemble result
  const result: BrainSceneResult = {
    sceneId,
    bookId: req.bookSlug,
    title: scenePlan.title,
    narration: scenePlan.narration,
    visualDescription: scenePlan.visualDescription,
    imageUrl: imageResult.imageUrl || null,
    mood: scenePlan.mood,
    entities,
    branches,
    sourceNotes: scenePlan.sourceNotes,
    learningPoints: scenePlan.learningPoints,
    continuitySummary: scenePlan.continuitySummary,
    safetyRating: safety.rating,
    qaReady: qaWarnings.length === 0,
    qaWarnings,
    cached: false,
    unverified,
    verificationNote,
  };

  // ── Step 10: Cache Agent — store everything
  setCachedResponse(sceneKey, result, 'brain');

  // Also save branch manifest for fast entity-interact lookups
  const manifest: BranchManifest = {
    sceneId,
    bookId: req.bookSlug,
    branches,
    generatedAt: Date.now(),
    status: qaWarnings.length === 0 ? 'ready' : 'partial',
  };
  saveManifest(manifest);

  // Save individual branches for fast lookup
  for (const branch of branches) {
    saveCachedBranch(sceneId, branch.entityId, branch);
  }

  return result;
}

// ── Story Director Agent ─────────────────────────────────────

interface ScenePlan {
  title: string;
  narration: string;
  visualDescription: string;
  mood: string;
  characters: string[];
  objects?: string[];
  sourceNotes: string;
  learningPoints: string[];
  continuitySummary: string;
  hotspots: Array<{ label: string; hotspot_type: string; target_id: string; x: number; y: number; width: number; height: number }>;
}

async function runStoryDirector(req: BrainRequest, sourceContext?: string): Promise<ScenePlan> {
  const systemPrompt = `You are the Story Director for "${req.bookTitle}", a living interactive AI storybook.
Create a rich, educational scene. Respond with strict JSON:
{
  "title": "scene title",
  "narration": "150-250 words, warm storytelling voice, age 8+",
  "visualDescription": "detailed visual description for image generation",
  "mood": "serene|tense|joyful|mysterious|dramatic|sacred",
  "characters": ["character names present"],
  "objects": ["important objects/animals visible"],
  "sourceNotes": "cite real sources",
  "learningPoints": ["3 educational takeaways"],
  "continuitySummary": "one sentence summary for continuity",
  "hotspots": [{"label":"name","hotspot_type":"character|object|location|animal","target_id":"slug","x":0-100,"y":0-100,"width":5-20,"height":5-25}]
}`;

  let userPrompt = `Book: "${req.bookTitle}"`;
  if (sourceContext) userPrompt += `\n\nResearch context:\n${sourceContext.slice(0, 600)}`;
  if (req.previousSceneTitle) userPrompt += `\nPrevious: "${req.previousSceneTitle}"`;
  if (req.previousSceneText) userPrompt += `\nContext: ${req.previousSceneText.slice(0, 400)}`;
  if (req.worldStateSummary) userPrompt += `\nWorld state: ${req.worldStateSummary}`;
  if (req.characterNames?.length) userPrompt += `\nCharacters: ${req.characterNames.join(', ')}`;
  userPrompt += `\nAction: ${req.actionType}`;
  if (req.userInstruction) userPrompt += ` — ${req.userInstruction}`;
  userPrompt += '\n\nGenerate the scene as JSON.';

  return await callAI<ScenePlan>(systemPrompt, userPrompt);
}

// ── Branch Pre-Generation Agent ──────────────────────────────

async function pregenerateBranches(
  bookTitle: string,
  scenePlan: ScenePlan,
  entities: SceneEntity[],
): Promise<PreGeneratedBranch[]> {
  const jobs = entities.slice(0, 6).map(async (entity): Promise<PreGeneratedBranch> => {
    // Check cache first
    const cacheKey = buildCacheKey({ type: 'entity-branch-content', book: bookTitle, scene: scenePlan.title, entity: entity.entityId });
    const cached = getCachedResponse(cacheKey) as PreGeneratedBranch | null;
    if (cached) return cached;

    const actionPrompts: Record<string, string> = {
      character: `Character "${entity.label}" speaks. Show inner thoughts, a dialogue line, and next action. Emotional, cinematic.`,
      object: `Object "${entity.label}" is examined. Reveal history, significance, hidden detail. Like finding a game secret.`,
      location: `Location "${entity.label}" is explored. Describe atmosphere, hidden paths, what the user discovers.`,
      animal: `Animal "${entity.label}" is approached. Show behavior, significance, what happens.`,
      background: `Background element "${entity.label}" is noticed. Atmospheric detail, what the user discovers.`,
    };

    const prompt = actionPrompts[entity.type] || actionPrompts.background;

    try {
      const result = await callAI<{ title: string; narration: string; sceneText: string; imagePrompt: string; nextActions: string[] }>(
        `You are a branch generator for "${bookTitle}", scene "${scenePlan.title}". Context: ${scenePlan.narration.slice(0, 300)}
Respond with JSON: {"title":"","narration":"2-3 TTS sentences","sceneText":"1 paragraph","imagePrompt":"visual description","nextActions":["3 actions"]}`,
        prompt,
      );

      const branch: PreGeneratedBranch = {
        branchId: `branch-${entity.entityId}-${Date.now()}`,
        parentSceneId: '',
        entityId: entity.entityId,
        entityLabel: entity.label,
        entityType: entity.type,
        actionType: entity.type === 'character' ? 'character_dialogue' : entity.type === 'animal' ? 'animal_interaction' : entity.type === 'location' ? 'location_branch' : 'object_detail',
        title: result.title || entity.label,
        narration: result.narration || '',
        sceneText: result.sceneText || '',
        imagePrompt: result.imagePrompt || '',
        imageUrl: null,
        nextActions: result.nextActions || [],
        status: result.narration ? 'ready' : 'failed',
      };

      setCachedResponse(cacheKey, branch, 'branch-agent');
      return branch;
    } catch {
      return {
        branchId: `branch-${entity.entityId}-failed`,
        parentSceneId: '', entityId: entity.entityId, entityLabel: entity.label,
        entityType: entity.type, actionType: 'failed',
        title: entity.label, narration: '', sceneText: '', imagePrompt: '',
        imageUrl: null, nextActions: [], status: 'failed',
      };
    }
  });

  const results = await Promise.allSettled(jobs);
  return results
    .filter((r): r is PromiseFulfilledResult<PreGeneratedBranch> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ── Generic AI Call (OpenAI primary, Gemini fallback) ────────

async function callAI<T>(systemPrompt: string, userPrompt: string): Promise<T> {
  if (isOpenAIConfigured()) {
    try {
      const client = getOpenAIClient();
      const res = await client.chat.completions.create({
        model: getOpenAIModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.75,
        max_tokens: 1500,
      });
      return JSON.parse(res.choices[0]?.message?.content || '{}') as T;
    } catch {
      // Fall through to Gemini
    }
  }

  if (isGeminiConfigured()) {
    const ai = getGeminiClient();
    const model = getTextModel();
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: { systemInstruction: systemPrompt, temperature: 0.75, maxOutputTokens: 2000, responseMimeType: 'application/json' },
    });
    return JSON.parse(res.text || '{}') as T;
  }

  throw new Error('No AI configured');
}

// ── Helpers ──────────────────────────────────────────────────

function classifyEntityType(label: string, characters: string[]): SceneEntity['type'] {
  const lowerLabel = label.toLowerCase();
  if (characters.some(c => c.toLowerCase() === lowerLabel)) return 'character';
  const animalWords = ['deer', 'eagle', 'bird', 'monkey', 'vanara', 'horse', 'elephant', 'snake', 'tiger', 'lion'];
  if (animalWords.some(a => lowerLabel.includes(a))) return 'animal';
  const locationWords = ['palace', 'forest', 'river', 'bridge', 'temple', 'path', 'mountain', 'ocean', 'city', 'garden', 'gate'];
  if (locationWords.some(l => lowerLabel.includes(l))) return 'location';
  const objectWords = ['bow', 'arrow', 'sword', 'crown', 'ring', 'lamp', 'chariot', 'throne', 'gem', 'flower'];
  if (objectWords.some(o => lowerLabel.includes(o))) return 'object';
  return 'background';
}
