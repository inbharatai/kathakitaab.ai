// ============================================================
// KathaKitaab — Universal WorldManifest Engine
//
// A *spatial* companion to the linear reader. Turns any Book
// (its scenes + characters) into a tiny, walkable "living world"
// inspired — in emotional principle only — by Messenger (abeto.co):
//   · a small explorable planet you can cross in one sitting
//   · soft camera that follows the avatar
//   · readable destinations (one per scene)
//   · a simple courier loop: carry a story fragment to the next
//     portal, deliver it, watch the next scene unfold
//   · lightweight NPC life (idle characters with a phrase)
//   · cozy, low-noise, browser + mobile friendly
//
// This file is deliberately engine-free and AI-free:
//   · pure function of (book, scenes, characters) — deterministic
//   · runs client-side, SSR-safe (no window access)
//   · works offline against the curated seed (Ramayana)
//
// We do NOT copy Messenger's art, characters, name, delivery story,
// or exact gameplay. Only the emotional principle is adapted.
// ============================================================

import type { Book, Character, Scene } from '@/lib/types/livebook';

// ---- World geometry --------------------------------------------------

export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 620;
const PAD_X = 96;
const PAD_Y = 78;
const GOLDEN_ANGLE = 2.39996; // radians — spreads nodes evenly

// ---- Types -----------------------------------------------------------

export type MissionKind =
  | 'deliver_fragment'
  | 'ask_character'
  | 'collect_clue'
  | 'answer_question';

export interface WorldMission {
  id: string;
  kind: MissionKind;
  nodeId: string;
  title: string;
  description: string;
  rewardXP: number;
  /** Narration snippet carried to the portal (deliver_fragment). */
  fragmentText?: string;
  /** NPC slug this mission is about (ask_character). */
  characterSlug?: string;
  /** The clue / learning point text (collect_clue). */
  clueText?: string;
  /** Quiz payload (answer_question). Only the first quiz question is
   *  surfaced — the world is light, not a test. */
  quiz?: {
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  };
}

export interface WorldNode {
  id: string;
  title: string;
  emoji: string;
  x: number;
  y: number;
  sceneIndex: number;
  bgImageUrl: string;
  mood: string;
  npcSlugs: string[];
  missions: WorldMission[];
  nextNodeId?: string;
}

export interface WorldNpc {
  slug: string;
  name: string;
  role: string;
  emoji: string;
  nodeId: string;
  dx: number;
  dy: number;
  idlePhrase: string;
}

export interface WorldPortal {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  x: number;
  y: number;
}

export interface WorldPalette {
  sky: string;
  ground: string;
  accent: string;
}

export interface WorldManifest {
  worldId: string;
  bookSlug: string;
  bookTitle: string;
  subtitle: string;
  width: number;
  height: number;
  spawnNodeId: string;
  nodes: WorldNode[];
  npcs: WorldNpc[];
  portals: WorldPortal[];
  palette: WorldPalette;
  createdAt: number;
}

// ---- Helpers ---------------------------------------------------------

/** Deterministic 32-bit string hash. Stable across runs/browsers. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function trimText(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${slice.slice(0, lastSpace > 40 ? lastSpace : max).trim()}…`;
}

const MOOD_EMOJI: Record<string, string> = {
  serene: '🌿',
  dramatic: '⚔️',
  joyful: '🎉',
  mysterious: '🌫️',
  sacred: '🪔',
  somber: '🕯️',
  tense: '🔥',
};

const NPC_EMOJI_PALETTE = [
  '🧙', '🧝', '🧑‍🌾', '🧞', '🧚', '🦚', '🐒', '🏹',
  '👑', '🌸', '🦅', '🐍', '🐂', '🪷', '🛡️', '🐘',
];

const CLUE_EMOJI = ['🔎', '🗝️', '✨', '📜', '💎'];

// ---- Layout ----------------------------------------------------------

/**
 * Distribute scene nodes on a gentle golden-angle spiral centred on
 * the planet. Scene 0 lands near the middle (the spawn), later
 * scenes spiral outward — so the journey always reads as "outward
 * from where you began", and adjacent scenes sit close together.
 */
function placeNode(sceneIndex: number, total: number): { x: number; y: number } {
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;
  const maxR = Math.min(WORLD_WIDTH / 2 - PAD_X, WORLD_HEIGHT / 2 - PAD_Y);
  // sceneIndex/total puts scene 0 at the centre (t=0 → radius 0) and
  // spirals outward, so the spawn is always in the middle and the
  // journey reads as "outward from where you began".
  const t = total <= 1 ? 0 : sceneIndex / total;
  // Square-root curve: early nodes near the centre, later near the rim.
  const radius = maxR * Math.sqrt(t);
  const angle = sceneIndex * GOLDEN_ANGLE - Math.PI / 2;
  const x = clamp(cx + radius * Math.cos(angle), PAD_X, WORLD_WIDTH - PAD_X);
  const y = clamp(cy + radius * Math.sin(angle), PAD_Y, WORLD_HEIGHT - PAD_Y);
  return { x, y };
}

// ---- Mission synthesis ----------------------------------------------

function buildMissions(scene: Scene, nodeId: string, nextTargetExists: boolean): WorldMission[] {
  const missions: WorldMission[] = [];

  // Primary courier mission: carry this scene's narration to the
  // next portal. Only when a next scene exists AND is present in the
  // book — otherwise the fragment would be undeliverable (no portal)
  // and the world would soft-lock with a fragment you can never give.
  if (scene.next_scene_id && nextTargetExists) {
    missions.push({
      id: `mf-${nodeId}`,
      kind: 'deliver_fragment',
      nodeId,
      title: 'Carry the story fragment',
      description: 'Walk the fragment to the glowing portal to unlock the next scene.',
      rewardXP: 40,
      fragmentText: trimText(scene.narration || scene.short_summary || scene.title, 240),
    });
  }

  return missions;
}

function buildSideMissions(
  scene: Scene,
  nodeId: string,
  npcSlugs: string[],
  characterById: Map<string, Character>,
): WorldMission[] {
  const missions: WorldMission[] = [];

  for (const slug of npcSlugs) {
    missions.push({
      id: `ma-${nodeId}-${slug}`,
      kind: 'ask_character',
      nodeId,
      title: `Ask ${characterById.get(slug)?.name ?? slug}`,
      description: 'Speak with this character and hear their side of the story.',
      rewardXP: 15,
      characterSlug: slug,
    });
  }

  const clues = Array.isArray(scene.learning_points) ? scene.learning_points : [];
  clues.forEach((clue, index) => {
    if (!clue || !clue.trim()) return;
    missions.push({
      id: `mc-${nodeId}-${index}`,
      kind: 'collect_clue',
      nodeId,
      title: `Collect a clue`,
      description: trimText(clue, 120),
      rewardXP: 10,
      clueText: clue,
    });
  });

  const quiz = Array.isArray(scene.quiz_questions) ? scene.quiz_questions[0] : undefined;
  if (quiz && Array.isArray(quiz.options) && quiz.options.length >= 2) {
    missions.push({
      id: `mq-${nodeId}`,
      kind: 'answer_question',
      nodeId,
      title: 'Answer a reflection',
      description: quiz.question,
      rewardXP: 30,
      quiz: {
        question: quiz.question,
        options: quiz.options,
        correctAnswer: quiz.correct_answer,
        explanation: quiz.explanation,
      },
    });
  }

  return missions;
}

// ---- NPC placement ---------------------------------------------------

function pickEmoji(seed: string, palette: string[]): string {
  return palette[hashString(seed) % palette.length];
}

function idlePhraseFor(character: Character): string {
  const example = Array.isArray(character.talk_examples) ? character.talk_examples[0] : undefined;
  if (example && example.trim()) return trimText(example, 140);
  if (character.short_summary && character.short_summary.trim()) return trimText(character.short_summary, 140);
  return character.role || 'A quiet presence in this corner of the world.';
}

/**
 * Assign each character to a node. Prefer a scene that explicitly
 * lists the character in `characters_present`; otherwise balance the
 * remaining characters round-robin across the least-populated nodes.
 * Deterministic regardless of input.
 */
function assignNpcsToNodes(
  scenes: Scene[],
  characters: Character[],
): Map<string, string[]> {
  const nodeSlugs = new Map<string, string[]>();
  for (const scene of scenes) nodeSlugs.set(scene.scene_id, []);

  const placed = new Set<string>();
  // 1. Honour explicit presence lists when the engine emits them.
  for (const scene of scenes) {
    const present = Array.isArray(scene.characters_present) ? scene.characters_present : [];
    for (const slug of present) {
      if (!slug || placed.has(slug)) continue;
      const char = characters.find(c => c.slug === slug);
      if (!char) continue;
      nodeSlugs.get(scene.scene_id)!.push(slug);
      placed.add(slug);
    }
  }

  // 2. Round-robin the rest onto the least-populated nodes.
  const remaining = characters.filter(c => !placed.has(c.slug));
  // Stable order so assignment is deterministic.
  remaining.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const char of remaining) {
    let targetId = scenes[0]?.scene_id;
    let fewest = Number.POSITIVE_INFINITY;
    for (const scene of scenes) {
      const count = nodeSlugs.get(scene.scene_id)!.length;
      if (count < fewest) {
        fewest = count;
        targetId = scene.scene_id;
      }
    }
    if (targetId) nodeSlugs.get(targetId)!.push(char.slug);
  }

  return nodeSlugs;
}

function placeNpcNear(node: { x: number; y: number }, slug: string, index: number): { dx: number; dy: number } {
  // Ring the node. Offset radius keeps NPCs clear of the node marker.
  const radius = 42;
  const angle = hashString(slug) * 0.0001 + index * (Math.PI / 3);
  return {
    dx: Math.cos(angle) * radius,
    dy: Math.sin(angle) * radius + 14, // bias downward so labels don't collide
  };
}

// ---- Palette ---------------------------------------------------------

function paletteFor(book: Book): WorldPalette {
  // A small set of cozy palettes keyed deterministically by book slug
  // so each world feels distinct but always warm + low-noise.
  const palettes: WorldPalette[] = [
    { sky: 'radial-gradient(circle at 50% 18%, #4A0404 0%, #1C120E 45%, #0C0806 85%)', ground: '#160F0B', accent: '#FF9933' },
    { sky: 'radial-gradient(circle at 50% 18%, #14233f 0%, #0d1626 45%, #070b12 85%)', ground: '#0c1322', accent: '#7FB2FF' },
    { sky: 'radial-gradient(circle at 50% 18%, #2d1b3a 0%, #1a1023 45%, #0c0813 85%)', ground: '#160f1c', accent: '#C39BD3' },
    { sky: 'radial-gradient(circle at 50% 18%, #14342a 0%, #0c1f17 45%, #06120d 85%)', ground: '#0c1a13', accent: '#5CDB95' },
  ];
  return palettes[hashString(book.slug) % palettes.length];
}

// ---- Synthesizer -----------------------------------------------------

export function synthesizeWorldManifest(
  book: Book,
  scenes: Scene[],
  characters: Character[],
): WorldManifest {
  const ordered = [...scenes].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const characterById = new Map(characters.map(c => [c.slug, c]));
  const npcAssignment = assignNpcsToNodes(ordered, characters);
  // Scene ids that actually exist in this book — used to guard against
  // a next_scene_id pointing at a scene that isn't in the payload (which
  // would otherwise create an undeliverable fragment and soft-lock).
  const validSceneIds = new Set(ordered.map(s => s.scene_id));

  const nodes: WorldNode[] = ordered.map((scene, index) => {
    const { x, y } = placeNode(index, ordered.length);
    const npcSlugs = npcAssignment.get(scene.scene_id) ?? [];
    const nextTargetExists = scene.next_scene_id ? validSceneIds.has(scene.next_scene_id) : false;
    const primary = buildMissions(scene, scene.scene_id, nextTargetExists);
    const side = buildSideMissions(scene, scene.scene_id, npcSlugs, characterById);
    const mood = sceneMood(scene);
    return {
      id: scene.scene_id,
      title: scene.title,
      emoji: MOOD_EMOJI[mood] ?? '🌳',
      x,
      y,
      sceneIndex: index,
      bgImageUrl: scene.background_asset_url || '',
      mood,
      npcSlugs,
      missions: [...primary, ...side],
      nextNodeId: scene.next_scene_id ?? undefined,
    };
  });

  const portals: WorldPortal[] = [];
  for (const node of nodes) {
    if (!node.nextNodeId) continue;
    const target = nodes.find(n => n.id === node.nextNodeId);
    if (!target) continue;
    // Portal sits 45% of the way from the current node to the next,
    // so it reads as "just outside this scene".
    const px = node.x + (target.x - node.x) * 0.45;
    const py = node.y + (target.y - node.y) * 0.45;
    portals.push({
      id: `portal-${node.id}`,
      fromNodeId: node.id,
      toNodeId: node.id === target.id ? '' : target.id,
      x: px,
      y: py,
    });
  }

  const npcs: WorldNpc[] = [];
  for (const node of nodes) {
    for (const slug of node.npcSlugs) {
      const char = characterById.get(slug);
      if (!char) continue;
      const { dx, dy } = placeNpcNear(node, slug, npcs.length);
      npcs.push({
        slug: char.slug,
        name: char.name,
        role: char.role,
        emoji: pickEmoji(char.slug, NPC_EMOJI_PALETTE),
        nodeId: node.id,
        dx,
        dy,
        idlePhrase: idlePhraseFor(char),
      });
    }
  }

  const spawnNodeId = nodes[0]?.id ?? '';

  return {
    worldId: `world-${book.slug}`,
    bookSlug: book.slug,
    bookTitle: book.title,
    subtitle: book.subtitle || book.description || '',
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawnNodeId,
    nodes,
    npcs,
    portals,
    palette: paletteFor(book),
    createdAt: 0, // stamped by the caller (Date is fine client-side)
  };
}

/** Infer a cozy mood from scene content so each destination reads
 *  distinctly (battle → 🔥, forest → 🌿, wedding → 🎉, exile → 🕯️…).
 *  The reader payload carries no explicit `mood` field (only the
 *  movie manifest does), so we derive one deterministically from the
 *  title + visual description + summary. Falls back to 'serene'. */
const MOOD_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ['battle', 'tense'], ['war', 'tense'], ['fight', 'tense'], ['combat', 'tense'],
  ['sword', 'tense'], ['demon', 'tense'], ['ravana', 'tense'], ['attack', 'tense'],
  ['forest', 'serene'], ['hermitage', 'serene'], ['river', 'serene'], ['calm', 'serene'],
  ['peace', 'serene'], ['simple living', 'serene'], ['nature', 'serene'],
  ['wedding', 'joyful'], ['joy', 'joyful'], ['celebration', 'joyful'], ['festival', 'joyful'],
  ['return', 'joyful'], ['homecoming', 'joyful'], ['reunion', 'joyful'],
  ['exile', 'somber'], ['sorrow', 'somber'], ['grief', 'somber'], ['death', 'somber'],
  ['loss', 'somber'], ['departure', 'somber'], ['sacrifice', 'somber'],
  ['temple', 'sacred'], ['prayer', 'sacred'], ['divine', 'sacred'], ['blessing', 'sacred'],
  ['dharma', 'sacred'], ['lamp', 'sacred'], ['ritual', 'sacred'],
  ['mystery', 'mysterious'], ['riddle', 'mysterious'], ['magic', 'mysterious'],
  ['dream', 'mysterious'], ['disguise', 'mysterious'], ['secret', 'mysterious'],
  ['confront', 'dramatic'], ['betrayal', 'dramatic'], ['kidnap', 'dramatic'],
  ['abduction', 'dramatic'], ['oath', 'dramatic'], ['boon', 'dramatic'],
];

function sceneMood(scene: Scene): string {
  if (scene.mode === 'quiz') return 'mysterious';
  const hay = `${scene.title} ${scene.visual_description || ''} ${scene.short_summary || ''}`.toLowerCase();
  for (const [keyword, mood] of MOOD_KEYWORDS) {
    if (hay.includes(keyword)) return mood;
  }
  return 'serene';
}

// ---- Selectors (used by UI + tests) ----------------------------------

/** Mission id for the "carry the fragment" job at a node, if any. */
export function deliverMissionId(nodeId: string): string {
  return `mf-${nodeId}`;
}

/** Is a node unlocked given the current session progress? */
export function isNodeUnlocked(manifest: WorldManifest, completedMissionIds: string[], nodeId: string): boolean {
  const node = manifest.nodes.find(n => n.id === nodeId);
  if (!node) return false;
  if (node.sceneIndex === 0) return true; // spawn
  // A node unlocks when the previous node's fragment has been delivered.
  const previous = manifest.nodes.find(n => n.nextNodeId === nodeId);
  if (!previous) return false;
  return completedMissionIds.includes(deliverMissionId(previous.id));
}

export function clueEmoji(seed: string): string {
  return CLUE_EMOJI[hashString(seed) % CLUE_EMOJI.length];
}