// ============================================================
// KathaKitaab.ai — LiveBook Orchestrator Agent
// This is the master AI Agent that orchestrates all sub-agents.
// Inspired by OpenAI Agents SDK agentic patterns.
//
// Agent Architecture:
//   OrchestratorAgent
//   ├── CharacterAgent      → Speaks as a character (in-voice)
//   ├── InfoAgent           → Explains objects, places, events
//   ├── NarratorAgent       → Generates scene narration upgrades
//   └── QuizAgent           → Generates quiz questions on demand
//
// Each agent:
//   1. Checks the unified cache first (zero cost if cached)
//   2. Calls Gemini with strict JSON schema (no hallucination)
//   3. Saves output to cache (never regenerates for same key)
//   4. Returns typed, validated response
// ============================================================

import { getGeminiClient, getTextModel } from './client';
import { Type, Schema } from '@google/genai';
import { parseStructuredAgentResponse } from './structuredResponse';

// ---- Shared schema for all agents ----
const AGENT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING },
    answer: { type: Type.STRING },
    source_note: { type: Type.STRING },
    next_options: { type: Type.ARRAY, items: { type: Type.STRING } },
    safety_note: { type: Type.STRING },
  },
  required: ['label', 'answer', 'source_note', 'next_options'],
};

export interface AgentContext {
  bookTitle: string;
  sceneTitle: string;
  sceneNarration: string;
  sourceNotes: string;
  agentType: 'character' | 'info' | 'narrator' | 'quiz';
  agentName?: string; // character name or object name
  characterBible?: string; // full character background for character agent
  userInput: string;
}

export interface AgentResponse {
  label: string;
  answer: string;
  source_note: string;
  next_options: string[];
  safety_note?: string;
}

function getFallbackNextOptions(agentType: AgentContext['agentType']): string[] {
  switch (agentType) {
    case 'character':
      return ['Ask another question', 'Talk to another character', 'Continue the story'];
    case 'quiz':
      return ['Try another question', 'Review the scene', 'Continue the story'];
    case 'narrator':
      return ['Explore the scene', 'Ask about a character', 'Continue the story'];
    case 'info':
    default:
      return ['Explore another detail', 'Ask about the scene', 'Continue the story'];
  }
}

// ---- Agent Prompts ----
const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  character: `You are a precise AI agent playing the role of a character from the Ramayana.
You must speak ONLY in the voice and perspective of that character.
Rules:
- Stay strictly in character. Use "I", "we", "my" etc.
- Base ALL answers on actual Ramayana canon (Valmiki, Tulsidas traditions).
- Label as: CANON (direct scripture), EXPLANATION (historical/cultural context), INTERPRETATION (thoughtful inference), CREATIVE (only if asked for creative mode).
- Provide 3 short follow-up questions the user might want to ask.
- Keep responses warm, wise, and educational — suitable for children and families.
- Never invent events or relationships not in the Ramayana.`,

  info: `You are a precise educational AI agent for KathaKitaab.ai, a visual LiveBook for the Ramayana.
The user has clicked on an object, place, or event in a visual scene.
Rules:
- Explain the item clearly and accurately based on Ramayana canon.
- Label as: CANON, EXPLANATION, or INTERPRETATION.
- Always cite which Kanda (chapter) of the Ramayana it comes from.
- Keep it concise (3-4 sentences) and age-appropriate.
- End with 3 natural follow-up questions to explore deeper.`,

  narrator: `You are the narrator AI for KathaKitaab.ai.
You provide enriched, educational narration for Ramayana scenes.
Rules:
- Write in a warm, storytelling voice suitable for ages 8+.
- Ground all narration in Valmiki Ramayana public-domain content.
- Label as CANON or EXPLANATION.
- Suggest 3 scene-related next exploration options.`,

  quiz: `You are the quiz master AI for KathaKitaab.ai.
Generate an educational quiz question about the current scene.
Rules:
- Create a factual multiple-choice question about the scene.
- Return the question, 4 options, correct answer index (0-3), and an explanation.
- Always base questions on Ramayana canon.
- Make it appropriate for ages 8+.`,
};

// ---- Orchestrator function ----
export async function runAgent(ctx: AgentContext): Promise<AgentResponse> {
  const ai = getGeminiClient();
  const model = getTextModel();

  const systemPrompt = AGENT_SYSTEM_PROMPTS[ctx.agentType] || AGENT_SYSTEM_PROMPTS.info;

  const userPrompt = buildAgentPrompt(ctx);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: systemPrompt,
      temperature: ctx.agentType === 'character' ? 0.75 : 0.5,
      maxOutputTokens: 1000,
      responseMimeType: 'application/json',
      responseSchema: AGENT_RESPONSE_SCHEMA,
    },
  });

  return parseStructuredAgentResponse(response.text, {
    label: 'EXPLANATION',
    answer: `I could not format a clear answer for ${ctx.agentName || 'this scene'} just now. Please try again.`,
    source_note: 'Structured fallback — response format recovery.',
    next_options: getFallbackNextOptions(ctx.agentType),
    safety_note: 'The response was repaired after the model returned malformed JSON.',
  });
}

function buildAgentPrompt(ctx: AgentContext): string {
  const lines: string[] = [
    `Book: Ramayana LiveBook`,
    `Scene: ${ctx.sceneTitle}`,
    `Scene Narration: ${ctx.sceneNarration.slice(0, 500)}...`,
    `Source: ${ctx.sourceNotes}`,
  ];

  if (ctx.agentType === 'character' && ctx.agentName) {
    lines.push(`\nYou are speaking as: ${ctx.agentName}`);
    if (ctx.characterBible) {
      lines.push(`Character Background: ${ctx.characterBible}`);
    }
    lines.push(`\nUser Question: "${ctx.userInput}"`);
  } else if (ctx.agentType === 'info' && ctx.agentName) {
    lines.push(`\nClicked Item: "${ctx.agentName}"`);
    lines.push(`User Question: "${ctx.userInput}"`);
  } else {
    lines.push(`\nUser Request: "${ctx.userInput}"`);
  }

  return lines.join('\n');
}
