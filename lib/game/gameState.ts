// ============================================================
// KathaKitaab — Game State Engine
// Persisted to localStorage. Tracks XP, Dharma Score,
// achievements, character bonds, scene exploration, and streaks.
// Think: Duolingo XP + Assassin's Creed Discovery Tour progress.
// ============================================================

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  xp: number;
  unlockedAt?: number;
}

export interface CharacterBond {
  slug: string;
  name: string;
  level: number;       // 0-5
  interactions: number;
}

export interface GameState {
  dharmaScore: number;
  totalXP: number;
  level: number;
  scenesVisited: string[];
  charactersMetSlugs: string[];
  characterBonds: Record<string, CharacterBond>;
  achievements: Achievement[];
  unlockedAchievementIds: string[];
  questionsAsked: number;
  quizCorrect: number;
  quizAttempted: number;
  currentStreak: number;
  lastActiveAt: number;
  discoveredHotspots: string[]; // hotspot ids
}

export const ALL_ACHIEVEMENTS: Achievement[] = [
  { id: 'first_step',      title: 'First Step on Dharma',  description: 'Entered the Ramayana for the first time.',                  icon: '🪔', xp: 50 },
  { id: 'met_rama',        title: 'Friend of Rama',         description: 'Spoke with Lord Rama.',                                      icon: '🏹', xp: 100 },
  { id: 'met_hanuman',     title: 'Devotee of Hanuman',     description: 'Connected with the great Hanuman.',                          icon: '🐒', xp: 100 },
  { id: 'met_sita',        title: 'Seeker of Sita',         description: "Learned about Sita's courage and grace.",                 icon: '🌸', xp: 100 },
  { id: 'met_ravana',      title: 'Knew the Adversary',     description: "Understood Ravana's complexity.",                          icon: '👑', xp: 100 },
  { id: 'quiz_first',      title: 'First Scholar',          description: 'Answered your first quiz question.',                       icon: '📚', xp: 75 },
  { id: 'quiz_perfect',    title: 'Dharma Scholar',         description: 'Got 5 quiz questions correct in a row.',                   icon: '🎓', xp: 200 },
  { id: 'explorer',        title: 'Scene Explorer',         description: 'Visited 5 different scenes.',                              icon: '🗺️', xp: 150 },
  { id: 'deep_diver',      title: 'Deep Diver',             description: 'Clicked Explore Deeper 10 times.',                         icon: '🔍', xp: 125 },
  { id: 'all_scenes',      title: 'Full Journey',           description: 'Completed the entire Ramayana journey.',                   icon: '🌟', xp: 500 },
  { id: 'bond_rama',       title: "Rama's Trusted",         description: 'Reached Bond Level 3 with Rama.',                          icon: '💛', xp: 250 },
  { id: 'discoverer',      title: 'Discoverer',             description: 'Found 10 hidden hotspots.',                                  icon: '✨', xp: 175 },
  { id: 'source_seeker',   title: 'Source Seeker',          description: 'Read the source note on 5 different pages.',                 icon: '📜', xp: 100 },
];

const STORAGE_KEY = 'kathakitaab_gamestate';

const DEFAULT_STATE: GameState = {
  dharmaScore: 0,
  totalXP: 0,
  level: 1,
  scenesVisited: [],
  charactersMetSlugs: [],
  characterBonds: {},
  achievements: ALL_ACHIEVEMENTS,
  unlockedAchievementIds: [],
  questionsAsked: 0,
  quizCorrect: 0,
  quizAttempted: 0,
  currentStreak: 0,
  lastActiveAt: Date.now(),
  discoveredHotspots: [],
};

export function loadGameState(): GameState {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function createDefaultGameState(): GameState {
  return {
    ...DEFAULT_STATE,
    scenesVisited: [],
    charactersMetSlugs: [],
    characterBonds: {},
    achievements: ALL_ACHIEVEMENTS.map(achievement => ({ ...achievement })),
    unlockedAchievementIds: [],
    discoveredHotspots: [],
    lastActiveAt: Date.now(),
  };
}

export function saveGameState(state: GameState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearGameState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

// ---- XP + Level ----
export function addXP(state: GameState, amount: number): { newState: GameState; leveledUp: boolean } {
  const newXP = state.totalXP + amount;
  const newDharma = state.dharmaScore + amount;
  const newLevel = Math.floor(newXP / 300) + 1;
  const leveledUp = newLevel > state.level;
  const newState = { ...state, totalXP: newXP, dharmaScore: newDharma, level: newLevel };
  saveGameState(newState);
  return { newState, leveledUp };
}

// ---- Events ----
export function recordSceneVisit(state: GameState, sceneId: string): GameState {
  if (state.scenesVisited.includes(sceneId)) return state;
  const newState = { ...state, scenesVisited: [...state.scenesVisited, sceneId] };
  saveGameState(newState);
  return newState;
}

export function recordCharacterMet(state: GameState, slug: string, name: string): GameState {
  const bonds = { ...state.characterBonds };
  if (!bonds[slug]) bonds[slug] = { slug, name, level: 1, interactions: 1 };
  else bonds[slug] = { ...bonds[slug], interactions: bonds[slug].interactions + 1 };

  // Level up bond every 3 interactions
  bonds[slug].level = Math.min(5, Math.floor(bonds[slug].interactions / 3) + 1);

  const newSlugs = state.charactersMetSlugs.includes(slug)
    ? state.charactersMetSlugs
    : [...state.charactersMetSlugs, slug];

  const newState = { ...state, characterBonds: bonds, charactersMetSlugs: newSlugs };
  saveGameState(newState);
  return newState;
}

export function recordHotspotDiscovered(state: GameState, hotspotId: string): GameState {
  if (state.discoveredHotspots.includes(hotspotId)) return state;
  const newState = { ...state, discoveredHotspots: [...state.discoveredHotspots, hotspotId] };
  saveGameState(newState);
  return newState;
}

export function recordQuizAnswer(state: GameState, correct: boolean): GameState {
  const newStreak = correct ? state.currentStreak + 1 : 0;
  const newState = {
    ...state,
    quizAttempted: state.quizAttempted + 1,
    quizCorrect: correct ? state.quizCorrect + 1 : state.quizCorrect,
    currentStreak: newStreak,
  };
  saveGameState(newState);
  return newState;
}

export function recordDeepDive(state: GameState): GameState {
  const newState = { ...state, questionsAsked: state.questionsAsked + 1 };
  saveGameState(newState);
  return newState;
}

// ---- Achievement Check ----
export function checkAchievements(state: GameState): { newState: GameState; newlyUnlocked: Achievement[] } {
  const newlyUnlocked: Achievement[] = [];
  const unlocked = new Set(state.unlockedAchievementIds);

  const check = (id: string, condition: boolean) => {
    if (!unlocked.has(id) && condition) {
      unlocked.add(id);
      const ach = ALL_ACHIEVEMENTS.find(a => a.id === id);
      if (ach) newlyUnlocked.push({ ...ach, unlockedAt: Date.now() });
    }
  };

  check('first_step',    state.scenesVisited.length >= 1);
  check('met_rama',      state.charactersMetSlugs.includes('rama'));
  check('met_hanuman',   state.charactersMetSlugs.includes('hanuman'));
  check('met_sita',      state.charactersMetSlugs.includes('sita'));
  check('met_ravana',    state.charactersMetSlugs.includes('ravana'));
  check('quiz_first',    state.quizAttempted >= 1);
  check('quiz_perfect',  state.currentStreak >= 5);
  check('explorer',      state.scenesVisited.length >= 5);
  check('deep_diver',    state.questionsAsked >= 10);
  check('all_scenes',    state.scenesVisited.length >= 12);
  check('bond_rama',     (state.characterBonds['rama']?.level ?? 0) >= 3);
  check('discoverer',    state.discoveredHotspots.length >= 10);

  const newState = { ...state, unlockedAchievementIds: Array.from(unlocked) };
  if (newlyUnlocked.length > 0) saveGameState(newState);
  return { newState, newlyUnlocked };
}

export function getLevelTitle(level: number): string {
  const titles = [
    'Wanderer', 'Seeker', 'Student of Dharma', 'Guardian', 'Warrior of Truth',
    'Sage', 'Rishi', 'Maharishi', 'Devarshi', 'Brahmarshi'
  ];
  return titles[Math.min(level - 1, titles.length - 1)];
}

export function getXPProgress(state: GameState): number {
  const currentLevelXP = (state.level - 1) * 300;
  const xpIntoLevel = state.totalXP - currentLevelXP;
  return Math.min(100, (xpIntoLevel / 300) * 100);
}
