// ============================================================
// KathaKitaab — Living World session state
//
// Persisted to localStorage. Tracks where the avatar is, which
// nodes have been visited, which fragment is being carried, which
// missions are done, and a lightweight world-XP counter.
//
// The session is intentionally self-contained and does NOT mutate the
// existing play-mode GameState / WorldState keys — Living World Mode
// is an additive layer and must not perturb Play Mode's progress.
// ============================================================

import type { WorldManifest, WorldPortal } from '@/lib/world/worldManifest';
import { deliverMissionId, isNodeUnlocked } from '@/lib/world/worldManifest';

export interface WorldSessionState {
  version: number;
  bookSlug: string;
  /** Node the avatar is currently standing on. */
  currentNodeId: string;
  /** Avatar position in world coordinates. */
  avatarX: number;
  avatarY: number;
  visitedNodeIds: string[];
  completedMissionIds: string[];
  /** Node whose fragment is currently in the courier's satchel. */
  carriedFragmentNodeId: string | null;
  /** Cumulative world XP. */
  xp: number;
  createdAt: number;
  updatedAt: number;
}

export const WORLD_SESSION_VERSION = 1;
const STORAGE_PREFIX = 'kathakitaab_world_session:';

function storageKey(bookSlug: string): string {
  return `${STORAGE_PREFIX}${bookSlug}`;
}

export function loadWorldSession(bookSlug: string): WorldSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(bookSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorldSessionState;
    if (parsed.version !== WORLD_SESSION_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorldSession(state: WorldSessionState): WorldSessionState {
  const next: WorldSessionState = { ...state, version: WORLD_SESSION_VERSION, updatedAt: Date.now() };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(storageKey(state.bookSlug), JSON.stringify(next));
    } catch {
      // Storage full / blocked — keep the in-memory state going.
    }
  }
  return next;
}

export function clearWorldSession(bookSlug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(bookSlug));
  } catch {
    // ignore
  }
}

/** Build the initial session for a freshly-synthesized world.
 *  The avatar spawns on the first node, which is auto-visited and
 *  whose fragment is auto-collected (the courier starts with the
 *  first story fragment in their satchel). */
export function createInitialSession(manifest: WorldManifest): WorldSessionState {
  const spawn = manifest.nodes[0];
  const base: WorldSessionState = {
    version: WORLD_SESSION_VERSION,
    bookSlug: manifest.bookSlug,
    currentNodeId: spawn?.id ?? '',
    avatarX: spawn?.x ?? manifest.width / 2,
    avatarY: spawn?.y ?? manifest.height / 2,
    visitedNodeIds: spawn ? [spawn.id] : [],
    completedMissionIds: [],
    carriedFragmentNodeId: spawn && spawn.nextNodeId ? spawn.id : null,
    xp: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return base;
}

// ---- Reducer-style transitions (pure, used by the screen) ----------

export type WorldSessionAction =
  | { type: 'VISIT_NODE'; nodeId: string }
  | { type: 'SET_AVATAR'; x: number; y: number }
  | { type: 'DELIVER_FRAGMENT'; fromNodeId: string }
  | { type: 'COMPLETE_MISSION'; missionId: string; rewardXP: number }
  | { type: 'RESET' };

function awardXp(state: WorldSessionState, amount: number): WorldSessionState {
  return { ...state, xp: state.xp + amount };
}

export function reduceWorldSession(
  state: WorldSessionState,
  action: WorldSessionAction,
  manifest: WorldManifest,
): WorldSessionState {
  switch (action.type) {
    case 'VISIT_NODE': {
      const node = manifest.nodes.find(n => n.id === action.nodeId);
      if (!node) return state;
      const visited = state.visitedNodeIds.includes(action.nodeId)
        ? state.visitedNodeIds
        : [...state.visitedNodeIds, action.nodeId];
      // Auto-pickup the fragment when arriving at a node that has one
      // and the courier isn't already carrying a different node's.
      const hasFragment = node.missions.some(m => m.kind === 'deliver_fragment');
      const alreadyDone = state.completedMissionIds.includes(deliverMissionId(node.id));
      const carry =
        hasFragment && !alreadyDone && state.carriedFragmentNodeId == null
          ? node.id
          : state.carriedFragmentNodeId;
      return { ...state, currentNodeId: action.nodeId, visitedNodeIds: visited, carriedFragmentNodeId: carry };
    }
    case 'SET_AVATAR':
      return { ...state, avatarX: action.x, avatarY: action.y };
    case 'DELIVER_FRAGMENT': {
      const missionId = deliverMissionId(action.fromNodeId);
      if (state.completedMissionIds.includes(missionId)) return state;
      if (state.carriedFragmentNodeId !== action.fromNodeId) return state;
      return {
        ...awardXp(state, 40),
        completedMissionIds: [...state.completedMissionIds, missionId],
        carriedFragmentNodeId: null,
      };
    }
    case 'COMPLETE_MISSION': {
      if (state.completedMissionIds.includes(action.missionId)) return state;
      return {
        ...awardXp(state, action.rewardXP),
        completedMissionIds: [...state.completedMissionIds, action.missionId],
      };
    }
    case 'RESET':
      return createInitialSession(manifest);
    default:
      return state;
  }
}

// ---- Selectors ------------------------------------------------------

export function unlockedNodeIds(manifest: WorldManifest, state: WorldSessionState): Set<string> {
  const set = new Set<string>();
  for (const node of manifest.nodes) {
    if (isNodeUnlocked(manifest, state.completedMissionIds, node.id)) set.add(node.id);
  }
  return set;
}

export function isPortalOpenFor(state: WorldSessionState, portal: WorldPortal): boolean {
  return state.completedMissionIds.includes(deliverMissionId(portal.fromNodeId));
}

export function totalMissionCount(manifest: WorldManifest): number {
  return manifest.nodes.reduce((sum, n) => sum + n.missions.length, 0);
}