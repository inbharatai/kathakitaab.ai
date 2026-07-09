import { getOpenAIClient, getOpenAIModel } from './openaiClient';
import { buildLivebookSystemPrompt, buildCharacterPrompt } from './prompts';
import { LiveBookAgentInput, AskCharacterResponse } from './types';
import { parseStructuredAgentResponse } from './structuredResponse';

const FALLBACK_RESPONSE: AskCharacterResponse = {
  label: 'EXPLANATION',
  answer: 'I am unable to answer right now. The AI service may not be configured. Please check that the OPENAI_API_KEY is set in your environment.',
  source_note: 'System message — no AI model was called.',
  next_options: ['Try again later', 'Explore other characters', 'Continue the story'],
  safety_note: 'This is a fallback response.'
};

/**
 * Ask a character a question.
 *
 * Optional `history` (S1): prior {role, content} turns for this
 * (owner, book, character) thread, loaded by the route from Aurora
 * (or Redis fallback). When present, it is prepended between the
 * system prompt and the new user question so the model answers with
 * memory of the conversation. Absent → today's stateless behaviour.
 *
 * Optional `language` (S4): 'hi' routes the answer (and follow-up
 * options) to Hindi. Absent / 'en' / 'auto' → unchanged English.
 */
export async function askCharacter(
  input: LiveBookAgentInput,
  history?: { role: string; content: string }[],
  language?: 'hi' | 'en' | 'auto',
): Promise<AskCharacterResponse> {
  try {
    const client = getOpenAIClient();
    const model = getOpenAIModel();

    const userPrompt = buildCharacterPrompt({
      characterName: input.character.name,
      characterRole: input.character.role,
      characterTraits: input.character.traits,
      characterSpeechTone: input.character.speech_tone,
      sceneName: input.scene.title,
      sceneNarration: input.scene.narration,
      sourceNotes: input.character.source_notes + '\n' + input.scene.source_notes,
      mode: input.mode,
      question: input.userQuestion,
      language,
    });

    // Build the messages array: system, then prior history (user/assistant
    // turns in order), then the new user question. Only roles 'user' and
    // 'assistant' are valid chat turns; anything else is coerced to
    // 'user' so a corrupt thread can't 400 the request.
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: buildLivebookSystemPrompt(language) },
    ];
    if (Array.isArray(history)) {
      for (const turn of history) {
        if (!turn || typeof turn.content !== 'string') continue;
        const role = turn.role === 'assistant' ? 'assistant' : 'user';
        messages.push({ role, content: turn.content });
      }
    }
    messages.push({ role: 'user', content: userPrompt });

    const completion = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1000,
    });

    const raw = completion.choices[0]?.message?.content ?? '';

    const parsed = parseStructuredAgentResponse(raw, {
      ...FALLBACK_RESPONSE,
      answer: 'The AI returned a malformed response. Please try again.',
      safety_note: 'Structured response recovery fallback.',
    }) as AskCharacterResponse;

    // Validate label
    const validLabels = ['CANON', 'EXPLANATION', 'INTERPRETATION', 'CREATIVE'];
    if (!validLabels.includes(parsed.label)) {
      parsed.label = 'EXPLANATION';
    }

    // If mode is not creative but label is CREATIVE, override
    if (input.mode !== 'creative' && parsed.label === 'CREATIVE') {
      parsed.label = 'INTERPRETATION';
      parsed.safety_note = 'Response was re-labeled as creative mode is not enabled.';
    }

    return parsed;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('LiveBook Agent Error:', errorMessage);

    if (errorMessage.includes('API_KEY')) {
      return { ...FALLBACK_RESPONSE, answer: 'OpenAI API key is not configured. Please set OPENAI_API_KEY in your .env.local file to enable character conversations.' };
    }

    return { ...FALLBACK_RESPONSE, answer: `An error occurred while talking to ${input.character.name}. Please try again. (${errorMessage})` };
  }
}
