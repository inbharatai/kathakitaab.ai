// ============================================================
// KathaKitaab.ai — World Master Agent
//
// Controls the entire story world. Every user action passes
// through this agent, which decides:
//   · world rules for the current story
//   · current scene and location state
//   · NPC behavior and reactions
//   · consequences of player choices
//   · chapter progression and quest unlocks
//
// Think: Game Director + Dungeon Master + Story God in one AI.
// ============================================================

export interface WorldLocation {
  id: string;
  name: string;
  emoji: string;
  description: string;
  sceneIds: string[];
  unlocked: boolean;
  questAvailable?: boolean;
}

export interface WorldState {
  // Current position
  currentSceneId: string;
  currentLocationId: string;
  currentChapter: number;
  totalChapters: number;

  // Story flags — persist user choices
  storyFlags: Record<string, boolean | string | number>;

  // NPC states — trust/fear/allegiance
  npcStates: Record<string, NPCState>;

  // Locations discovered
  unlockedLocations: string[];

  // Moral alignment tracker
  alignmentScore: number; // -100 (dark) to +100 (light)

  // Consequence log (last 10 entries)
  consequenceLog: ConsequenceEntry[];

  // World time (story-internal)
  storyTime: 'dawn' | 'day' | 'dusk' | 'night';

  // Active events
  activeEvents: WorldEvent[];
}

export interface NPCState {
  slug: string;
  name: string;
  trustLevel: number;   // 0-100
  fearLevel: number;    // 0-100
  allegiance: 'player' | 'neutral' | 'enemy';
  lastInteractionSummary: string;
  questsOffered: string[];
  questsCompleted: string[];
}

export interface ConsequenceEntry {
  id: string;
  timestamp: number;
  choiceMade: string;
  consequence: string;
  storyFlagsChanged: Record<string, boolean | string | number>;
  npcReactions: Record<string, string>;
  xpAwarded: number;
}

export interface WorldEvent {
  id: string;
  title: string;
  description: string;
  affectedScenes: string[];
  expiresAtChapter?: number;
}

export interface WorldAction {
  type: 'TALK' | 'MOVE' | 'USE_TOOL' | 'MAKE_CHOICE' | 'EXAMINE' | 'FIGHT_CHALLENGE' | 'CREATE';
  targetId?: string;      // NPC slug, location id, tool id
  choiceText?: string;    // What the user chose to say/do
  toolId?: string;
  userInput?: string;
}

export interface WorldActionResult {
  // Narrative output
  sceneTitleUpdate?: string;
  narration: string;
  characterDialogue?: { speaker: string; text: string };

  // Game state changes
  questUpdates: Array<{ questId: string; update: string; completed: boolean }>;
  rewardGiven?: { xp: number; coins: number; item?: string; badge?: string };
  storyFlagsUpdated: Record<string, boolean | string | number>;
  npcReactions: Record<string, string>;
  newLocationsUnlocked: string[];
  newQuestsUnlocked: string[];

  // UI hints
  availableActions: AvailableAction[];
  moodIndicator: 'triumph' | 'tension' | 'calm' | 'danger' | 'wonder' | 'sorrow';

  // Behind-the-scenes consequence
  consequenceEntry?: ConsequenceEntry;

  // Safety
  safetyBlocked?: boolean;
  safeContentWarning?: string;
}

export interface AvailableAction {
  id: string;
  label: string;
  type: WorldAction['type'];
  emoji: string;
  targetId?: string;
  description?: string;
  requiresTool?: string;
  isHighlighted?: boolean;
}

// ---- Default World State ----
export const DEFAULT_WORLD_STATE: WorldState = {
  currentSceneId: '',
  currentLocationId: '',
  currentChapter: 1,
  totalChapters: 12,
  storyFlags: {},
  npcStates: {},
  unlockedLocations: [],
  alignmentScore: 0,
  consequenceLog: [],
  storyTime: 'day',
  activeEvents: [],
};

const WORLD_MASTER_STORAGE_KEY = 'kathakitaab_world_state';

export function loadWorldState(): WorldState {
  if (typeof window === 'undefined') return { ...DEFAULT_WORLD_STATE };
  try {
    const raw = localStorage.getItem(WORLD_MASTER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WORLD_STATE };
    return { ...DEFAULT_WORLD_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_WORLD_STATE };
  }
}

export function saveWorldState(state: WorldState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WORLD_MASTER_STORAGE_KEY, JSON.stringify(state));
}

export function clearWorldState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(WORLD_MASTER_STORAGE_KEY);
}

// ---- Apply Consequence to World State ----
export function applyConsequence(
  worldState: WorldState,
  entry: ConsequenceEntry
): WorldState {
  // Merge story flags
  const newFlags = { ...worldState.storyFlags, ...entry.storyFlagsChanged };

  // Apply NPC reactions to trust/allegiance
  const newNpcStates = { ...worldState.npcStates };
  for (const [slug, reaction] of Object.entries(entry.npcReactions)) {
    if (!newNpcStates[slug]) continue;
    if (reaction.includes('trust+')) {
      newNpcStates[slug] = { ...newNpcStates[slug], trustLevel: Math.min(100, newNpcStates[slug].trustLevel + 10) };
    } else if (reaction.includes('trust-')) {
      newNpcStates[slug] = { ...newNpcStates[slug], trustLevel: Math.max(0, newNpcStates[slug].trustLevel - 15) };
    } else if (reaction.includes('fear+')) {
      newNpcStates[slug] = { ...newNpcStates[slug], fearLevel: Math.min(100, newNpcStates[slug].fearLevel + 10) };
    }
  }

  const newLog = [entry, ...worldState.consequenceLog].slice(0, 10);

  const newState = {
    ...worldState,
    storyFlags: newFlags,
    npcStates: newNpcStates,
    consequenceLog: newLog,
  };

  saveWorldState(newState);
  return newState;
}

// ---- Initialize NPC in World State ----
export function initNPC(worldState: WorldState, slug: string, name: string): WorldState {
  if (worldState.npcStates[slug]) return worldState;
  const newNpcStates = {
    ...worldState.npcStates,
    [slug]: {
      slug,
      name,
      trustLevel: 50,
      fearLevel: 0,
      allegiance: 'neutral' as const,
      lastInteractionSummary: '',
      questsOffered: [],
      questsCompleted: [],
    },
  };
  const newState = { ...worldState, npcStates: newNpcStates };
  saveWorldState(newState);
  return newState;
}

// ---- Update Scene/Location ----
export function updateCurrentScene(
  worldState: WorldState,
  sceneId: string,
  locationId: string,
  chapter: number
): WorldState {
  const newUnlocked = worldState.unlockedLocations.includes(locationId)
    ? worldState.unlockedLocations
    : [...worldState.unlockedLocations, locationId];

  const newState = {
    ...worldState,
    currentSceneId: sceneId,
    currentLocationId: locationId,
    currentChapter: chapter,
    unlockedLocations: newUnlocked,
  };
  saveWorldState(newState);
  return newState;
}

// ---- Get Alignment Label ----
export function getAlignmentLabel(score: number): { label: string; color: string; emoji: string } {
  if (score >= 80) return { label: 'Dharma Champion', color: '#FFD700', emoji: '🌟' };
  if (score >= 50) return { label: 'Righteous', color: '#5CDB95', emoji: '⚖️' };
  if (score >= 20) return { label: 'Seeker', color: '#79B8FF', emoji: '🔍' };
  if (score >= -20) return { label: 'Wanderer', color: '#D1BFAe', emoji: '🌀' };
  if (score >= -50) return { label: 'Shadow Walker', color: '#C39BD3', emoji: '🌑' };
  return { label: 'Dark Path', color: '#FF6B6B', emoji: '💀' };
}

// ---- Build Standard Available Actions for a Scene ----
export function buildDefaultActions(
  worldState: WorldState,
  nearbyCharacterSlugs: string[],
  unlockedTools: string[]
): AvailableAction[] {
  const actions: AvailableAction[] = [];

  // Always available
  actions.push({ id: 'continue', label: 'Continue Story', type: 'MOVE', emoji: '▶️', isHighlighted: true });
  actions.push({ id: 'examine', label: 'Examine Scene', type: 'EXAMINE', emoji: '🔍' });

  // Talk actions per nearby character
  for (const slug of nearbyCharacterSlugs.slice(0, 3)) {
    const npc = worldState.npcStates[slug];
    const name = npc?.name ?? slug;
    actions.push({
      id: `talk-${slug}`,
      label: `Talk to ${name}`,
      type: 'TALK',
      emoji: '💬',
      targetId: slug,
      description: npc ? `Trust: ${npc.trustLevel}%` : undefined,
    });
  }

  // Tool actions for unlocked tools
  for (const toolId of unlockedTools.slice(0, 3)) {
    const toolMeta = TOOL_METADATA[toolId];
    if (toolMeta) {
      actions.push({
        id: `tool-${toolId}`,
        label: toolMeta.gameName,
        type: 'USE_TOOL',
        emoji: toolMeta.emoji,
        targetId: toolId,
        requiresTool: toolId,
      });
    }
  }

  actions.push({ id: 'create', label: 'Create', type: 'CREATE', emoji: '✨' });

  return actions;
}

// ---- Gamified Tool Metadata ----
export const TOOL_METADATA: Record<string, { gameName: string; realFunction: string; emoji: string; description: string }> = {
  'magic-paintbrush': { gameName: 'Magic Paintbrush', realFunction: 'generate-image', emoji: '🎨', description: 'Paint any scene into existence' },
  'wisdom-scroll': { gameName: 'Wisdom Scroll', realFunction: 'summarize', emoji: '📜', description: 'Reveal the essence of this chapter' },
  'language-crystal': { gameName: 'Language Crystal', realFunction: 'translate', emoji: '💎', description: 'Speak in any tongue' },
  'talking-conch': { gameName: 'Talking Conch', realFunction: 'narrate', emoji: '🐚', description: 'Hear the story come alive' },
  'trial-chamber': { gameName: 'Trial Chamber', realFunction: 'quiz', emoji: '⚡', description: 'Test your wisdom' },
  'comic-forge': { gameName: 'Comic Forge', realFunction: 'comic', emoji: '🖼️', description: 'Turn the scene into a comic' },
  'cinema-portal': { gameName: 'Cinema Portal', realFunction: 'video', emoji: '🎬', description: 'Watch the story unfold' },
  'knowledge-oracle': { gameName: 'Knowledge Oracle', realFunction: 'research', emoji: '🔮', description: 'Seek deeper truth' },
  'memory-vault': { gameName: 'Memory Vault', realFunction: 'save', emoji: '🏛️', description: 'Save this moment forever' },
  'messenger-bird': { gameName: 'Messenger Bird', realFunction: 'share', emoji: '🦅', description: 'Share your adventure' },
  'avatar-forge': { gameName: 'Avatar Forge', realFunction: 'character-builder', emoji: '⚒️', description: 'Forge your legend' },
  'world-compass': { gameName: 'World Compass', realFunction: 'map', emoji: '🧭', description: 'Chart unknown territory' },
};

// ---- Default starting tools per character class ----
export const CHARACTER_STARTING_TOOLS: Record<string, string[]> = {
  hero: ['talking-conch', 'world-compass'],
  detective: ['knowledge-oracle', 'world-compass'],
  scientist: ['knowledge-oracle', 'magic-paintbrush'],
  warrior: ['trial-chamber', 'talking-conch'],
  monk: ['wisdom-scroll', 'talking-conch'],
  student: ['wisdom-scroll', 'trial-chamber'],
  explorer: ['world-compass', 'magic-paintbrush'],
  creator: ['magic-paintbrush', 'comic-forge'],
  guide: ['wisdom-scroll', 'messenger-bird'],
};
