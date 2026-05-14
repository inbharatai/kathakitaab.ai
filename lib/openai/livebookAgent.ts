import { getOpenAIClient, getOpenAIModel } from './openaiClient';
import { LIVEBOOK_SYSTEM_PROMPT, buildCharacterPrompt } from './prompts';
import { LiveBookAgentInput, AskCharacterResponse } from './types';
import { parseStructuredAgentResponse } from './structuredResponse';

const FALLBACK_RESPONSE: AskCharacterResponse = {
  label: 'EXPLANATION',
  answer: 'I am unable to answer right now. The AI service may not be configured. Please check that the OPENAI_API_KEY is set in your environment.',
  source_note: 'System message — no AI model was called.',
  next_options: ['Try again later', 'Explore other characters', 'Continue the story'],
  safety_note: 'This is a fallback response.'
};

export async function askCharacter(input: LiveBookAgentInput): Promise<AskCharacterResponse> {
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
    });

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: LIVEBOOK_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
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
