import { getGeminiClient, getTextModel } from './client';
import { Type, Schema } from '@google/genai';
import { parseStructuredAgentResponse } from './structuredResponse';

const SYSTEM_PROMPT = `You are the KathaKitaab.ai engine, an educational, source-grounded visual book assistant.
The user has clicked on an object, place, or character in a scene from a book.
Provide a clear, engaging, and accurate explanation of this element based on the scene context and any canonical source material provided.

Strict Rules:
1. Be concise and educational.
2. Label the answer as CANON (drawn directly from canonical source), EXPLANATION (factual context), or INTERPRETATION (reasoned inference clearly marked as such).
3. Provide exactly 3 short next questions the user might ask.
4. Keep the source_note accurate. If canonical source material is provided, cite it. Otherwise note "Based on scene context — not verified to source."
5. Never contradict canonical source material when provided.
6. If the topic is not covered in the provided context, say so plainly rather than inventing detail.`;

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING },
    answer: { type: Type.STRING },
    source_note: { type: Type.STRING },
    next_options: { type: Type.ARRAY, items: { type: Type.STRING } },
    safety_note: { type: Type.STRING }
  },
  required: ['label', 'answer', 'source_note', 'next_options']
};

export async function generateInfo(
  sceneTitle: string,
  narration: string,
  clickedItem: string,
  question?: string,
  /** Optional canon context to inject. When present, the LLM treats it as authoritative. */
  canonContext?: string,
  /** Optional book title for richer context. Falls back to generic phrasing if absent. */
  bookTitle?: string,
) {
  const ai = getGeminiClient();
  const model = getTextModel();

  const userPrompt = `${bookTitle ? `Book: ${bookTitle}\n` : ''}Scene: ${sceneTitle}
Narration: ${narration}
Clicked Item: ${clickedItem}${canonContext ? `\n\n${canonContext}` : ''}
${question ? `\nUser Question: ${question}` : '\nRequest: Explain this item and its significance in this scene.'}`;

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.7,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
    }
  });

  return parseStructuredAgentResponse(response.text, {
    label: 'EXPLANATION',
    answer: `I could not explain ${clickedItem} clearly just now. Please try again.`,
    source_note: 'Structured fallback — response format recovery.',
    next_options: ['Explore another detail', 'Ask about the scene', 'Continue the story'],
    safety_note: 'The response was repaired after the model returned malformed JSON.',
  });
}
