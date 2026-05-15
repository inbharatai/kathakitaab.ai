// ============================================================
// KathaKitaab — Continuity Agent
//
// Tracks world state across dynamically generated scenes.
// Maintains: who is where, what happened, plot threads, mood.
// Pure logic — no LLM calls needed.
// ============================================================

export interface ContinuityState {
  /** Summary of the story so far (grows with each scene) */
  storySoFar: string;
  /** Characters encountered and their last known states */
  characterStates: Record<string, {
    lastSeen: string;
    mood: string;
    relationship: string;
  }>;
  /** Key plot events that have occurred */
  plotEvents: string[];
  /** Current location/setting */
  currentLocation: string;
  /** Emotional arc state */
  currentMood: string;
  /** Number of scenes generated */
  sceneCount: number;
  /** User choices that shaped the story */
  userChoices: string[];
}

export function createInitialContinuity(): ContinuityState {
  return {
    storySoFar: '',
    characterStates: {},
    plotEvents: [],
    currentLocation: '',
    currentMood: 'serene',
    sceneCount: 0,
    userChoices: [],
  };
}

export function updateContinuity(
  prev: ContinuityState,
  sceneTitle: string,
  continuityLine: string,
  charactersPresent: string[],
  mood: string,
  userChoice?: string,
): ContinuityState {
  const storySoFar = prev.storySoFar
    ? `${prev.storySoFar} | ${continuityLine}`
    : continuityLine;

  const characterStates = { ...prev.characterStates };
  for (const char of charactersPresent) {
    characterStates[char] = {
      lastSeen: sceneTitle,
      mood,
      relationship: characterStates[char]?.relationship ?? 'neutral',
    };
  }

  return {
    storySoFar,
    characterStates,
    plotEvents: [...prev.plotEvents, continuityLine],
    currentLocation: sceneTitle,
    currentMood: mood,
    sceneCount: prev.sceneCount + 1,
    userChoices: userChoice
      ? [...prev.userChoices, userChoice]
      : prev.userChoices,
  };
}

export function getContinuitySummary(state: ContinuityState): string {
  const parts: string[] = [];

  if (state.storySoFar) {
    parts.push(`Story so far: ${state.storySoFar}`);
  }

  const activeChars = Object.entries(state.characterStates);
  if (activeChars.length > 0) {
    parts.push(`Characters: ${activeChars.map(([name, s]) => `${name} (${s.mood}, last at ${s.lastSeen})`).join('; ')}`);
  }

  if (state.userChoices.length > 0) {
    parts.push(`User choices: ${state.userChoices.slice(-3).join('; ')}`);
  }

  parts.push(`Current mood: ${state.currentMood}`);
  parts.push(`Scenes generated: ${state.sceneCount}`);

  return parts.join('. ');
}

// ── Persistence (localStorage) ───────────────────────────────

const CONTINUITY_KEY = 'kathakitaab_continuity';

export function saveContinuity(bookSlug: string, state: ContinuityState): void {
  if (typeof window === 'undefined') return;
  const key = `${CONTINUITY_KEY}_${bookSlug}`;
  localStorage.setItem(key, JSON.stringify(state));
}

export function loadContinuity(bookSlug: string): ContinuityState {
  if (typeof window === 'undefined') return createInitialContinuity();
  const key = `${CONTINUITY_KEY}_${bookSlug}`;
  const raw = localStorage.getItem(key);
  if (!raw) return createInitialContinuity();
  try {
    return JSON.parse(raw) as ContinuityState;
  } catch {
    return createInitialContinuity();
  }
}
