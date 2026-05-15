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
export const ramayanaQuizzes: QuizQuestion[] = [
  { id: 'q-1-1', scene_id: 'ayodhya_intro', question: 'Who was the king of Ayodhya?', options: ['Janaka', 'Dasharatha', 'Ravana', 'Sugriva'], correct_answer: 1, explanation: 'King Dasharatha was the ruler of Ayodhya and father of Rama.', created_at: new Date().toISOString() },
  { id: 'q-1-2', scene_id: 'ayodhya_intro', question: 'How many sons did Dasharatha have?', options: ['Two', 'Three', 'Four', 'Five'], correct_answer: 2, explanation: 'Dasharatha had four sons: Rama, Bharata, Lakshmana, and Shatrughna.', created_at: new Date().toISOString() },
  { id: 'q-2-1', scene_id: 'mithila_bow', question: 'What did Rama do with the bow of Shiva?', options: ['Polished it', 'Could not lift it', 'Broke it', 'Hid it'], correct_answer: 2, explanation: 'Rama not only lifted but broke the mighty bow of Shiva.', created_at: new Date().toISOString() },
  { id: 'q-2-2', scene_id: 'mithila_bow', question: 'Who was Sita\'s father?', options: ['Dasharatha', 'Vishwamitra', 'Janaka', 'Sugriva'], correct_answer: 2, explanation: 'King Janaka of Mithila was Sita\'s father.', created_at: new Date().toISOString() },
  { id: 'q-3-1', scene_id: 'exile', question: 'How many years was Rama exiled for?', options: ['Seven', 'Ten', 'Twelve', 'Fourteen'], correct_answer: 3, explanation: 'Rama was exiled for fourteen years.', created_at: new Date().toISOString() },
  { id: 'q-4-1', scene_id: 'forest_life', question: 'What lured Rama away from the hermitage?', options: ['A golden deer', 'A storm', 'A messenger', 'A river'], correct_answer: 0, explanation: 'A magical golden deer, actually a demon in disguise, lured Rama away.', created_at: new Date().toISOString() },
  { id: 'q-5-1', scene_id: 'ravana_jatayu', question: 'Who tried to save Sita from Ravana?', options: ['Hanuman', 'Lakshmana', 'Jatayu', 'Sugriva'], correct_answer: 2, explanation: 'Jatayu, the noble eagle, bravely fought Ravana to save Sita.', created_at: new Date().toISOString() },
  { id: 'q-6-1', scene_id: 'hanuman_meets_rama', question: 'Who became Rama\'s greatest devotee?', options: ['Sugriva', 'Vibhishana', 'Hanuman', 'Bharata'], correct_answer: 2, explanation: 'Hanuman became Rama\'s greatest and most devoted follower.', created_at: new Date().toISOString() },
  { id: 'q-7-1', scene_id: 'hanuman_lanka', question: 'Where did Hanuman find Sita in Lanka?', options: ['In the palace', 'In a dungeon', 'In Ashoka Vatika', 'On a mountain'], correct_answer: 2, explanation: 'Hanuman found Sita in the Ashoka Vatika garden.', created_at: new Date().toISOString() },
  { id: 'q-9-1', scene_id: 'battle_lanka', question: 'Who was Ravana\'s brother who joined Rama?', options: ['Kumbhakarna', 'Vibhishana', 'Indrajit', 'Sugriva'], correct_answer: 1, explanation: 'Vibhishana chose dharma and joined Rama\'s side.', created_at: new Date().toISOString() },
  { id: 'q-10-1', scene_id: 'return_ayodhya', question: 'Who kept Rama\'s sandals on the throne?', options: ['Lakshmana', 'Hanuman', 'Bharata', 'Shatrughna'], correct_answer: 2, explanation: 'Bharata ruled as caretaker with Rama\'s sandals on the throne.', created_at: new Date().toISOString() },
  { id: 'q-11-1', scene_id: 'lessons', question: 'What lesson does Hanuman teach?', options: ['Pride', 'Devotion and humility', 'Anger', 'Wealth'], correct_answer: 1, explanation: 'Hanuman teaches that devotion and humility make us truly strong.', created_at: new Date().toISOString() },
];

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
  
  const quizzes = ramayanaQuizzes.filter(q => q.scene_id === sceneId);
  return { ...scene, hotspots, quiz_questions: quizzes };
}

export function getQuizzesBySceneId(sceneId: string): QuizQuestion[] {
  return ramayanaQuizzes.filter(q => q.scene_id === sceneId);
}

// Re-export everything
export { ramayanaScenes, getSceneById, getScenesByBookId } from './scenes';
export { ramayanaCharacters, getCharacterBySlug, getCharactersByBookId } from './characters';
export { ramayanaHotspots, getHotspotsBySceneId } from './hotspots';
