import type { AgeBand, PlayableCharacterSnapshot } from '@/lib/game/playSessionState';
import {
  applyChoiceConsequence,
  evaluateConsequence,
  type ChoiceConsequence,
} from '@/lib/game/consequenceEngine';
import {
  completeObjective,
  type QuestState,
} from '@/lib/game/questAgent';
import {
  applyRewardGrant,
  defaultCharacterName,
  determineToolUnlock,
} from '@/lib/game/rewardAgent';
import { evaluateActionSafety } from '@/lib/game/safetyAgent';
import {
  buildDefaultActions,
  TOOL_METADATA,
  type AvailableAction,
  type WorldAction,
  type WorldState,
} from '@/lib/game/worldMasterAgent';
import type { GameState } from '@/lib/game/gameState';

type ChoiceType = 'honest' | 'deceptive' | 'brave' | 'cowardly' | 'kind' | 'selfish' | 'creative' | 'violent' | 'neutral';

export interface PlayActionRequestData {
  bookSlug: string;
  sceneId: string;
  sceneTitle: string;
  sceneNarration: string;
  selectedCharacter: Pick<PlayableCharacterSnapshot, 'id' | 'name' | 'class' | 'traits' | 'specialTool'>;
  action: {
    type: WorldAction['type'];
    label: string;
    userInput?: string;
    targetId?: string;
  };
  ageBand: AgeBand;
  gameState: GameState;
  worldState: WorldState;
  questState: QuestState;
  unlockedTools: string[];
  nearbyCharacterSlugs: string[];
}

export interface PlayActionResult {
  blocked: boolean;
  narration: string;
  statusText: string;
  consequenceText: string;
  updatedGameState: GameState;
  updatedWorldState: WorldState;
  updatedQuestState: QuestState;
  unlockedTools: string[];
  nextActions: AvailableAction[];
  completedObjectiveIds: string[];
  reward: {
    xp: number;
    coins: number;
    toolUnlock?: string;
  };
}

function inferChoiceType(request: PlayActionRequestData): ChoiceType {
  const text = `${request.action.label} ${request.action.userInput ?? ''} ${request.action.targetId ?? ''}`.toLowerCase();

  if (/\b(kill|hurt|attack|destroy|burn|fight)\b/.test(text)) return 'violent';
  if (/\b(lie|deceive|trick|steal|hide the truth)\b/.test(text)) return 'deceptive';
  if (/\b(brave|courage|stand firm|face|challenge)\b/.test(text)) return 'brave';
  if (/\b(kind|help|protect|comfort|guide|care|please|thank)\b/.test(text)) return 'kind';
  if (/\b(create|paint|draw|imagine|invent|compose|build)\b/.test(text)) return 'creative';
  if (/\b(mine|only me|self|take it)\b/.test(text)) return 'selfish';
  if (/\b(truth|honest|openly|clearly)\b/.test(text)) return 'honest';

  switch (request.action.type) {
    case 'CREATE':
      return 'creative';
    case 'TALK':
      return 'kind';
    case 'USE_TOOL':
      return request.action.targetId === 'magic-paintbrush' || request.action.targetId === 'comic-forge'
        ? 'creative'
        : 'honest';
    case 'MOVE':
      return 'brave';
    case 'EXAMINE':
      return 'honest';
    default:
      return 'neutral';
  }
}

function getObjectiveIdsForAction(sceneId: string, actionType: WorldAction['type']): string[] {
  switch (actionType) {
    case 'EXAMINE':
      return [`obj-explore-${sceneId}`];
    case 'TALK':
      return [`obj-interact-${sceneId}`];
    case 'USE_TOOL':
    case 'CREATE':
    case 'MAKE_CHOICE':
      return [`obj-choice-${sceneId}`];
    default:
      return [];
  }
}

function getPendingObjectiveIds(questState: QuestState, objectiveIds: string[]): string[] {
  const pending = new Set<string>();

  for (const quest of questState.activeQuests) {
    for (const objective of quest.objectives) {
      if (objectiveIds.includes(objective.id) && !objective.completed) {
        pending.add(objective.id);
      }
    }
  }

  return Array.from(pending);
}

function buildConsequence(
  request: PlayActionRequestData,
  choiceType: ChoiceType,
  completedObjectiveIds: string[]
): ChoiceConsequence {
  const targetNpcSlug = request.action.type === 'TALK' ? request.action.targetId : undefined;
  const base = evaluateConsequence(
    request.action.userInput?.trim() || request.action.label,
    choiceType,
    targetNpcSlug,
  );

  const progressMultiplier = completedObjectiveIds.length > 0 ? 1 : 0.3;
  const xpAward = Math.max(completedObjectiveIds.length > 0 ? 20 : 5, Math.round(base.xpAward * progressMultiplier));
  const coinsAward = Math.max(0, Math.round(base.coinsAward * progressMultiplier));

  return {
    ...base,
    xpAward,
    coinsAward,
    storyFlags: {
      ...base.storyFlags,
      [`scene_${request.sceneId}_${request.action.type.toLowerCase()}`]: true,
    },
    completeObjectiveIds: completedObjectiveIds,
  };
}

function updateQuestState(
  questState: QuestState,
  objectiveIds: string[]
): { updatedQuestState: QuestState; questRewardXp: number; completedQuestTitles: string[] } {
  const completedQuestTitles: string[] = [];
  let nextQuestState = questState;
  let questRewardXp = 0;

  for (const objectiveId of objectiveIds) {
    const quest = nextQuestState.activeQuests.find(candidate => candidate.objectives.some(objective => objective.id === objectiveId));
    if (!quest) continue;

    const result = completeObjective(nextQuestState, quest.id, objectiveId);
    nextQuestState = result.newState;

    if (result.questCompleted && result.reward) {
      questRewardXp += result.reward.xp;
      completedQuestTitles.push(quest.title);
    }
  }

  return {
    updatedQuestState: nextQuestState,
    questRewardXp,
    completedQuestTitles,
  };
}

function buildStatusText(request: PlayActionRequestData, completedQuestTitles: string[], toolUnlock?: string): string {
  const targetName = request.action.targetId ? defaultCharacterName(request.action.targetId) : null;

  if (completedQuestTitles.length > 0) {
    return `New mission complete: ${completedQuestTitles.join(', ')}.`;
  }

  if (toolUnlock) {
    const tool = TOOL_METADATA[toolUnlock];
    return `${tool?.gameName ?? 'A new tool'} has awakened in your inventory.`;
  }

  if (request.action.type === 'TALK' && targetName) {
    return `${targetName} responds, and the relationship between you shifts.`;
  }

  if (request.action.type === 'EXAMINE') {
    return 'The scene reveals another layer of meaning.';
  }

  if (request.action.type === 'USE_TOOL') {
    return `${request.action.label} bends the scene around your choice.`;
  }

  if (request.action.type === 'CREATE') {
    return 'Imagination leaves a visible mark on the chapter.';
  }

  return 'Your action settles into the world state.';
}

function buildNarration(
  request: PlayActionRequestData,
  statusText: string,
  consequenceText: string,
  choiceType: ChoiceType
): string {
  const targetName = request.action.targetId
    ? defaultCharacterName(request.action.targetId)
    : 'the scene';

  if (request.action.type === 'TALK') {
    const spokenLine = request.action.userInput?.trim() || 'share a careful question';
    return `${request.selectedCharacter.name} steps toward ${targetName} and lets the moment slow. "${spokenLine}" carries across the chapter with ${choiceType === 'kind' || choiceType === 'honest' ? 'warmth' : 'weight'}. ${statusText} ${consequenceText}`;
  }

  if (request.action.type === 'EXAMINE') {
    return `${request.selectedCharacter.name} studies ${request.sceneTitle} with renewed focus. Details that once felt decorative now turn into clues, patterns, and living memory. ${statusText} ${consequenceText}`;
  }

  if (request.action.type === 'USE_TOOL') {
    const tool = TOOL_METADATA[request.action.targetId ?? ''];
    return `${request.selectedCharacter.name} raises ${tool?.gameName ?? request.action.label} and channels its gift into the chapter. The story responds immediately, bending toward the intent behind the action. ${statusText} ${consequenceText}`;
  }

  if (request.action.type === 'CREATE') {
    return `${request.selectedCharacter.name} chooses to create instead of merely react. A fresh possibility opens inside ${request.sceneTitle}, and the world accepts it as part of the journey. ${statusText} ${consequenceText}`;
  }

  return `${request.selectedCharacter.name} acts, and ${request.sceneTitle} changes in response. ${statusText} ${consequenceText}`;
}

export function resolvePlayAction(request: PlayActionRequestData): PlayActionResult {
  const safety = evaluateActionSafety(request.action.label, request.action.userInput, request.ageBand);

  if (safety.blocked) {
    const nextActions = buildDefaultActions(request.worldState, request.nearbyCharacterSlugs, request.unlockedTools);
    return {
      blocked: true,
      narration: safety.message ?? 'The Story Master steers the moment into safer waters.',
      statusText: safety.message ?? 'Choose a gentler action.',
      consequenceText: 'No world-state change was applied.',
      updatedGameState: request.gameState,
      updatedWorldState: request.worldState,
      updatedQuestState: request.questState,
      unlockedTools: request.unlockedTools,
      nextActions,
      completedObjectiveIds: [],
      reward: { xp: 0, coins: 0 },
    };
  }

  const objectiveIds = getObjectiveIdsForAction(request.sceneId, request.action.type);
  const pendingObjectiveIds = getPendingObjectiveIds(request.questState, objectiveIds);
  const choiceType = inferChoiceType(request);
  const consequence = buildConsequence(request, choiceType, pendingObjectiveIds);
  const { updatedWorldState } = applyChoiceConsequence(
    request.worldState,
    request.action.userInput?.trim() || request.action.label,
    consequence
  );

  const { updatedQuestState: progressedQuestState, questRewardXp, completedQuestTitles } = updateQuestState(
    request.questState,
    pendingObjectiveIds
  );

  const reward = applyRewardGrant(request.gameState, progressedQuestState, {
    xp: consequence.xpAward + questRewardXp,
    coins: consequence.coinsAward,
    characterMet: request.action.type === 'TALK' && request.action.targetId
      ? {
          slug: request.action.targetId,
          name: defaultCharacterName(request.action.targetId),
        }
      : undefined,
  });

  const toolUnlock = determineToolUnlock(
    request.sceneId,
    request.action.type,
    request.unlockedTools
  );

  const nextUnlockedTools = toolUnlock
    ? Array.from(new Set([...request.unlockedTools, toolUnlock]))
    : request.unlockedTools;

  const nextActions = buildDefaultActions(updatedWorldState, request.nearbyCharacterSlugs, nextUnlockedTools);
  const statusText = buildStatusText(request, completedQuestTitles, toolUnlock);
  const narration = buildNarration(request, statusText, consequence.consequenceText, choiceType);

  return {
    blocked: false,
    narration,
    statusText,
    consequenceText: consequence.consequenceText,
    updatedGameState: reward.updatedGameState,
    updatedWorldState,
    updatedQuestState: reward.updatedQuestState,
    unlockedTools: nextUnlockedTools,
    nextActions,
    completedObjectiveIds: pendingObjectiveIds,
    reward: {
      xp: consequence.xpAward + questRewardXp,
      coins: consequence.coinsAward,
      toolUnlock,
    },
  };
}