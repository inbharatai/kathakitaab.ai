import {
  DEFAULT_WORLD_STATE,
  CHARACTER_STARTING_TOOLS,
  clearWorldState,
  type WorldState,
  saveWorldState,
} from '@/lib/game/worldMasterAgent';
import {
  DEFAULT_QUEST_STATE,
  buildMainQuestForScene,
  clearQuestState,
  saveQuestState,
  type QuestState,
} from '@/lib/game/questAgent';
import {
  clearGameState,
  createDefaultGameState,
  saveGameState,
  type GameState,
} from '@/lib/game/gameState';

export type AgeBand = 'child' | 'youth' | 'adult';

export interface PlayableCharacterSnapshot {
  id: string;
  name: string;
  class: string;
  emoji: string;
  description: string;
  traits: string[];
  stats: {
    strength: number;
    intelligence: number;
    courage: number;
    creativity: number;
    empathy: number;
    memory: number;
  };
  specialTool: string;
  specialToolEmoji: string;
  weakness: string;
  color: string;
  glowColor: string;
}

export interface PlaySessionState {
  version: number;
  sessionId: string;
  bookSlug: string;
  ageBand: AgeBand;
  selectedCharacter: PlayableCharacterSnapshot;
  currentSceneId: string;
  unlockedTools: string[];
  gameState: GameState;
  worldState: WorldState;
  questState: QuestState;
  createdAt: number;
  updatedAt: number;
}

export interface PlaySceneSyncInput {
  sceneId: string;
  sceneTitle: string;
  sceneOrder: number;
  totalChapters: number;
  nearbyCharacterSlugs: string[];
}

export interface BootstrapPlaySessionInput extends PlaySceneSyncInput {
  bookSlug: string;
  ageBand: AgeBand;
  selectedCharacter: PlayableCharacterSnapshot;
}

const PLAY_SESSION_VERSION = 1;
const PLAY_SESSION_STORAGE_PREFIX = 'kathakitaab_play_session:';

function getPlaySessionStorageKey(bookSlug: string): string {
  return `${PLAY_SESSION_STORAGE_PREFIX}${bookSlug}`;
}

function createSessionId(): string {
  return `play-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function titleizeSlug(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ensureNpcStates(worldState: WorldState, nearbyCharacterSlugs: string[]): WorldState['npcStates'] {
  const nextNpcStates = { ...worldState.npcStates };

  for (const slug of nearbyCharacterSlugs) {
    if (nextNpcStates[slug]) continue;

    nextNpcStates[slug] = {
      slug,
      name: titleizeSlug(slug),
      trustLevel: 50,
      fearLevel: 0,
      allegiance: 'neutral',
      lastInteractionSummary: '',
      questsOffered: [],
      questsCompleted: [],
    };
  }

  return nextNpcStates;
}

function ensureSceneQuest(questState: QuestState, sceneId: string, sceneTitle: string): QuestState {
  const mainQuestId = `quest-main-${sceneId}`;
  const alreadyTracked =
    questState.activeQuests.some(quest => quest.id === mainQuestId) ||
    questState.completedQuestIds.includes(mainQuestId) ||
    questState.failedQuestIds.includes(mainQuestId);

  if (alreadyTracked) {
    return questState;
  }

  const mainQuest = buildMainQuestForScene(sceneId, sceneTitle);

  return {
    ...questState,
    activeQuests: [
      ...questState.activeQuests,
      {
        ...mainQuest,
        status: 'ACTIVE',
        acceptedAt: Date.now(),
      },
    ],
  };
}

export function loadPlaySession(bookSlug: string): PlaySessionState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(getPlaySessionStorageKey(bookSlug));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PlaySessionState;
    if (parsed.version !== PLAY_SESSION_VERSION) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function savePlaySession(state: PlaySessionState): PlaySessionState {
  const nextState = {
    ...state,
    version: PLAY_SESSION_VERSION,
    updatedAt: Date.now(),
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(getPlaySessionStorageKey(state.bookSlug), JSON.stringify(nextState));
    saveGameState(nextState.gameState);
    saveWorldState(nextState.worldState);
    saveQuestState(nextState.questState);
  }

  return nextState;
}

export function clearPlaySession(bookSlug: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(getPlaySessionStorageKey(bookSlug));
  clearGameState();
  clearWorldState();
  clearQuestState();
}

export function ensureSceneInPlaySession(
  session: PlaySessionState,
  scene: PlaySceneSyncInput
): PlaySessionState {
  const worldState: WorldState = {
    ...session.worldState,
    currentSceneId: scene.sceneId,
    currentLocationId: scene.sceneId,
    currentChapter: scene.sceneOrder,
    totalChapters: scene.totalChapters,
    unlockedLocations: uniqueStrings([...session.worldState.unlockedLocations, scene.sceneId]),
    npcStates: ensureNpcStates(session.worldState, scene.nearbyCharacterSlugs),
  };

  const questState = ensureSceneQuest(session.questState, scene.sceneId, scene.sceneTitle);

  return {
    ...session,
    currentSceneId: scene.sceneId,
    worldState,
    questState,
    updatedAt: Date.now(),
  };
}

export function updatePlaySessionGameState(
  session: PlaySessionState,
  gameState: GameState
): PlaySessionState {
  return {
    ...session,
    gameState,
    updatedAt: Date.now(),
  };
}

export function bootstrapPlaySession(input: BootstrapPlaySessionInput): PlaySessionState {
  const startingTools = CHARACTER_STARTING_TOOLS[input.selectedCharacter.class] ?? [];

  const baseSession: PlaySessionState = {
    version: PLAY_SESSION_VERSION,
    sessionId: createSessionId(),
    bookSlug: input.bookSlug,
    ageBand: input.ageBand,
    selectedCharacter: input.selectedCharacter,
    currentSceneId: input.sceneId,
    unlockedTools: uniqueStrings(startingTools),
    gameState: createDefaultGameState(),
    worldState: {
      ...DEFAULT_WORLD_STATE,
      currentSceneId: input.sceneId,
      currentLocationId: input.sceneId,
      currentChapter: input.sceneOrder,
      totalChapters: input.totalChapters,
    },
    questState: { ...DEFAULT_QUEST_STATE },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return savePlaySession(ensureSceneInPlaySession(baseSession, input));
}