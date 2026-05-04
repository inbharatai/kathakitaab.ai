// ============================================================
// KathaKitaab.ai — OpenAI Client
//
// Primary AI engine for:
//   - Story generation (gpt-4o with structured outputs)
//   - Image generation (gpt-image-1)
//   - Agent orchestration
//
// Gemini remains as fallback for text generation.
// ============================================================

import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set.');
  }

  client = new OpenAI({ apiKey });
  return client;
}

export function getOpenAIModel(): string {
  return process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
