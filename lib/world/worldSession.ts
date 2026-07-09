// ============================================================
// KathaKitaab — Living World session state (v2)
//
// Persisted to localStorage. Tracks where the avatar is, which
// nodes have been visited, which fragment is being carried, which
// missions are done, and a lightweight world-XP counter.
//
// v2 additions (branching + 3D):
//   · avatarLat/avatarLon — spherical position for the 3D renderer
//     (avatarX/Y kept for the v1 DOM fallback stage)
//   · activePathId — which branch was taken at a branching node
//     (set when the courier steps through a specific portal)
//   · livingMemory — a blob for the Phase-3 living-memory layer
//     (footprints, story-tree growth). Unused for now; persisted so
//     older sessions don't wipe it on upgrade.
//
// The session is intentionally self-contained and does NOT mutate the
// existing play-mode GameState / WorldState keys — Living World Mode
// is an additive layer and must not perturb Play Mode's progress.
//
// v1 fields + actions are preserved verbatim so the e2e spec and any
// existing callers keep working unchanged.
// ============================================================

import type { WorldManifest, WorldPortal } from '@/lib/world/worldManifest';
import { deliverMissionId, isNodeUnlocked } from '@/lib/world/worldManifest';

export interface WorldSessionState {
  version: number;
  bookSlug: string;
  /** Node the avatar is currently standing on. */
  currentNodeId: string;
  /** Avatar position in v1 flat world coordinates. */
  avatarX: number;
  avatarY: number;
  /** v2: avatar position on the sphere (radians). */
  avatarLat?: number;
  avatarLon?: number;
  visitedNodeIds: string[];
  completedMissionIds: string[];
  /** Node whose fragment is currently in the courier's satchel.
   *  The courier carries ONE fragment at a time — branching is
   *  expressed by multiple portals from a node, not multiple fragments. */
  carriedFragmentNodeId: string | null;
  /** v2: the portal/path the courier last stepped through at a branch. */
  activePathId?: string | null;
  /** Cumulative world XP. */
  xp: number;
  /** v2: Phase-3 living-memory blob (footprints, growth). Persisted
   *  ahead of use so a session created now isn't wiped on upgrade. */
  livingMemory?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export const WORLD_SESSION_VERSION = 2;
const STORAGE_PREFIX = 'kathakitaab_world_session:';

function storageKey(bookSlug: string): string {
  return `${STORAGE_PREFIX}${bookSlug}`;
}

/** v1 sessions (version 1) are accepted on load — we migrate them to
 *  v2 by defaulting the new optional fields. A v1 session's
 *  carriedFragmentNodeId / visitedNodeIds / completedMissionIds are
 *  preserved so in-progress journeys survive the upgrade. */
function migrateV1(parsed: WorldSessionState): WorldSessionState {
  return {
    ...parsed,
    version: WORLD_SESSION_VERSION,
    avatarLat: parsed.avatarLat ?? undefined,
    avatarLon: parsed.avatarLon ?? undefined,
    activePathId: parsed.activePathId ?? null,
    livingMemory: parsed.livingMemory ?? undefined,
  };
}

export function loadWorldSession(bookSlug: string): WorldSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(bookSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorldSessionState;
    if (parsed.version === 1) return migrateV1(parsed);
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
  const hasFragment = spawn ? spawn.missions.some(m => m.kind === 'deliver_fragment') : false;
  const base: WorldSessionState = {
    version: WORLD_SESSION_VERSION,
    bookSlug: manifest.bookSlug,
    currentNodeId: spawn?.id ?? '',
    avatarX: spawn?.x ?? manifest.width / 2,
    avatarY: spawn?.y ?? manifest.height / 2,
    avatarLat: spawn?.lat,
    avatarLon: spawn?.lon,
    visitedNodeIds: spawn ? [spawn.id] : [],
    completedMissionIds: [],
    carriedFragmentNodeId: spawn && hasFragment ? spawn.id : null,
    activePathId: null,
    xp: 0,
    livingMemory: undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return base;
}

// ---- Reducer-style transitions (pure, used by the screen) ----------

export type WorldSessionAction =
  | { type: 'VISIT_NODE'; nodeId: string; pathId?: string | null }
  | { type: 'SET_AVATAR'; x: number; y: number; lat?: number; lon?: number }
  | { type: 'DELIVER_FRAGMENT'; fromNodeId: string }
  | { type: 'COMPLETE_MISSION'; missionId: string; rewardXP: number }
  | { type: 'ADVANCE_DIALOG'; npcSlug: string }
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
      return {
        ...state,
        currentNodeId: action.nodeId,
        visitedNodeIds: visited,
        carriedFragmentNodeId: carry,
        activePathId: action.pathId ?? state.activePathId,
      };
    }
    case 'SET_AVATAR':
      return {
        ...state,
        avatarX: action.x,
        avatarY: action.y,
        avatarLat: action.lat ?? state.avatarLat,
        avatarLon: action.lon ?? state.avatarLon,
      };
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
    case 'ADVANCE_DIALOG': {
      // W2 — bump the per-NPC dialogue turn inside the persisted
      // livingMemory blob. Mirrors COMPLETE_MISSION's shape: read the
      // existing map, increment, write back. The turn is cycled mod
      // reply length by replyFor() at render time, not here.
      const mem = { ...(state.livingMemory ?? {}) } as Record<string, unknown>;
      const dialogTurns = (mem.dialogTurns ?? {}) as Record<string, number>;
      const current = dialogTurns[action.npcSlug] ?? 0;
      dialogTurns[action.npcSlug] = current + 1;
      mem.dialogTurns = dialogTurns;
      return {
        ...state,
        livingMemory: mem,
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