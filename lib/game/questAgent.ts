// ============================================================
// KathaKitaab.ai — Quest Agent
//
// Generates and manages missions in the story world.
// Every chapter becomes a quest. Every quest has:
//   · Main Quest (drives story forward)
//   · Side Quests (optional depth)
//   · Dialogue Quests (talk your way through)
//   · Moral Choice Quests (no single right answer)
//   · Puzzle Quests (knowledge/logic challenges)
//   · Creative Challenges (player builds something)
// ============================================================

export type QuestType =
  | 'MAIN'
  | 'SIDE'
  | 'DIALOGUE'
  | 'MORAL_CHOICE'
  | 'PUZZLE'
  | 'CREATIVE_CHALLENGE'
  | 'KNOWLEDGE_CHALLENGE';

export type QuestStatus = 'LOCKED' | 'AVAILABLE' | 'ACTIVE' | 'COMPLETED' | 'FAILED';

export interface QuestObjective {
  id: string;
  description: string;
  completed: boolean;
  optional: boolean;
  hint?: string;
}

export interface QuestReward {
  xp: number;
  coins: number;
  badge?: { id: string; title: string; icon: string };
  toolUnlock?: string;      // tool id to unlock
  storyCardId?: string;     // story card earned
  newChapterId?: string;    // unlocks a new chapter/scene
  secretEnding?: boolean;
}

export interface Quest {
  id: string;
  type: QuestType;
  title: string;
  description: string;
  loreText: string;           // In-world flavor text ("The Oracle speaks...")
  sceneId: string;            // Where this quest takes place
  characterSlug?: string;     // Which character gives / is associated with this quest
  objectives: QuestObjective[];
  reward: QuestReward;
  status: QuestStatus;
  acceptedAt?: number;
  completedAt?: number;
  failCondition?: string;     // e.g. "trust score with Mentor drops below 20"
  timeLimit?: number;         // in story chapters
  moralWeight?: 'light' | 'dark' | 'neutral'; // affects alignment
}

export interface QuestState {
  activeQuests: Quest[];
  completedQuestIds: string[];
  failedQuestIds: string[];
  totalQuestsCompleted: number;
  storyCards: StoryCard[];
  coins: number;
}

export interface StoryCard {
  id: string;
  title: string;
  illustration: string;   // emoji or image url
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  description: string;
  unlockedAt: number;
}

const QUEST_STORAGE_KEY = 'kathakitaab_quest_state';

export const DEFAULT_QUEST_STATE: QuestState = {
  activeQuests: [],
  completedQuestIds: [],
  failedQuestIds: [],
  totalQuestsCompleted: 0,
  storyCards: [],
  coins: 0,
};

export function loadQuestState(): QuestState {
  if (typeof window === 'undefined') return { ...DEFAULT_QUEST_STATE };
  try {
    const raw = localStorage.getItem(QUEST_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUEST_STATE };
    return { ...DEFAULT_QUEST_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_QUEST_STATE };
  }
}

export function saveQuestState(state: QuestState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(QUEST_STORAGE_KEY, JSON.stringify(state));
}

export function clearQuestState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(QUEST_STORAGE_KEY);
}

// ---- Accept a Quest ----
export function acceptQuest(state: QuestState, quest: Quest): QuestState {
  const alreadyActive = state.activeQuests.some(q => q.id === quest.id);
  if (alreadyActive) return state;
  const newState = {
    ...state,
    activeQuests: [...state.activeQuests, { ...quest, status: 'ACTIVE' as QuestStatus, acceptedAt: Date.now() }],
  };
  saveQuestState(newState);
  return newState;
}

// ---- Complete an Objective ----
export function completeObjective(
  state: QuestState,
  questId: string,
  objectiveId: string
): { newState: QuestState; questCompleted: boolean; reward?: QuestReward } {
  const questIndex = state.activeQuests.findIndex(q => q.id === questId);
  if (questIndex === -1) return { newState: state, questCompleted: false };

  const quest = { ...state.activeQuests[questIndex] };
  quest.objectives = quest.objectives.map(o =>
    o.id === objectiveId ? { ...o, completed: true } : o
  );

  const allRequiredDone = quest.objectives
    .filter(o => !o.optional)
    .every(o => o.completed);

  const newActiveQuests = [...state.activeQuests];

  if (allRequiredDone) {
    quest.status = 'COMPLETED';
    quest.completedAt = Date.now();
    newActiveQuests.splice(questIndex, 1);

    const newState: QuestState = {
      ...state,
      activeQuests: newActiveQuests,
      completedQuestIds: [...state.completedQuestIds, questId],
      totalQuestsCompleted: state.totalQuestsCompleted + 1,
      coins: state.coins + quest.reward.coins,
    };

    // Add story card if reward includes one
    if (quest.reward.storyCardId) {
      newState.storyCards = [...newState.storyCards, {
        id: quest.reward.storyCardId,
        title: quest.title,
        illustration: '📖',
        rarity: quest.type === 'MAIN' ? 'EPIC' : 'COMMON',
        description: quest.loreText,
        unlockedAt: Date.now(),
      }];
    }

    saveQuestState(newState);
    return { newState, questCompleted: true, reward: quest.reward };
  }

  newActiveQuests[questIndex] = quest;
  const newState = { ...state, activeQuests: newActiveQuests };
  saveQuestState(newState);
  return { newState, questCompleted: false };
}

// ---- Fail a Quest ----
export function failQuest(state: QuestState, questId: string): QuestState {
  const newActiveQuests = state.activeQuests.filter(q => q.id !== questId);
  const newState = {
    ...state,
    activeQuests: newActiveQuests,
    failedQuestIds: [...state.failedQuestIds, questId],
  };
  saveQuestState(newState);
  return newState;
}

// ---- Add Coins ----
export function addCoins(state: QuestState, amount: number): QuestState {
  const newState = { ...state, coins: state.coins + amount };
  saveQuestState(newState);
  return newState;
}

// ---- Build a default Main Quest for a scene ----
export function buildMainQuestForScene(
  sceneId: string,
  sceneTitle: string,
  characterSlug?: string
): Quest {
  return {
    id: `quest-main-${sceneId}`,
    type: 'MAIN',
    title: `Chapter Quest: ${sceneTitle}`,
    description: `Complete the chapter objectives in "${sceneTitle}".`,
    loreText: 'The Story Master has revealed a new quest. Your choices will shape the world.',
    sceneId,
    characterSlug,
    objectives: [
      { id: `obj-explore-${sceneId}`, description: 'Explore the scene', completed: false, optional: false },
      { id: `obj-interact-${sceneId}`, description: 'Interact with a character', completed: false, optional: false },
      { id: `obj-choice-${sceneId}`, description: 'Make a meaningful choice', completed: false, optional: false },
    ],
    reward: {
      xp: 200,
      coins: 50,
      storyCardId: `card-${sceneId}`,
    },
    status: 'AVAILABLE',
    moralWeight: 'neutral',
  };
}

// ---- Quest type labels (user-facing, magical) ----
export const QUEST_TYPE_LABELS: Record<QuestType, { label: string; emoji: string; color: string }> = {
  MAIN: { label: 'Main Quest', emoji: '⭐', color: '#FFD700' },
  SIDE: { label: 'Side Quest', emoji: '🌀', color: '#79B8FF' },
  DIALOGUE: { label: 'Dialogue Quest', emoji: '💬', color: '#5CDB95' },
  MORAL_CHOICE: { label: 'Moral Choice', emoji: '⚖️', color: '#C39BD3' },
  PUZZLE: { label: 'Puzzle Quest', emoji: '🧩', color: '#FF9933' },
  CREATIVE_CHALLENGE: { label: 'Creative Challenge', emoji: '🎨', color: '#FF6B6B' },
  KNOWLEDGE_CHALLENGE: { label: 'Knowledge Challenge', emoji: '📚', color: '#F5A623' },
};
