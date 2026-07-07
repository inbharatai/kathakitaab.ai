import { Book, QuizQuestion, SourceReference, SceneWithHotspots } from '@/lib/types/livebook';
import { getSceneById } from './scenes';
import { getCharacterBySlug } from './characters';
import { getHotspotsBySceneId } from './hotspots';

// ---- Book ----
export const ramayanaBook: Book = {
  id: 'ramayana-livebook',
  slug: 'ramayana',
  title: 'Ramayana LiveBook',
  subtitle: 'A 15-Minute Interactive Visual Journey',
  description: 'Experience the timeless Ramayana through clickable scenes, character conversations, and interactive learning. Explore the story of Rama, Sita, Hanuman, and the eternal lessons of dharma.',
  status: 'mvp',
  cover_image_url: '',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  accuracyLabel: 'CANONICAL',
};

// ---- Quiz Questions ----
// Quizzes are inlined on each scene in `scenes.ts` (single source of
// truth). `getQuizzesBySceneId` below reads them from there, so there
// is no separate quiz array to keep in sync.

// ---- Source References ----
export const ramayanaSources: SourceReference[] = [
  { id: 'src-1', book_id: 'ramayana-livebook', reference_title: 'Valmiki Ramayana (Public Domain)', reference_url: '', reference_note: 'The original Sanskrit epic by Sage Valmiki. This MVP uses simplified narration inspired by public-domain Ramayana traditions.', created_at: new Date().toISOString() },
  { id: 'src-2', book_id: 'ramayana-livebook', reference_title: 'Public Domain Ramayana Traditions', reference_url: '', reference_note: 'General Ramayana storytelling tradition, widely known and retold across cultures. No copyrighted modern adaptation is used.', created_at: new Date().toISOString() },
];

// ---- Accessor Functions ----
export function getBook(slug: string): Book | undefined {
  if (slug === 'ramayana') return ramayanaBook;
  return undefined;
}

export function getAllBooks(): Book[] {
  return [ramayanaBook];
}

export function getSceneWithHotspots(sceneId: string): SceneWithHotspots | undefined {
  const scene = getSceneById(sceneId);
  if (!scene) return undefined;
  
  const rawHotspots = getHotspotsBySceneId(sceneId);
  const hotspots = rawHotspots.map(h => {
    if (h.target_type === 'character') {
      const char = getCharacterBySlug(h.target_id);
      if (char?.image_url) {
        return { ...h, character_image_url: char.image_url };
      }
    }
    return h;
  });

  // Quizzes now live inline on each scene (single source of truth in
  // scenes.ts) — no separate quiz array to keep in sync.
  return { ...scene, hotspots };
}

export function getQuizzesBySceneId(sceneId: string): QuizQuestion[] {
  const scene = getSceneById(sceneId);
  return scene?.quiz_questions ?? [];
}

// Re-export everything
export { ramayanaScenes, getSceneById, getScenesByBookId } from './scenes';
export { ramayanaCharacters, getCharacterBySlug, getCharactersByBookId } from './characters';
export { ramayanaHotspots, getHotspotsBySceneId } from './hotspots';
