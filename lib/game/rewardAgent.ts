import {
  addXP,
  checkAchievements,
  recordCharacterMet,
  type GameState,
} from '@/lib/game/gameState';
import {
  addCoins,
  type QuestState,
} from '@/lib/game/questAgent';
import type { WorldAction } from '@/lib/game/worldMasterAgent';

export interface RewardGrant {
  xp: number;
  coins: number;
  characterMet?: {
    slug: string;
    name: string;
  };
}

export interface RewardApplicationResult {
  updatedGameState: GameState;
  updatedQuestState: QuestState;
}

function titleizeSlug(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function defaultCharacterName(slug: string): string {
  return titleizeSlug(slug);
}

export function determineToolUnlock(
  sceneId: string,
  actionType: WorldAction['type'],
  unlockedTools: string[]
): string | undefined {
  if (sceneId === 'ayodhya_intro' && !unlockedTools.includes('wisdom-scroll')) {
    return 'wisdom-scroll';
  }

  if (actionType === 'CREATE' && !unlockedTools.includes('comic-forge')) {
    return 'comic-forge';
  }

  return undefined;
}

export function applyRewardGrant(
  gameState: GameState,
  questState: QuestState,
  reward: RewardGrant
): RewardApplicationResult {
  let nextGameState = gameState;
  let nextQuestState = questState;

  if (reward.xp > 0) {
    nextGameState = addXP(nextGameState, reward.xp).newState;
  }

  if (reward.characterMet) {
    nextGameState = recordCharacterMet(
      nextGameState,
      reward.characterMet.slug,
      reward.characterMet.name || defaultCharacterName(reward.characterMet.slug)
    );
  }

  if (reward.coins > 0) {
    nextQuestState = addCoins(nextQuestState, reward.coins);
  }

  nextGameState = checkAchievements(nextGameState).newState;

  return {
    updatedGameState: nextGameState,
    updatedQuestState: nextQuestState,
  };
}