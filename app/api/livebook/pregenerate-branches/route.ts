// ============================================================
// KathaKitaab.ai — Pre-Generate Branches API
// POST /api/livebook/pregenerate-branches
//
// Called when a scene loads. Generates interaction branches
// for ALL entities in the scene in parallel.
// Results are cached — when user clicks, it's instant.
//
// This is the difference between "click and wait 20 seconds"
// and "click and it's already there."
// ============================================================

import { NextResponse } from 'next/server';
import { getOpenAIClient, getOpenAIModel, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';
import { checkContentSafety } from '@/lib/agents/safetyAgent';
import { checkRateLimit, runInBatches, MAX_PARALLEL_BRANCHES } from '@/lib/middleware/rateLimit';
import {
  getCachedBranch, saveCachedBranch, saveManifest, getManifest,
  type PreGeneratedBranch, type BranchManifest,
} from '@/lib/engine/branchPreGenerator';

interface Entity {
  entityId: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

interface PregenerateRequest {
  bookSlug: string;
  bookTitle: string;
  sceneId: string;
  sceneTitle: string;
  sceneNarration: string;
  entities: Entity[];
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, { scope: 'expensive' });
  if (limited) return limited;

  try {
    const body: PregenerateRequest = await request.json();
    const { bookSlug, bookTitle, sceneId, sceneTitle, sceneNarration, entities } = body;

    if (!entities || entities.length === 0) {
      return NextResponse.json({ status: 'no_entities', branches: [] });
    }

    // Check if manifest already exists
    const existing = getManifest(sceneId);
    if (existing && existing.status === 'ready') {
      return NextResponse.json({ status: 'cached', manifest: existing });
    }

    // Cap total entities at 8 and process in concurrency-limited batches
    // (default 2 parallel) so we never fan out 8 OpenAI calls at once.
    const branches = await runInBatches(
      entities.slice(0, 8),
      MAX_PARALLEL_BRANCHES,
      async (entity): Promise<PreGeneratedBranch> => {
        const cached = getCachedBranch(sceneId, entity.entityId);
        if (cached) return cached;

        try {
          const branch = await generateBranchForEntity(
            bookTitle, sceneId, sceneTitle, sceneNarration, entity,
          );

          const safety = checkContentSafety(branch.narration + ' ' + branch.sceneText);
          if (!safety.passed) {
            return { ...branch, status: 'failed' as const, narration: 'This content is not available.', sceneText: '' };
          }

          saveCachedBranch(sceneId, entity.entityId, branch);
          return branch;
        } catch (err) {
          console.error(`[PreGen] Failed for ${entity.label}:`, err);
          return {
            branchId: `branch-${sceneId}-${entity.entityId}-failed`,
            parentSceneId: sceneId,
            entityId: entity.entityId,
            entityLabel: entity.label,
            entityType: entity.type as PreGeneratedBranch['entityType'],
            actionType: 'failed',
            title: entity.label,
            narration: '',
            sceneText: '',
            imagePrompt: '',
            imageUrl: null,
            nextActions: [],
            status: 'failed' as const,
          };
        }
      },
    );

    const readyCount = branches.filter(b => b.status === 'ready').length;

    const manifest: BranchManifest = {
      sceneId,
      bookId: bookSlug,
      branches,
      generatedAt: Date.now(),
      status: readyCount === branches.length ? 'ready' : readyCount > 0 ? 'partial' : 'failed',
    };

    saveManifest(manifest);

    return NextResponse.json({ status: manifest.status, manifest, readyCount, total: branches.length });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Pre-generation failed';
    console.error('[PreGen Error]', msg);
    return NextResponse.json({ status: 'error', error: msg }, { status: 500 });
  }
}

// ── Generate a single branch for one entity ──────────────────

async function generateBranchForEntity(
  bookTitle: string,
  sceneId: string,
  sceneTitle: string,
  sceneNarration: string,
  entity: Entity,
): Promise<PreGeneratedBranch> {
  const actionMap: Record<string, string> = {
    character: 'character_dialogue',
    object: 'object_detail',
    location: 'location_branch',
    animal: 'animal_interaction',
    place: 'location_branch',
    background: 'hidden_discovery',
  };

  const promptMap: Record<string, string> = {
    character: `Generate an interactive dialogue moment with "${entity.label}". Show their inner thoughts, a short spoken line, and what they do next. Make it emotional and cinematic.`,
    object: `Generate a discovery about "${entity.label}". Reveal its history, significance, and a hidden detail. Make it feel like finding a game secret.`,
    location: `Generate a location exploration for "${entity.label}". Describe what the user sees, hears, and discovers by moving into this area. Create atmosphere.`,
    animal: `Generate an interaction with "${entity.label}". Show the animal's behavior, its significance in the story, and what happens when the user approaches.`,
    place: `Generate a location discovery for "${entity.label}". Reveal what is hidden in this place.`,
    background: `Generate an atmospheric detail about "${entity.label}". What does the user notice, hear, or discover here?`,
  };

  const systemPrompt = `You are a Living Story Engine for "${bookTitle}". Generate a rich interactive moment for the scene "${sceneTitle}".
Context: ${sceneNarration.slice(0, 400)}

Respond with valid JSON:
{
  "title": "short cinematic title",
  "narration": "2-3 sentences that TTS will speak aloud (warm, vivid)",
  "sceneText": "1 paragraph of rich descriptive text",
  "imagePrompt": "detailed visual description for image generation",
  "nextActions": ["3 follow-up actions the user could take"]
}`;

  const userPrompt = promptMap[entity.type] || promptMap.background;
  let result: { title: string; narration: string; sceneText: string; imagePrompt: string; nextActions: string[] };

  if (isOpenAIConfigured()) {
    try {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: getOpenAIModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 600,
      });
      result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    } catch {
      result = await generateWithGemini(systemPrompt, userPrompt);
    }
  } else if (isGeminiConfigured()) {
    result = await generateWithGemini(systemPrompt, userPrompt);
  } else {
    throw new Error('No AI configured');
  }

  return {
    branchId: `branch-${sceneId}-${entity.entityId}-${Date.now()}`,
    parentSceneId: sceneId,
    entityId: entity.entityId,
    entityLabel: entity.label,
    entityType: entity.type as PreGeneratedBranch['entityType'],
    actionType: actionMap[entity.type] || 'hidden_discovery',
    title: result.title || entity.label,
    narration: result.narration || '',
    sceneText: result.sceneText || '',
    imagePrompt: result.imagePrompt || '',
    imageUrl: null, // Images generated on-demand to save cost
    nextActions: result.nextActions || [],
    status: 'ready' as const,
  };
}

async function generateWithGemini(systemPrompt: string, userPrompt: string) {
  const ai = getGeminiClient();
  const model = getTextModel();
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: { systemInstruction: systemPrompt, temperature: 0.8, maxOutputTokens: 800, responseMimeType: 'application/json' },
  });
  return JSON.parse(res.text || '{}');
}
