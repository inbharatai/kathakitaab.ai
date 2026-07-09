import { synthesizeWorldManifest, npcCurrentPlaceId } from '../lib/world/worldManifest.ts';
import { ramayanaBook, ramayanaScenes, ramayanaCharacters } from '../lib/data/ramayanaSeed.ts';
const book = ramayanaBook;
const scenes = ramayanaScenes;
const characters = ramayanaCharacters;
const m = synthesizeWorldManifest(book, scenes, characters);
console.log('NPCs:', m.npcs.length, '| nodes:', m.nodes.length);
const firstNode = m.nodes[0]?.id ?? '';
console.log('firstNode:', firstNode);
for (const npc of m.npcs) {
  const sched = npc.schedule ? `[${npc.schedule.length}]=${JSON.stringify(npc.schedule)}` : 'UNDEFINED';
  const session = { currentNodeId: firstNode, visitedNodeIds: [firstNode], completedMissionIds: [], carriedFragmentNodeId: firstNode, avatarLat: 0, avatarLon: 0, xp: 0, unlockedFragmentNodeIds: [] };
  try {
    const place = npcCurrentPlaceId(npc, session);
    console.log(`  ${npc.slug}: home=${npc.homePlaceId} node=${npc.nodeId} schedule=${sched} -> ${place} OK`);
  } catch (e) {
    console.log(`  ${npc.slug}: schedule=${sched} -> THREW: ${e.message}`);
  }
}