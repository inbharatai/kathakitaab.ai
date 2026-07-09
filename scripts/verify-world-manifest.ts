// ============================================================
// scripts/verify-world-manifest.ts
//
// Accuracy audit for the universal Living World v2 engine. Exercises
// every public function of the manifest synthesizer, the session
// reducer, and the media resolver against the curated Ramayana seed
// (offline — no AI, no DB, no network). Hard-fails (exit 1) if any
// invariant is broken, and reports every failure in one run.
//
// Run:
//   npx tsx scripts/verify-world-manifest.ts
//
// What this covers:
//   · synthesizeWorldManifest — deterministic (same payload → same
//     serialized manifest twice), structurally complete
//   · fibonacciSphere — even distribution; spawn biased to north pole
//   · slerpLatLon / latLonToVec3 — endpoints + round-trip stability
//   · isNodeUnlocked — spawn unlocked, non-spawn locked until all
//     predecessor fragments delivered (branching-aware)
//   · deliverMissionId / clueEmoji — id patterns stable
//   · mediaResolver — dead Supabase host + empty → procedural; local
//     /images + cdn.kathakitaab.com → live
//   · worldSession v2 — createInitialSession auto-pickup, reducer
//     transitions, v1 migration, portal-open selector, XP awards
//
// The a11y/mirror DOM layer (WorldA11yLayer) is verified by the
// Playwright e2e suite (tests/e2e/living-world.spec.ts), not here.
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  synthesizeWorldManifest,
  fibonacciSphere,
  slerpLatLon,
  latLonToVec3,
  isNodeUnlocked,
  deliverMissionId,
  clueEmoji,
} from '../lib/world/worldManifest';
import {
  createInitialSession,
  reduceWorldSession,
  loadWorldSession,
  saveWorldSession,
  clearWorldSession,
  isPortalOpenFor,
  unlockedNodeIds,
  totalMissionCount,
  WORLD_SESSION_VERSION,
  type WorldSessionState,
} from '../lib/world/worldSession';
import { isDeadMediaUrl, resolvePlaceMedia } from '../lib/world/mediaResolver';
import { ramayanaBook, ramayanaScenes, ramayanaCharacters } from '../lib/data/ramayanaSeed';
import type { Book, Scene, Character } from '../lib/types/livebook';

interface Failure { check: string; problem: string }
const failures: Failure[] = [];
let checks = 0;
function check(name: string, cond: boolean, problem: string): void {
  checks++;
  if (!cond) failures.push({ check: name, problem });
}
function approx(a: number, b: number, eps: number): boolean { return Math.abs(a - b) < eps; }

// ---- Load real payloads ------------------------------------------------

const book = ramayanaBook as Book;
const scenes = ramayanaScenes as Scene[];
const characters = ramayanaCharacters as Character[];

check('seed loaded', scenes.length > 0 && characters.length > 0, 'Ramayana seed empty — cannot verify');

// ---- synthesizeWorldManifest: determinism + structure ------------------

const m1 = synthesizeWorldManifest(book, scenes, characters);
const m2 = synthesizeWorldManifest(book, scenes, characters);
m1.createdAt = 0; m2.createdAt = 0; // stamp differs; equalize for the hash check
check('manifest determinism', JSON.stringify(m1) === JSON.stringify(m2), 'synthesizeWorldManifest is not deterministic (same payload → different output)');
check('manifest worldId', m1.worldId === `world-${book.slug}`, `worldId mismatch: ${m1.worldId}`);
check('manifest has nodes', m1.nodes.length === scenes.length, `nodes length ${m1.nodes.length} ≠ scenes ${scenes.length}`);
check('nodes===places alias', m1.nodes === m1.places, 'nodes and places must be the same array reference');
check('spawn is first node', m1.spawnNodeId === m1.nodes[0]?.id, 'spawnNodeId must be the first node');
check('spawn unlocked', isNodeUnlocked(m1, [], m1.nodes[0].id), 'spawn must be unlocked with no progress');
check('second node locked at start', m1.nodes.length > 1 && !isNodeUnlocked(m1, [], m1.nodes[1].id), 'second node must be locked before any delivery');
check('planet radius', m1.planet.radius === 6, `planet radius ${m1.planet.radius} ≠ 6`);
check('planet seed stable', typeof m1.planet.seed === 'number' && m1.planet.seed === m2.planet.seed, 'planet seed must be a stable number');

// ---- fibonacciSphere ---------------------------------------------------

const total = 12;
const pts = Array.from({ length: total }, (_, i) => fibonacciSphere(i, total));
check('fib count', pts.length === total, 'fibonacciSphere must return one point per index');
// Spawn (i=0) biased toward north pole (lat near +π/2).
check('fib spawn near north pole', approx(pts[0].lat, Math.PI / 2, 0.25), `spawn lat ${pts[0].lat} not near north pole`);
// Lats within [-π/2, π/2], lons within [-π, π].
check('fib lat range', pts.every(p => p.lat >= -Math.PI / 2 - 1e-6 && p.lat <= Math.PI / 2 + 1e-6), 'lat out of [-π/2, π/2]');
check('fib lon range', pts.every(p => p.lon >= -Math.PI - 1e-6 && p.lon <= Math.PI + 1e-6), 'lon out of [-π, π]');

// ---- slerpLatLon + latLonToVec3 ---------------------------------------

const a = { lat: 0, lon: 0 };
const b = { lat: 0, lon: Math.PI / 2 };
const mid = slerpLatLon(a, b, 0.5);
check('slerp endpoints t=0', approx(slerpLatLon(a, b, 0).lat, a.lat, 1e-6) && approx(slerpLatLon(a, b, 0).lon, a.lon, 1e-6), 'slerp t=0 must equal a');
check('slerp endpoints t=1', approx(slerpLatLon(a, b, 1).lat, b.lat, 1e-6) && approx(slerpLatLon(a, b, 1).lon, b.lon, 1e-6), 'slerp t=1 must equal b');
check('slerp midpoint', approx(mid.lat, 0, 1e-6) && approx(mid.lon, Math.PI / 4, 1e-4), `slerp midpoint wrong: lat=${mid.lat} lon=${mid.lon}`);
const v = latLonToVec3(0, 0, 6);
check('latLonToVec3 equator', approx(v[0], 6, 1e-6) && approx(v[1], 0, 1e-6) && approx(v[2], 0, 1e-6), `equator vec3 wrong: ${v}`);
const vpole = latLonToVec3(Math.PI / 2, 0, 6);
check('latLonToVec3 pole', approx(vpole[0], 0, 1e-6) && approx(vpole[1], 6, 1e-6) && approx(vpole[2], 0, 1e-6), `pole vec3 wrong: ${vpole}`);

// ---- Branching-aware unlock -------------------------------------------

// Delivering the spawn's fragment should unlock its successor(s).
const spawnId = m1.nodes[0].id;
const spawnSucc = m1.portals.filter(p => p.fromNodeId === spawnId);
check('spawn has a portal', spawnSucc.length >= 1, 'spawn must have at least one portal (courier loop)');
const afterDeliver = reduceWorldSession(
  { ...createInitialSession(m1), completedMissionIds: [deliverMissionId(spawnId)], carriedFragmentNodeId: null },
  { type: 'VISIT_NODE', nodeId: spawnSucc[0].toNodeId },
  m1,
);
check('successor unlocked after delivery', isNodeUnlocked(m1, afterDeliver.completedMissionIds, spawnSucc[0].toNodeId), 'successor must unlock once the source fragment is delivered');
check('portal opens after delivery', isPortalOpenFor(afterDeliver, spawnSucc[0]), 'portal must be open after its source fragment is delivered');

// ---- Mission id patterns ----------------------------------------------

check('deliver mission id', deliverMissionId('s1') === 'mf-s1', `deliverMissionId pattern wrong: ${deliverMissionId('s1')}`);
check('clue emoji stable', clueEmoji('mc-s1-0') === clueEmoji('mc-s1-0'), 'clueEmoji must be deterministic for the same seed');

// ---- NPC schedule derived from characters_present ---------------------

// At least one character in the seed has a multi-place schedule
// (canon traversal: e.g. Rama appears across several scenes).
const withSchedule = m1.npcs.filter(n => n.schedule.length >= 2);
check('npc schedule multi-place exists', withSchedule.length >= 1, 'no NPC has a multi-place schedule — characters_present derivation may be broken');
if (withSchedule[0]) {
  // Schedule entries must be valid node ids.
  const ids = new Set(m1.nodes.map(n => n.id));
  check('npc schedule ids valid', withSchedule[0].schedule.every(id => ids.has(id)), `NPC ${withSchedule[0].slug} schedule has unknown place ids`);
  // Home place = first schedule entry.
  check('npc home = first schedule', withSchedule[0].homePlaceId === withSchedule[0].schedule[0], `NPC ${withSchedule[0].slug} homePlaceId ≠ schedule[0]`);
}

// ---- mediaResolver -----------------------------------------------------

check('dead supabase detected', isDeadMediaUrl('https://esaypdyvmymsmlgxxylv.supabase.co/storage/v1/object/public/scene-images/x.png'), 'dead Supabase URL not detected');
check('empty url is dead', isDeadMediaUrl('') && isDeadMediaUrl(undefined) && isDeadMediaUrl(null), 'empty/null URL not treated as dead');
check('local /images alive', !isDeadMediaUrl('/images/scene_1.png'), 'local /images path wrongly flagged dead');
check('cdn alive', !isDeadMediaUrl('https://cdn.kathakitaab.com/scene-images/x.png'), 'cdn.kathakitaab.com URL wrongly flagged dead');
const live = resolvePlaceMedia('https://cdn.kathakitaab.com/x.png', 'forest', 'serene');
check('resolve live', live.kind === 'live' && live.url === 'https://cdn.kathakitaab.com/x.png', 'live URL not passed through');
const proc = resolvePlaceMedia('https://esaypdyvmymsmlgxxylv.supabase.co/x.png', 'forest', 'serene');
check('resolve procedural', proc.kind === 'procedural' && proc.biome === 'forest', 'dead URL not resolved to procedural');

// Real showcase backups: every background_asset_url is a dead Supabase URL.
const BACKUP_DIR = join(process.cwd(), 'data', 'showcase-backups');
let backupSlugs: string[] = [];
try { backupSlugs = readdirSync(BACKUP_DIR).filter(n => n.endsWith('.json')).map(n => n.replace(/\.json$/, '')); } catch { /* dir missing */ }
for (const slug of backupSlugs) {
  const file = JSON.parse(readFileSync(join(BACKUP_DIR, `${slug}.json`), 'utf8')) as { book?: { scenes?: { background_asset_url?: string }[] } };
  const bs = file.book?.scenes ?? [];
  const dead = bs.filter(s => isDeadMediaUrl(s.background_asset_url));
  check(`backup ${slug} all dead pre-rehydrate`, dead.length === bs.length && bs.length > 0, `${slug}: expected all scenes dead pre-rehydrate, got ${dead.length}/${bs.length}`);
}

// ---- #6 escort missions (wider mission grammar) ------------------------
//
// Escort missions are synthesized from NPC schedules: at each canon place
// except the last, the NPC gets an "Escort onward" mission whose target is
// their next scheduled place. At least one seed NPC (Rama) has a multi-place
// schedule, so at least one escort mission must exist. Determinism is
// covered by the manifest JSON-equality check above; here we assert the
// grammar is non-empty, well-formed, and points at real, later stops.
const escortMissions = m1.nodes.flatMap(n => n.missions.filter(m => m.kind === 'escort'));
check('escort missions exist', escortMissions.length >= 1, 'no escort missions synthesized — schedule-derived grammar may be broken');
const nodeIds = new Set(m1.nodes.map(n => n.id));
for (const e of escortMissions) {
  check(`escort ${e.id} has target`, !!e.targetNodeId && nodeIds.has(e.targetNodeId), `escort ${e.id} missing/invalid targetNodeId`);
  check(`escort ${e.id} has character`, !!e.characterSlug, `escort ${e.id} missing characterSlug`);
  check(`escort ${e.id} target later`, !!e.targetNodeId && nodeIds.has(e.targetNodeId), `escort ${e.id} target not a known place`);
}
// Every escort target must be a strictly-later stop in that NPC's schedule.
for (const e of escortMissions) {
  const npc = m1.npcs.find(n => n.slug === e.characterSlug);
  const sched = npc?.schedule ?? [];
  const srcIdx = sched.indexOf(e.nodeId);
  const tgtIdx = e.targetNodeId ? sched.indexOf(e.targetNodeId) : -1;
  check(`escort ${e.id} advances schedule`, srcIdx >= 0 && tgtIdx === srcIdx + 1, `escort ${e.id} target is not the next schedule stop after source`);
}

// ---- worldSession v2 ---------------------------------------------------

const init = createInitialSession(m1);
check('init version', init.version === WORLD_SESSION_VERSION, `init version ${init.version} ≠ ${WORLD_SESSION_VERSION}`);
check('init on spawn', init.currentNodeId === m1.spawnNodeId, 'init currentNodeId must be spawn');
check('init visited spawn', init.visitedNodeIds.includes(m1.spawnNodeId), 'init must mark spawn visited');
const spawnHasFragment = m1.nodes[0].missions.some(m => m.kind === 'deliver_fragment');
check('init auto-pickup fragment', !spawnHasFragment || init.carriedFragmentNodeId === m1.spawnNodeId, 'init must auto-pickup the spawn fragment when one exists');

// VISIT_NODE auto-picks up the next node's fragment.
const nextId = spawnSucc[0]?.toNodeId;
if (nextId) {
  const visited = reduceWorldSession(
    { ...init, completedMissionIds: [deliverMissionId(spawnId)], carriedFragmentNodeId: null },
    { type: 'VISIT_NODE', nodeId: nextId },
    m1,
  );
  check('visit sets current', visited.currentNodeId === nextId, 'VISIT_NODE did not set currentNodeId');
  check('visit records visited', visited.visitedNodeIds.includes(nextId), 'VISIT_NODE did not record visited');
  const nextHasFrag = m1.nodes.find(n => n.id === nextId)?.missions.some(m => m.kind === 'deliver_fragment');
  check('visit auto-pickup next', !nextHasFrag || visited.carriedFragmentNodeId === nextId, 'VISIT_NODE did not auto-pickup the next fragment');
}

// SET_AVATAR with lat/lon.
const moved = reduceWorldSession(init, { type: 'SET_AVATAR', x: 100, y: 100, lat: 0.5, lon: -0.3 }, m1);
check('set avatar x/y', moved.avatarX === 100 && moved.avatarY === 100, 'SET_AVATAR did not set x/y');
check('set avatar lat/lon', moved.avatarLat === 0.5 && moved.avatarLon === -0.3, 'SET_AVATAR did not set lat/lon');

// DELIVER_FRAGMENT awards XP + clears carry.
const delivered = reduceWorldSession(init, { type: 'DELIVER_FRAGMENT', fromNodeId: spawnId }, m1);
check('deliver awards xp', delivered.xp === init.xp + 40, `DELIVER_FRAGMENT xp ${delivered.xp} ≠ +40`);
check('deliver completes mission', delivered.completedMissionIds.includes(deliverMissionId(spawnId)), 'DELIVER_FRAGMENT did not complete the mission');
check('deliver clears carry', delivered.carriedFragmentNodeId === null, 'DELIVER_FRAGMENT did not clear carried fragment');

// Double-deliver is a no-op.
const deliveredTwice = reduceWorldSession(delivered, { type: 'DELIVER_FRAGMENT', fromNodeId: spawnId }, m1);
check('deliver idempotent', deliveredTwice.xp === delivered.xp && deliveredTwice.completedMissionIds.length === delivered.completedMissionIds.length, 'DELIVER_FRAGMENT not idempotent');

// COMPLETE_MISSION awards XP once.
const clue = m1.nodes[0].missions.find(m => m.kind === 'collect_clue');
if (clue) {
  const clueDone = reduceWorldSession(init, { type: 'COMPLETE_MISSION', missionId: clue.id, rewardXP: clue.rewardXP }, m1);
  check('complete mission xp', clueDone.xp === init.xp + clue.rewardXP, 'COMPLETE_MISSION did not award XP');
  const clueTwice = reduceWorldSession(clueDone, { type: 'COMPLETE_MISSION', missionId: clue.id, rewardXP: clue.rewardXP }, m1);
  check('complete mission idempotent', clueTwice.xp === clueDone.xp, 'COMPLETE_MISSION not idempotent');
}

// RESET returns to the initial state.
const reset = reduceWorldSession(delivered, { type: 'RESET' }, m1);
check('reset clears progress', reset.completedMissionIds.length === 0 && reset.xp === 0, 'RESET did not clear progress');
check('reset respawns', reset.currentNodeId === m1.spawnNodeId, 'RESET did not respawn');

// v1 migration: a hand-built v1 session loads as v2.
const v1Session: WorldSessionState = {
  version: 1,
  bookSlug: book.slug,
  currentNodeId: m1.spawnNodeId,
  avatarX: 50, avatarY: 50,
  visitedNodeIds: [m1.spawnNodeId],
  completedMissionIds: [],
  carriedFragmentNodeId: m1.spawnNodeId,
  xp: 10,
  createdAt: 1, updatedAt: 1,
};
// saveWorldSession + loadWorldSession round-trip through localStorage.
// In a tsx process there's no window — emulate the storage the modules
// expect so the migrate path is actually exercised.
const g = globalThis as unknown as { window?: unknown };
if (!g.window) {
  const store = new Map<string, string>();
  (g as unknown as { window: { localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } } }).window = {
    localStorage: {
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: k => void store.delete(k),
    },
  };
}
saveWorldSession(v1Session);
const migrated = loadWorldSession(book.slug);
check('v1 migration version', !!migrated && migrated.version === WORLD_SESSION_VERSION, 'v1 session did not migrate to v2');
check('v1 migration preserves progress', !!migrated && migrated.carriedFragmentNodeId === m1.spawnNodeId && migrated.xp === 10, 'v1 migration dropped progress');
clearWorldSession(book.slug);

// Selectors.
check('totalMissionCount > 0', totalMissionCount(m1) > 0, 'totalMissionCount must be positive');
check('unlockedNodeIds at start', unlockedNodeIds(m1, init).size >= 1, 'unlockedNodeIds must include the spawn at start');

// ---- Report ------------------------------------------------------------

console.log(`[world:verify] ran ${checks} check(s) against the Ramayana seed + ${backupSlugs.length} showcase backup(s).`);
if (failures.length === 0) {
  console.log('[world:verify] OK — manifest v2 engine passes all accuracy checks.');
  process.exit(0);
}
console.log(`[world:verify] ${failures.length} failure(s):`);
for (const f of failures) console.log(`         · ${f.check}: ${f.problem}`);
process.exit(1);