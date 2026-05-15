// ============================================================
// KathaKitaab — Research Agent
//
// Grounds story content in real web sources before generation.
// Uses OpenAI responses API with web_search tool.
// Falls back to no grounding if unavailable.
// ============================================================

import { getOpenAIClient, isOpenAIConfigured } from '@/lib/openai/openaiClient';
import { getGeminiClient, getTextModel, isGeminiConfigured } from '@/lib/openai/client';

/**
 * Research a topic using web search to ground content in real sources.
 * Returns a context string with key facts and citations.
 * Returns undefined if research is unavailable.
 */
export async function researchTopic(
  bookTitle: string,
  sceneContext: string,
): Promise<string | undefined> {
  if (!isOpenAIConfigured()) return undefined;

  try {
    const client = getOpenAIClient();

    const response = await client.responses.create({
      model: 'gpt-4o-mini',
      tools: [{ type: 'web_search' as never }],
      input: `Research accurate, authoritative information about "${sceneContext}" from "${bookTitle}".

Focus on:
- Key historical/mythological events and their sequence
- Characters involved and their roles
- Cultural and historical significance
- Accurate names, places, and details

Keep the response concise (under 300 words). Cite sources where possible.
This will be used to generate an educational children's storybook scene.`,
    });

    // Extract text from response
    const text = response.output_text;
    if (text && text.length > 50) {
      return text;
    }
    return undefined;

  } catch (err) {
    console.error('[ResearchAgent] OpenAI web search failed:', err);
  }

  // Fallback: use Gemini with grounding (no web search, but model knowledge)
  if (isGeminiConfigured()) {
    try {
      const ai = getGeminiClient();
      const model = getTextModel();
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: `Provide accurate, factual information about "${sceneContext}" from "${bookTitle}".
Focus on: key events, characters, cultural significance, authentic details.
Cite the original source tradition. Keep under 200 words.` }] }],
        config: { temperature: 0.3, maxOutputTokens: 500 },
      });
      const text = response.text;
      if (text && text.length > 50) return text;
    } catch (err2) {
      console.error('[ResearchAgent] Gemini fallback failed:', err2);
    }
  }

  return undefined;
}
