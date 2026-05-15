// ============================================================
// KathaKitaab — Consequence Engine
//
// The user's choice MUST matter. This engine:
//   · Maps player choices → concrete world state changes
//   · Updates NPC trust/fear/allegiance
//   · Triggers alternate story branches
//   · Shifts moral alignment score
//   · Generates cinematic consequence text
//
// Example:
//   User lies to the village elder →
//     trust score -15, mentor refuses help,
//     villain gains advantage, alternate chapter opens.
// ============================================================

import { ConsequenceEntry, WorldState, NPCState } from './worldMasterAgent';

export interface ChoiceConsequence {
  // Immediate effects
  alignmentDelta: number;       // +/- affects hero alignment
  xpAward: number;
  coinsAward: number;

  // NPC reactions (slug → effect string)
  npcReactions: Record<string, 'trust+' | 'trust-' | 'fear+' | 'fear-' | 'ally' | 'enemy' | 'neutral'>;

  // Story flags to set
  storyFlags: Record<string, boolean | string | number>;

  // Unlock or lock chapters
  unlockSceneIds: string[];
  lockSceneIds: string[];

  // Narrative feedback (what the player sees)
  narrativeEffect: string;     // "The elder's eyes narrow with suspicion..."
  consequenceText: string;     // "Your deception has consequences."

  // Quest effects
  completeObjectiveIds: string[];
  failQuestIds: string[];
  unlockQuestIds: string[];
}

// ---- Evaluate the consequence of a moral choice ----
export function evaluateConsequence(
  choice: string,
  choiceType: 'honest' | 'deceptive' | 'brave' | 'cowardly' | 'kind' | 'selfish' | 'creative' | 'violent' | 'neutral',
  targetNpcSlug?: string,
): ChoiceConsequence {
  const base = CHOICE_TYPE_BASES[choiceType] ?? CHOICE_TYPE_BASES.neutral;

  const npcReactions: ChoiceConsequence['npcReactions'] = {};
  if (targetNpcSlug) {
    npcReactions[targetNpcSlug] = base.defaultNpcReaction;
  }

  return {
    alignmentDelta: base.alignmentDelta,
    xpAward: base.xpAward,
    coinsAward: base.coinsAward,
    npcReactions,
    storyFlags: targetNpcSlug
      ? { [`${targetNpcSlug}_${choiceType}_interaction`]: true }
      : {},
    unlockSceneIds: [],
    lockSceneIds: [],
    narrativeEffect: base.narrativeEffect,
    consequenceText: base.consequenceText,
    completeObjectiveIds: [],
    failQuestIds: [],
    unlockQuestIds: [],
  };
}

const CHOICE_TYPE_BASES: Record<string, {
  alignmentDelta: number;
  xpAward: number;
  coinsAward: number;
  defaultNpcReaction: ChoiceConsequence['npcReactions'][string];
  narrativeEffect: string;
  consequenceText: string;
}> = {
  honest: {
    alignmentDelta: 10,
    xpAward: 75,
    coinsAward: 20,
    defaultNpcReaction: 'trust+',
    narrativeEffect: 'A warm light seems to surround you as truth speaks for itself.',
    consequenceText: 'Your honesty strengthens the bonds of trust.',
  },
  deceptive: {
    alignmentDelta: -15,
    xpAward: 30,
    coinsAward: 10,
    defaultNpcReaction: 'trust-',
    narrativeEffect: 'A shadow passes over the scene. Something has shifted.',
    consequenceText: 'Your deception may help now, but the world remembers.',
  },
  brave: {
    alignmentDelta: 15,
    xpAward: 100,
    coinsAward: 30,
    defaultNpcReaction: 'trust+',
    narrativeEffect: 'The air crackles with courage. Others take notice.',
    consequenceText: 'Bravery opens doors that fear keeps shut.',
  },
  cowardly: {
    alignmentDelta: -5,
    xpAward: 20,
    coinsAward: 5,
    defaultNpcReaction: 'neutral',
    narrativeEffect: 'The moment passes. You wonder what might have been.',
    consequenceText: 'Sometimes stepping back reveals a different path.',
  },
  kind: {
    alignmentDelta: 12,
    xpAward: 80,
    coinsAward: 15,
    defaultNpcReaction: 'trust+',
    narrativeEffect: 'Kindness ripples outward like water from a stone.',
    consequenceText: 'The world becomes slightly warmer.',
  },
  selfish: {
    alignmentDelta: -10,
    xpAward: 25,
    coinsAward: 25,
    defaultNpcReaction: 'trust-',
    narrativeEffect: 'You gain something, but something else is lost.',
    consequenceText: 'Self-interest has a price paid later.',
  },
  creative: {
    alignmentDelta: 8,
    xpAward: 90,
    coinsAward: 20,
    defaultNpcReaction: 'trust+',
    narrativeEffect: 'An unexpected solution emerges, surprising everyone.',
    consequenceText: 'Creativity is its own kind of power.',
  },
  violent: {
    alignmentDelta: -20,
    xpAward: 15,
    coinsAward: 0,
    defaultNpcReaction: 'fear+',
    narrativeEffect: 'A heavy silence follows. The world feels colder.',
    consequenceText: 'Force resolves the moment but wounds the world.',
  },
  neutral: {
    alignmentDelta: 0,
    xpAward: 40,
    coinsAward: 10,
    defaultNpcReaction: 'neutral',
    narrativeEffect: 'The story continues.',
    consequenceText: 'Your action is recorded in the world.',
  },
};

// ---- Apply a consequence to world state ----
export function applyChoiceConsequence(
  worldState: WorldState,
  choiceMade: string,
  consequence: ChoiceConsequence,
): { updatedWorldState: WorldState; entry: ConsequenceEntry } {
  const entry: ConsequenceEntry = {
    id: `consequence-${Date.now()}`,
    timestamp: Date.now(),
    choiceMade,
    consequence: consequence.consequenceText,
    storyFlagsChanged: consequence.storyFlags,
    npcReactions: Object.fromEntries(
      Object.entries(consequence.npcReactions).map(([slug, reaction]) => [slug, reaction])
    ),
    xpAwarded: consequence.xpAward,
  };

  // Update story flags
  const newFlags = { ...worldState.storyFlags, ...consequence.storyFlags };

  // Update alignment
  const newAlignment = Math.max(-100, Math.min(100, worldState.alignmentScore + consequence.alignmentDelta));

  // Update NPC states
  const newNpcStates = { ...worldState.npcStates };
  for (const [slug, reaction] of Object.entries(consequence.npcReactions)) {
    const current: NPCState = newNpcStates[slug] ?? {
      slug, name: slug, trustLevel: 50, fearLevel: 0,
      allegiance: 'neutral', lastInteractionSummary: '',
      questsOffered: [], questsCompleted: [],
    };

    let { trustLevel, fearLevel, allegiance } = current;
    if (reaction === 'trust+') trustLevel = Math.min(100, trustLevel + 10);
    if (reaction === 'trust-') trustLevel = Math.max(0, trustLevel - 15);
    if (reaction === 'fear+') fearLevel = Math.min(100, fearLevel + 10);
    if (reaction === 'fear-') fearLevel = Math.max(0, fearLevel - 10);
    if (reaction === 'ally') allegiance = 'player';
    if (reaction === 'enemy') allegiance = 'enemy';
    if (reaction === 'neutral') allegiance = 'neutral';

    newNpcStates[slug] = {
      ...current,
      trustLevel,
      fearLevel,
      allegiance,
      lastInteractionSummary: choiceMade.slice(0, 100),
    };
  }

  const newLog = [entry, ...worldState.consequenceLog].slice(0, 10);

  const updatedWorldState: WorldState = {
    ...worldState,
    storyFlags: newFlags,
    alignmentScore: newAlignment,
    npcStates: newNpcStates,
    consequenceLog: newLog,
  };

  return { updatedWorldState, entry };
}

// ---- Get dramatic consequence summary for UI ----
export function getConsequenceSummary(log: ConsequenceEntry[]): string {
  if (log.length === 0) return 'Your story is just beginning.';
  const last = log[0];
  return last.consequence;
}

// ---- Detect if a story flag triggers a branch unlock ----
export function checkBranchUnlocks(
  worldState: WorldState,
  branches: Array<{ id: string; condition: Record<string, boolean | string | number> }>
): string[] {
  return branches
    .filter(branch =>
      Object.entries(branch.condition).every(([key, val]) => worldState.storyFlags[key] === val)
    )
    .map(b => b.id);
}
