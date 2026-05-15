// ============================================================
// KathaKitaab — Scene Graph
//
// Tracks the story as a graph, not a linear list.
// Each scene can have branches (character clicks, object clicks,
// discoveries). Branches are cached and navigable.
// ============================================================

export interface SceneBranch {
  id: string;
  parentSceneId: string;
  entityId: string;
  entityType: 'character' | 'object' | 'location' | 'background';
  entityLabel: string;
  /**
   * The verb the user selected (talk / fight / observe / inspect / …).
   * Different actions on the same entity produce different branches —
   * the graph indexes them as `entityId + actionType` so a Talk branch
   * doesn't shadow a later Fight branch.
   * Optional for back-compat with branches saved before this field
   * existed; treated as 'auto' when missing.
   */
  actionType?: string;
  title: string;
  narration: string;
  imageUrl: string | null;
  imagePrompt: string;
  nextActions: string[];
  createdAt: number;
  visited: boolean;
}

const normalizeAction = (a?: string): string => (a || 'auto').toLowerCase();

export interface SceneNode {
  sceneId: string;
  title: string;
  visited: boolean;
  branches: SceneBranch[];
  discoveredEntities: string[];
}

// ── In-memory graph ──────────────────────────────────────────

const graph = new Map<string, SceneNode>();

export function getOrCreateNode(sceneId: string, title: string): SceneNode {
  let node = graph.get(sceneId);
  if (!node) {
    node = { sceneId, title, visited: false, branches: [], discoveredEntities: [] };
    graph.set(sceneId, node);
  }
  return node;
}

export function markVisited(sceneId: string) {
  const node = graph.get(sceneId);
  if (node) node.visited = true;
}

export function addBranch(sceneId: string, branch: SceneBranch): void {
  const node = graph.get(sceneId);
  if (!node) return;
  // Dedup by entity + entityType + action — different verbs on the
  // same entity (Talk vs Fight) are intentionally distinct branches.
  const action = normalizeAction(branch.actionType);
  const existing = node.branches.find(b =>
    b.entityId === branch.entityId
    && b.entityType === branch.entityType
    && normalizeAction(b.actionType) === action,
  );
  if (existing) return;
  node.branches.push(branch);
}

export function getBranch(sceneId: string, entityId: string, actionType?: string): SceneBranch | null {
  const node = graph.get(sceneId);
  if (!node) return null;
  // If actionType is supplied, look up the matching variant first;
  // fall back to any branch on the entity for legacy callers.
  if (actionType) {
    const action = normalizeAction(actionType);
    const exact = node.branches.find(b =>
      b.entityId === entityId && normalizeAction(b.actionType) === action,
    );
    if (exact) return exact;
  }
  return node.branches.find(b => b.entityId === entityId) ?? null;
}

export function markEntityDiscovered(sceneId: string, entityId: string) {
  const node = graph.get(sceneId);
  if (!node) return;
  if (!node.discoveredEntities.includes(entityId)) {
    node.discoveredEntities.push(entityId);
  }
}

export function getDiscoveryCount(sceneId: string): { discovered: number; total: number } {
  const node = graph.get(sceneId);
  if (!node) return { discovered: 0, total: 0 };
  return { discovered: node.discoveredEntities.length, total: node.branches.length };
}

// ── Persistence ──────────────────────────────────────────────
// Branches can carry base64 data URIs (gpt-image-1 returns ~200KB–2MB
// per image). Multiplied across scenes × branches, that blows past
// the 5–10MB localStorage cap. Strip data URIs on write — the
// server-side response cache still has them, so a missing imageUrl
// just triggers a regen on revisit.

const GRAPH_KEY = 'kathakitaab_scene_graph';
const MAX_BRANCHES_PER_NODE = 12;

function sanitizeForStorage(): Record<string, SceneNode> {
  const out: Record<string, SceneNode> = {};
  for (const [key, node] of graph) {
    const branches = node.branches
      .slice(-MAX_BRANCHES_PER_NODE)
      .map<SceneBranch>(b => ({
        ...b,
        imageUrl: b.imageUrl?.startsWith('data:') ? null : b.imageUrl,
      }));
    out[key] = { ...node, branches };
  }
  return out;
}

export function saveGraph(bookSlug: string) {
  if (typeof window === 'undefined') return;
  const key = `${GRAPH_KEY}_${bookSlug}`;
  const payload = JSON.stringify(sanitizeForStorage());
  try {
    localStorage.setItem(key, payload);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      // Drop this book's old graph and retry once with the sanitized payload.
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      try { localStorage.setItem(key, payload); }
      catch { console.warn('[sceneGraph] localStorage full — skipping persist'); }
    } else {
      console.warn('[sceneGraph] save failed:', err);
    }
  }
}

export function loadGraph(bookSlug: string) {
  if (typeof window === 'undefined') return;
  const raw = localStorage.getItem(`${GRAPH_KEY}_${bookSlug}`);
  if (!raw) return;
  try {
    const data = JSON.parse(raw) as Record<string, SceneNode>;
    for (const [key, node] of Object.entries(data)) {
      graph.set(key, node);
    }
  } catch { /* corrupt data, start fresh */ }
}
