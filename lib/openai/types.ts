import { AskCharacterResponse } from '@/lib/types/livebook';

export type { AskCharacterResponse };

export interface LiveBookAgentInput {
  book: { id: string; slug: string; title: string };
  scene: { scene_id: string; title: string; narration: string; source_notes: string };
  character: {
    name: string;
    role: string;
    traits: string[];
    speech_tone: string;
    source_notes: string;
  };
  userQuestion: string;
  mode: 'canon' | 'explanation' | 'interpretation' | 'creative';
  sourceContext: string;
}
