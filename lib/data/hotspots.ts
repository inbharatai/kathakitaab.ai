import { Hotspot } from '@/lib/types/livebook';

export const ramayanaHotspots: Hotspot[] = [
  // Scene 1: ayodhya_intro
  { id: 'hs-1-1', scene_id: 'ayodhya_intro', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 35, y: 40, width: 12, height: 22, tooltip: 'Meet Rama', action: 'open_character', quick_speak: 'Dharma is the foundation of all life. Ask me anything.', created_at: new Date().toISOString() },
  { id: 'hs-1-2', scene_id: 'ayodhya_intro', label: 'Lakshmana', hotspot_type: 'character', target_type: 'character', target_id: 'lakshmana', x: 48, y: 42, width: 10, height: 20, tooltip: 'Meet Lakshmana', action: 'open_character', quick_speak: 'I follow my brother always. Loyalty is my greatest virtue.', created_at: new Date().toISOString() },
  { id: 'hs-1-3', scene_id: 'ayodhya_intro', label: 'Dasharatha', hotspot_type: 'character', target_type: 'character', target_id: 'dasharatha', x: 20, y: 30, width: 12, height: 24, tooltip: 'Meet King Dasharatha', action: 'open_character', quick_speak: 'I am king of Ayodhya. But a king must keep his word, even at great cost.', created_at: new Date().toISOString() },
  { id: 'hs-1-4', scene_id: 'ayodhya_intro', label: 'Palace Gate', hotspot_type: 'place', target_type: 'info', target_id: 'ayodhya_palace', x: 75, y: 20, width: 18, height: 40, tooltip: 'Explore Ayodhya Palace', action: 'open_info', created_at: new Date().toISOString() },
  // Scene 2: mithila_bow
  { id: 'hs-2-1', scene_id: 'mithila_bow', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 40, y: 35, width: 12, height: 24, tooltip: 'Rama lifts the bow', action: 'open_character', quick_speak: 'No man has lifted this bow. Yet dharma calls me to try.', created_at: new Date().toISOString() },
  { id: 'hs-2-2', scene_id: 'mithila_bow', label: 'Sita', hotspot_type: 'character', target_type: 'character', target_id: 'sita', x: 60, y: 38, width: 10, height: 20, tooltip: 'Meet Sita', action: 'open_character', quick_speak: 'I prayed to the goddess. And then I saw Rama.', created_at: new Date().toISOString() },
  { id: 'hs-2-3', scene_id: 'mithila_bow', label: 'The Bow of Shiva', hotspot_type: 'object', target_type: 'info', target_id: 'shiva_bow', x: 30, y: 50, width: 20, height: 15, tooltip: 'The mighty bow', action: 'open_info', created_at: new Date().toISOString() },
  // Scene 3: exile
  { id: 'hs-3-1', scene_id: 'exile', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 38, y: 38, width: 12, height: 22, tooltip: 'Rama accepts exile', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-3-2', scene_id: 'exile', label: 'Sita', hotspot_type: 'character', target_type: 'character', target_id: 'sita', x: 52, y: 40, width: 10, height: 20, tooltip: 'Sita joins Rama', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-3-3', scene_id: 'exile', label: 'Lakshmana', hotspot_type: 'character', target_type: 'character', target_id: 'lakshmana', x: 25, y: 42, width: 10, height: 20, tooltip: 'Lakshmana follows', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-3-4', scene_id: 'exile', label: 'Dasharatha', hotspot_type: 'character', target_type: 'character', target_id: 'dasharatha', x: 70, y: 35, width: 12, height: 22, tooltip: 'The heartbroken king', action: 'open_character', created_at: new Date().toISOString() },
  // Scene 4: forest_life
  { id: 'hs-4-1', scene_id: 'forest_life', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 30, y: 45, width: 12, height: 22, tooltip: 'Rama in the forest', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-4-2', scene_id: 'forest_life', label: 'Sita', hotspot_type: 'character', target_type: 'character', target_id: 'sita', x: 45, y: 44, width: 10, height: 20, tooltip: 'Sita at the hermitage', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-4-3', scene_id: 'forest_life', label: 'Golden Deer', hotspot_type: 'object', target_type: 'info', target_id: 'golden_deer', x: 72, y: 55, width: 10, height: 14, tooltip: 'The enchanted golden deer', action: 'open_info', created_at: new Date().toISOString() },
  // Scene 5: ravana_jatayu
  { id: 'hs-5-1', scene_id: 'ravana_jatayu', label: 'Ravana', hotspot_type: 'character', target_type: 'character', target_id: 'ravana', x: 35, y: 30, width: 14, height: 24, tooltip: 'Ravana the abductor', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-5-2', scene_id: 'ravana_jatayu', label: 'Sita', hotspot_type: 'character', target_type: 'character', target_id: 'sita', x: 50, y: 35, width: 10, height: 18, tooltip: 'Sita in captivity', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-5-3', scene_id: 'ravana_jatayu', label: 'Jatayu', hotspot_type: 'character', target_type: 'character', target_id: 'jatayu', x: 65, y: 25, width: 14, height: 18, tooltip: 'Brave Jatayu fights', action: 'open_character', created_at: new Date().toISOString() },
  // Scene 6: hanuman_meets_rama
  { id: 'hs-6-1', scene_id: 'hanuman_meets_rama', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 25, y: 40, width: 12, height: 22, tooltip: 'Rama seeking Sita', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-6-2', scene_id: 'hanuman_meets_rama', label: 'Hanuman', hotspot_type: 'character', target_type: 'character', target_id: 'hanuman', x: 55, y: 38, width: 12, height: 24, tooltip: 'Meet Hanuman', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-6-3', scene_id: 'hanuman_meets_rama', label: 'Sugriva', hotspot_type: 'character', target_type: 'character', target_id: 'sugriva', x: 70, y: 40, width: 10, height: 20, tooltip: 'Meet Sugriva', action: 'open_character', created_at: new Date().toISOString() },
  // Scene 7: hanuman_lanka
  { id: 'hs-7-1', scene_id: 'hanuman_lanka', label: 'Hanuman', hotspot_type: 'character', target_type: 'character', target_id: 'hanuman', x: 40, y: 30, width: 14, height: 26, tooltip: 'Hanuman leaps!', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-7-2', scene_id: 'hanuman_lanka', label: 'Sita', hotspot_type: 'character', target_type: 'character', target_id: 'sita', x: 65, y: 50, width: 10, height: 18, tooltip: 'Sita in Ashoka Vatika', action: 'open_character', created_at: new Date().toISOString() },
  // Scene 8: bridge_to_lanka
  { id: 'hs-8-1', scene_id: 'bridge_to_lanka', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 20, y: 35, width: 12, height: 22, tooltip: 'Rama oversees the bridge', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-8-2', scene_id: 'bridge_to_lanka', label: 'Hanuman', hotspot_type: 'character', target_type: 'character', target_id: 'hanuman', x: 45, y: 50, width: 12, height: 20, tooltip: 'Hanuman carries stones', action: 'open_character', created_at: new Date().toISOString() },
  // Scene 9: battle_lanka
  { id: 'hs-9-1', scene_id: 'battle_lanka', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 25, y: 38, width: 12, height: 24, tooltip: 'Rama in battle', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-9-2', scene_id: 'battle_lanka', label: 'Ravana', hotspot_type: 'character', target_type: 'character', target_id: 'ravana', x: 60, y: 35, width: 14, height: 26, tooltip: 'Ravana faces Rama', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-9-3', scene_id: 'battle_lanka', label: 'Vibhishana', hotspot_type: 'character', target_type: 'character', target_id: 'vibhishana', x: 42, y: 50, width: 10, height: 18, tooltip: 'Vibhishana chooses dharma', action: 'open_character', created_at: new Date().toISOString() },
  // Scene 10: return_ayodhya
  { id: 'hs-10-1', scene_id: 'return_ayodhya', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 30, y: 35, width: 12, height: 22, tooltip: 'Rama returns!', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-10-2', scene_id: 'return_ayodhya', label: 'Sita', hotspot_type: 'character', target_type: 'character', target_id: 'sita', x: 44, y: 37, width: 10, height: 20, tooltip: 'Sita returns home', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-10-3', scene_id: 'return_ayodhya', label: 'Bharata', hotspot_type: 'character', target_type: 'character', target_id: 'bharata', x: 62, y: 40, width: 10, height: 20, tooltip: 'Bharata welcomes Rama', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-10-4', scene_id: 'return_ayodhya', label: 'Hanuman', hotspot_type: 'character', target_type: 'character', target_id: 'hanuman', x: 18, y: 42, width: 10, height: 20, tooltip: 'Hanuman returns victorious', action: 'open_character', created_at: new Date().toISOString() },
  // Scene 11: lessons
  { id: 'hs-11-1', scene_id: 'lessons', label: 'Rama', hotspot_type: 'character', target_type: 'character', target_id: 'rama', x: 15, y: 25, width: 10, height: 18, tooltip: 'Duty & Leadership', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-11-2', scene_id: 'lessons', label: 'Sita', hotspot_type: 'character', target_type: 'character', target_id: 'sita', x: 35, y: 25, width: 10, height: 18, tooltip: 'Dignity & Courage', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-11-3', scene_id: 'lessons', label: 'Hanuman', hotspot_type: 'character', target_type: 'character', target_id: 'hanuman', x: 55, y: 25, width: 10, height: 18, tooltip: 'Devotion & Humility', action: 'open_character', created_at: new Date().toISOString() },
  { id: 'hs-11-4', scene_id: 'lessons', label: 'Lakshmana', hotspot_type: 'character', target_type: 'character', target_id: 'lakshmana', x: 75, y: 25, width: 10, height: 18, tooltip: 'Loyalty', action: 'open_character', created_at: new Date().toISOString() },
];

export function getHotspotsBySceneId(sceneId: string): Hotspot[] {
  return ramayanaHotspots.filter(h => h.scene_id === sceneId);
}
