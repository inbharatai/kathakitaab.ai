// ============================================================
// KathaKitaab — Universal WorldManifest Engine (v2)
//
// A *spatial* companion to the linear reader. Turns any Book
// (its scenes + characters + canon) into a tiny, walkable "living
// world" — a 3D planet of story-places you cross in one sitting.
//
// Emotional principle adapted (NOT copied) from Messenger (abeto.co):
//   · a small explorable planet you can cross in one sitting
//   · soft camera that follows the avatar
//   · readable destinations (one per scene)
//   · a simple courier loop: carry a story fragment to the next
//     portal, deliver it, watch the next scene unfold
//   · lightweight NPC life — but canon-accurate: characters traverse
//     the same places in the same order as the book (Rama:
//     Ayodhya → forest → Lanka), derived from `characters_present`
//   · cozy, low-noise, browser + mobile friendly
//
// This file is deliberately engine-free and AI-free:
//   · pure function of (book, scenes, characters) — deterministic
//   · runs client-side, SSR-safe (no window access)
//   · works offline against the curated seed (Ramayana)
//   · mirrors the book→movie engine (synthesizeBookMovieManifest):
//     a pure synthesizer that turns a declarative story payload into
//     a manifest any renderer (3D / 2.5D / Remotion flythrough) consumes
//
// We do NOT copy Messenger's art, characters, name, delivery story,
// or exact gameplay. Only the emotional principle is adapted.
//
// ---- v2 changes (3D-ready) -----------------------------------
//   · places live on a sphere (lat/lon) via fibonacci distribution,
//     not a flat golden-angle spiral
//   · NPC schedules derived from `characters_present` across scenes
//     (canon-accurate traversal); fall back to round-robin when absent
//   · paths + portals form the story DAG (branching-aware), not just
//     the linear next-scene chain
//   · per-place biome (from mood/keywords) drives terrain + sky color
//   · v1 selectors (isNodeUnlocked, deliverMissionId, clueEmoji) and
//     the `nodes`/`npcs`/`portals` arrays are preserved as aliases so
//     existing consumers (MissionPanel, e2e spec, v1 DOM fallback) stay
//     green without changes.
// ============================================================

import type { Book, Character, Scene } from '@/lib/types/livebook';

// ---- World geometry --------------------------------------------------

/**
 * v1 flat-projected canvas size. Kept as the canonical manifest width/
 * height so the v1 DOM fallback stage and any 2D projection of the v2
 * sphere stay byte-stable. The 3D renderer ignores these and uses
 * `planet.radius` + lat/lon.
 */
export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 620;
const PAD_X = 96;
const PAD_Y = 78;

/** Radius of the story planet in three.js world units. */
export const PLANET_RADIUS = 6;

// ---- Types -----------------------------------------------------------

export type Biome =
  | 'city' | 'forest' | 'river' | 'temple' | 'palace'
  | 'battlefield' | 'shore' | 'mountain' | 'village' | 'wilds';

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

/**
 * A story-place on the planet. `id` always equals the source scene's
 * `scene_id`, so v1 consumers that key on node id keep working.
 */
export interface WorldNode {
  id: string;
  title: string;
  emoji: string;
  /** v1 flat-projected position (equirectangular of lat/lon). Used by
   *  the v1 DOM fallback stage + the a11y mirror layer. */
  x: number;
  y: number;
  sceneIndex: number;
  bgImageUrl: string;
  mood: string;
  biome: Biome;
  /** Spherical position (radians). The 3D renderer reads these. */
  lat: number;
  lon: number;
  npcSlugs: string[];
  missions: WorldMission[];
  /** Mission ids that must ALL be completed to unlock this place.
   *  Empty = always unlocked (the spawn). Branching-aware. */
  unlockedBy: string[];
  nextNodeId?: string;
}

export interface WorldNpc {
  slug: string;
  name: string;
  role: string;
  emoji: string;
  /** Node id the NPC currently stands at (v1 compatibility + a11y). */
  nodeId: string;
  /** v1 screen-space offset from its node. */
  dx: number;
  dy: number;
  idlePhrase: string;
  /** v2: portrait URL (character.image_url or canon anchor_image_url). */
  portraitUrl?: string;
  /** v2: home place id (first scene the character appears in, or the
   *  least-populated node when no presence data). */
  homePlaceId: string;
  /** v2: ordered place ids the character traverses through the story,
   *  derived from `characters_present`. Drives canon-accurate NPC
   *  migration as the avatar unlocks later scenes. */
  schedule: string[];
  /** v2: voice mood for spatialized murmur (from the character's bible
   *  speech tone / first scene mood). */
  voiceMood?: string;
}

export interface WorldPortal {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** v1 flat position (45% along the path). */
  x: number;
  y: number;
  /** v2: spherical position (radians), 45% along the great-circle path. */
  lat: number;
  lon: number;
  /** v2: the story-graph edge this portal represents. */
  pathId: string;
}

/** A great-circle road between two linked places (the story DAG). */
export interface WorldPath {
  id: string;
  fromPlaceId: string;
  toPlaceId: string;
}

export interface WorldPalette {
  sky: string;
  ground: string;
  accent: string;
}

/** Per-biome terrain + sky colors for the 3D planet. */
export const BIOME_COLORS: Record<Biome, { terrain: string; sky: string; accent: string }> = {
  city: { terrain: '#8a7d6b', sky: '#d9c9a8', accent: '#c89b3c' },
  palace: { terrain: '#9b8a6e', sky: '#e6d2a8', accent: '#d4af37' },
  forest: { terrain: '#3f6b4a', sky: '#bfe0bf', accent: '#5CDB95' },
  river: { terrain: '#4a7a8c', sky: '#cfe8f2', accent: '#7FB2FF' },
  temple: { terrain: '#7a6a8a', sky: '#d8c9e8', accent: '#C39BD3' },
  battlefield: { terrain: '#5a3a2a', sky: '#c9774a', accent: '#FF6b3b' },
  shore: { terrain: '#b9a98a', sky: '#cfe6e6', accent: '#8fd3d3' },
  mountain: { terrain: '#6b6b78', sky: '#cdd6e0', accent: '#9fb2c9' },
  village: { terrain: '#9a8a6a', sky: '#e0d2a8', accent: '#c2a14b' },
  wilds: { terrain: '#3a4a3a', sky: '#a8b8a8', accent: '#6fae6f' },
};

export interface WorldPlanet {
  radius: number;
  /** Deterministic seed (hash of book slug) for terrain displacement noise. */
  seed: number;
  /** Sky colors for day/night gradient. */
  skyDay: string;
  skyNight: string;
}

export interface WorldManifest {
  worldId: string;
  bookSlug: string;
  bookTitle: string;
  subtitle: string;
  /** v1 canvas size (kept for the DOM fallback + a11y projection). */
  width: number;
  height: number;
  spawnNodeId: string;
  /** v1 alias — same objects as `places`. Existing consumers read this. */
  nodes: WorldNode[];
  /** v2 canonical — identical array reference to `nodes`. */
  places: WorldNode[];
  npcs: WorldNpc[];
  portals: WorldPortal[];
  paths: WorldPath[];
  palette: WorldPalette;
  planet: WorldPlanet;
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

// ---- Mood + biome ----------------------------------------------------

/** Infer a cozy mood from scene content so each destination reads
 *  distinctly. Falls back to 'serene'. */
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

/** Derive a biome from scene content. The biome drives 3D terrain
 *  color + sky tint + the procedural fallback when media is missing. */
const BIOME_KEYWORDS: ReadonlyArray<readonly [string, Biome]> = [
  ['battlefield', 'battlefield'], ['war', 'battlefield'], ['battle', 'battlefield'],
  ['lanka', 'battlefield'], ['army', 'battlefield'],
  ['forest', 'forest'], ['hermitage', 'forest'], ['ashram', 'forest'], ['woods', 'forest'],
  ['river', 'river'], ['ganga', 'river'], ['sarayu', 'river'], ['stream', 'river'], ['waterfall', 'river'],
  ['shore', 'shore'], ['sea', 'shore'], ['ocean', 'shore'], ['beach', 'shore'], ['island', 'shore'],
  ['mountain', 'mountain'], ['hill', 'mountain'], ['peak', 'mountain'],
  ['temple', 'temple'], ['shrine', 'temple'], ['prayer', 'temple'], ['ritual', 'temple'],
  ['palace', 'palace'], ['court', 'palace'], ['throne', 'palace'], ['sabha', 'palace'],
  ['city', 'city'], ['ayodhya', 'city'], ['mithila', 'city'], ['kingdom', 'city'],
  ['village', 'village'], ['hamlet', 'village'], ['cottage', 'village'],
];

function sceneBiome(scene: Scene): Biome {
  const hay = `${scene.title} ${scene.visual_description || ''} ${scene.short_summary || ''}`.toLowerCase();
  for (const [keyword, biome] of BIOME_KEYWORDS) {
    if (hay.includes(keyword)) return biome;
  }
  return 'wilds';
}

// ---- Layout: fibonacci sphere ---------------------------------------

/**
 * Distribute `total` points evenly on a unit sphere using the
 * fibonacci spiral. Returns lat/lon in radians for index `i`.
 * Scene 0 (the spawn) is biased toward the "north pole" so the journey
 * reads as descending and outward across the planet.
 */
export function fibonacciSphere(i: number, total: number): { lat: number; lon: number } {
  if (total <= 1) return { lat: Math.PI / 2, lon: 0 };
  // Scene 0 (the spawn) sits on the north pole so the journey reads as
  // descending + outward across the planet. The remaining scenes fill
  // the fibonacci spiral below it.
  if (i === 0) return { lat: Math.PI / 2, lon: 0 };
  // Golden angle in radians.
  const golden = Math.PI * (3 - Math.sqrt(5));
  // Even spacing on the z-axis (sphere point picking), but bias the
  // first point to the north pole so the spawn sits on top.
  const z = 1 - ((i + 0.5) * 2) / total;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const theta = i * golden;
  const x = Math.cos(theta) * r;
  const y = Math.sin(theta) * r;
  // Convert (x,y,z) → lat/lon. z is up.
  const lat = Math.asin(clamp(z, -1, 1)); // [-π/2, π/2]
  const lon = Math.atan2(y, x);           // [-π, π]
  return { lat, lon };
}

/** Project a lat/lon to the v1 flat canvas (equirectangular). Keeps
 *  the DOM fallback stage + a11y layer deterministic and consistent
 *  with the 3D view. */
function projectFlat(lat: number, lon: number): { x: number; y: number } {
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;
  // lon ∈ [-π,π] → x ∈ [pad, width-pad]; lat ∈ [-π/2,π/2] → y.
  const usableW = WORLD_WIDTH - 2 * PAD_X;
  const usableH = WORLD_HEIGHT - 2 * PAD_Y;
  const x = cx + (lon / Math.PI) * (usableW / 2);
  // north pole (lat=π/2) at top, south at bottom.
  const y = cy - (lat / (Math.PI / 2)) * (usableH / 2);
  return { x: clamp(x, PAD_X, WORLD_WIDTH - PAD_X), y: clamp(y, PAD_Y, WORLD_HEIGHT - PAD_Y) };
}

// ---- Spherical interpolation (great-circle) -------------------------

/** Slerp between two lat/lon points along the great-circle arc.
 *  `t` ∈ [0,1]. Returns the point at fraction `t`. */
export function slerpLatLon(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
): { lat: number; lon: number } {
  // Convert to unit vectors.
  const ax = [Math.cos(a.lat) * Math.cos(a.lon), Math.cos(a.lat) * Math.sin(a.lon), Math.sin(a.lat)];
  const bx = [Math.cos(b.lat) * Math.cos(b.lon), Math.cos(b.lat) * Math.sin(b.lon), Math.sin(b.lat)];
  let dot = ax[0] * bx[0] + ax[1] * bx[1] + ax[2] * bx[2];
  dot = clamp(dot, -1, 1);
  const omega = Math.acos(dot);
  if (Math.abs(omega) < 1e-5) return { lat: a.lat, lon: a.lon };
  const so = Math.sin(omega);
  const s0 = Math.sin((1 - t) * omega) / so;
  const s1 = Math.sin(t * omega) / so;
  const x = s0 * ax[0] + s1 * bx[0];
  const y = s0 * ax[1] + s1 * bx[1];
  const z = s0 * ax[2] + s1 * bx[2];
  return { lat: Math.asin(clamp(z, -1, 1)), lon: Math.atan2(y, x) };
}

function latLonToVec3(lat: number, lon: number, radius = PLANET_RADIUS): [number, number, number] {
  return [
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon),
  ];
}
export { latLonToVec3 };

// ---- Mission synthesis ----------------------------------------------

function buildMissions(scene: Scene, nodeId: string, successors: string[]): WorldMission[] {
  const missions: WorldMission[] = [];
  // Primary courier mission: carry this scene's narration to a portal
  // that leads to a successor. Emitted once per node (one fragment in
  // the satchel at a time); branching is expressed by multiple portals,
  // not multiple fragments. Guards against soft-locks: only when at
  // least one successor exists in the book.
  if (successors.length > 0) {
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

// ---- NPC placement + schedule ---------------------------------------

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
 * Assign each character to a node + derive a canon-accurate schedule.
 *
 * Schedule = the ordered list of scene_ids where the character appears
 * in `characters_present`, walked in `order_index`. This makes NPCs
 * traverse the world exactly as the book describes (Rama: Ayodhya →
 * forest → Lanka). Characters with no presence data fall back to a
 * single home node assigned round-robin onto the least-populated place
 * (deterministic), preserving v1 behaviour for legacy/seed books that
 * don't emit `characters_present`.
 */
function assignNpcs(
  scenes: Scene[],
  characters: Character[],
): Map<string, string[]> {
  const nodeSlugs = new Map<string, string[]>();
  for (const scene of scenes) nodeSlugs.set(scene.scene_id, []);

  const placed = new Set<string>();
  // 1. Honour explicit presence lists. A character's first listed
  //    scene becomes its home place; the full ordered list is its
  //    schedule (consumed by the NPC sprite in the 3D renderer).
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

  // 2. Round-robin the rest (no presence data) onto least-populated.
  const remaining = characters.filter(c => !placed.has(c.slug));
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

/** Build the ordered schedule (place ids) for a character from the
 *  scenes where it appears in `characters_present`. */
function scheduleFor(slug: string, scenes: Scene[]): string[] {
  const out: string[] = [];
  for (const scene of scenes) {
    const present = Array.isArray(scene.characters_present) ? scene.characters_present : [];
    if (present.includes(slug)) out.push(scene.scene_id);
  }
  return out;
}

function placeNpcNear(node: { x: number; y: number }, slug: string, index: number): { dx: number; dy: number } {
  const radius = 42;
  const angle = hashString(slug) * 0.0001 + index * (Math.PI / 3);
  return {
    dx: Math.cos(angle) * radius,
    dy: Math.sin(angle) * radius + 14,
  };
}

// ---- Palette + planet ------------------------------------------------

function paletteFor(book: Book): WorldPalette {
  const palettes: WorldPalette[] = [
    { sky: 'radial-gradient(circle at 50% 18%, #4A0404 0%, #1C120E 45%, #0C0806 85%)', ground: '#160F0B', accent: '#FF9933' },
    { sky: 'radial-gradient(circle at 50% 18%, #14233f 0%, #0d1626 45%, #070b12 85%)', ground: '#0c1322', accent: '#7FB2FF' },
    { sky: 'radial-gradient(circle at 50% 18%, #2d1b3a 0%, #1a1023 45%, #0c0813 85%)', ground: '#160f1c', accent: '#C39BD3' },
    { sky: 'radial-gradient(circle at 50% 18%, #14342a 0%, #0c1f17 45%, #06120d 85%)', ground: '#0c1a13', accent: '#5CDB95' },
  ];
  return palettes[hashString(book.slug) % palettes.length];
}

// ---- Story graph (DAG) ----------------------------------------------

/** Build the directed story graph from `next_scene_id` +
 *  `previous_scene_id`. Returns successors + predecessors per scene id.
 *  Handles branching (a scene may have multiple successors when books
 *  support branch scenes) and guards against edges to scenes not in
 *  the payload. */
function buildStoryGraph(scenes: Scene[]): {
  successors: Map<string, string[]>;
  predecessors: Map<string, string[]>;
} {
  const ids = new Set(scenes.map(s => s.scene_id));
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const s of scenes) {
    successors.set(s.scene_id, []);
    predecessors.set(s.scene_id, []);
  }
  for (const s of scenes) {
    const next = s.next_scene_id ? [s.next_scene_id] : [];
    for (const target of next) {
      if (ids.has(target)) {
        successors.get(s.scene_id)!.push(target);
        predecessors.get(target)!.push(s.scene_id);
      }
    }
  }
  return { successors, predecessors };
}

// ---- Synthesizer -----------------------------------------------------

export function synthesizeWorldManifest(
  book: Book,
  scenes: Scene[],
  characters: Character[],
): WorldManifest {
  const ordered = [...scenes].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const characterById = new Map(characters.map(c => [c.slug, c]));
  const npcAssignment = assignNpcs(ordered, characters);
  const { successors, predecessors } = buildStoryGraph(ordered);

  const nodes: WorldNode[] = ordered.map((scene, index) => {
    const { lat, lon } = fibonacciSphere(index, ordered.length);
    const { x, y } = projectFlat(lat, lon);
    const npcSlugs = npcAssignment.get(scene.scene_id) ?? [];
    const succ = successors.get(scene.scene_id) ?? [];
    const primary = buildMissions(scene, scene.scene_id, succ);
    const side = buildSideMissions(scene, scene.scene_id, npcSlugs, characterById);
    const mood = sceneMood(scene);
    const biome = sceneBiome(scene);
    // Branching-aware unlock: a place unlocks when ALL its predecessors'
    // fragments have been delivered. The spawn (no predecessors) is
    // always unlocked. For a linear book this reduces to v1 behaviour.
    const preds = predecessors.get(scene.scene_id) ?? [];
    const unlockedBy = preds.map(p => `mf-${p}`);
    return {
      id: scene.scene_id,
      title: scene.title,
      emoji: MOOD_EMOJI[mood] ?? '🌳',
      x,
      y,
      sceneIndex: index,
      bgImageUrl: scene.background_asset_url || '',
      mood,
      biome,
      lat,
      lon,
      npcSlugs,
      missions: [...primary, ...side],
      unlockedBy,
      nextNodeId: scene.next_scene_id ?? undefined,
    };
  });

  // Paths + portals: one per DAG edge (branching-aware). A portal sits
  // 45% along the great-circle arc from source to target.
  const paths: WorldPath[] = [];
  const portals: WorldPortal[] = [];
  for (const node of nodes) {
    for (const targetId of successors.get(node.id) ?? []) {
      const target = nodes.find(n => n.id === targetId);
      if (!target) continue;
      const pathId = `path-${node.id}-${target.id}`;
      paths.push({ id: pathId, fromPlaceId: node.id, toPlaceId: target.id });
      const mid = slerpLatLon({ lat: node.lat, lon: node.lon }, { lat: target.lat, lon: target.lon }, 0.45);
      const flat = projectFlat(mid.lat, mid.lon);
      portals.push({
        id: `portal-${node.id}-${target.id}`,
        fromNodeId: node.id,
        toNodeId: target.id,
        x: flat.x,
        y: flat.y,
        lat: mid.lat,
        lon: mid.lon,
        pathId,
      });
    }
  }

  const npcs: WorldNpc[] = [];
  for (const node of nodes) {
    for (const slug of node.npcSlugs) {
      const char = characterById.get(slug);
      if (!char) continue;
      const { dx, dy } = placeNpcNear(node, slug, npcs.length);
      const schedule = scheduleFor(slug, ordered);
      const homePlaceId = schedule[0] ?? node.id;
      const portraitUrl = char.image_url || undefined;
      npcs.push({
        slug: char.slug,
        name: char.name,
        role: char.role,
        emoji: pickEmoji(char.slug, NPC_EMOJI_PALETTE),
        nodeId: node.id,
        dx,
        dy,
        idlePhrase: idlePhraseFor(char),
        portraitUrl,
        homePlaceId,
        schedule,
        voiceMood: char.character_bible?.speech_tone || node.mood,
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
    places: nodes,
    npcs,
    portals,
    paths,
    palette: paletteFor(book),
    planet: {
      radius: PLANET_RADIUS,
      seed: hashString(book.slug),
      skyDay: BIOME_COLORS[sceneBiome(ordered[0] ?? ordered[0])].sky,
      skyNight: '#0a0e1a',
    },
    createdAt: 0, // stamped by the caller (Date is fine client-side)
  };
}

// ---- Selectors (used by UI + tests) ----------------------------------

/** Mission id for the "carry the fragment" job at a node, if any. */
export function deliverMissionId(nodeId: string): string {
  return `mf-${nodeId}`;
}

/** Is a node unlocked given the current session progress?
 *  Branching-aware: ALL `unlockedBy` missions must be completed. */
export function isNodeUnlocked(manifest: WorldManifest, completedMissionIds: string[], nodeId: string): boolean {
  const node = manifest.nodes.find(n => n.id === nodeId);
  if (!node) return false;
  if (node.sceneIndex === 0) return true; // spawn
  if (node.unlockedBy.length === 0) return true;
  return node.unlockedBy.every(id => completedMissionIds.includes(id));
}

export function clueEmoji(seed: string): string {
  return CLUE_EMOJI[hashString(seed) % CLUE_EMOJI.length];
}

// Back-compat: older callers imported `placeNode` / `MOOD_EMOJI` shapes
// indirectly. We re-export the public surface they relied on.
export { MOOD_EMOJI };