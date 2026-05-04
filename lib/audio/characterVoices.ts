// ============================================================
// KathaKitaab.ai — Universal Character Voice Map
//
// Book-agnostic character→voice mapping. Each archetype maps to
// a (sarvam, gemini) voice pair so the TTS router can pick the
// right voice regardless of which provider serves the request.
//
// Adding a new book? Just map the new character slugs to one of
// the existing archetypes — no new voices needed.
// ============================================================

export type CharacterArchetype =
  | 'narrator'         // default storytelling voice — warm, neutral
  | 'noble-male'       // hero protagonists (Rama, Yudhishthira, Arjuna)
  | 'young-male'       // younger heroes / brothers (Lakshmana, Bharata, Nakula)
  | 'wise-male'        // sages, elders, kings (Vasishtha, Drona, Bhishma, Dasharatha)
  | 'commanding-male'  // antagonist kings (Ravana, Duryodhana, Indrajit)
  | 'bright-male'      // jovial / energetic (Hanuman, Krishna's playful side)
  | 'noble-female'     // queens / princesses (Sita, Draupadi, Mandodari)
  | 'young-female'     // youthful female / child voice
  | 'aged-female';     // queen mother (Kausalya, Kunti, Gandhari)

export interface VoiceMapping {
  /** Sarvam Bulbul v3 speaker id. */
  sarvam: string;
  /** Gemini 2.5 Native Audio prebuilt voice name. */
  gemini: string;
  /** Display label for debug / admin UI. */
  label: string;
}

// Sarvam Bulbul v3 speaker roster (38 voices). Adjust ids here if
// Sarvam updates the roster or if a particular voice sounds wrong.
// Valid v3 speakers as of 2026:
//   Male:   aditya, ashutosh, rahul, rohan, amit, dev, ratan, varun, manan,
//           sumit, kabir, aayan, shubh, advait, anand, tarun, sunny, mani,
//           gokul, vijay, mohit, rehan, soham
//   Female: ritu, priya, neha, pooja, simran, kavya, ishita, shreya, roopa,
//           tanya, shruti, suhani, kavitha, rupali, niharika
export const ARCHETYPE_VOICES: Record<CharacterArchetype, VoiceMapping> = {
  'narrator':        { sarvam: 'priya',   gemini: 'Aoede',  label: 'Warm narrator (female)' },
  'noble-male':      { sarvam: 'vijay',   gemini: 'Charon', label: 'Noble hero (deep, steady male)' },
  'young-male':      { sarvam: 'rohan',   gemini: 'Puck',   label: 'Younger hero (lighter male)' },
  'wise-male':       { sarvam: 'aditya',  gemini: 'Fenrir', label: 'Sage / elder (measured male)' },
  'commanding-male': { sarvam: 'ratan',   gemini: 'Orus',   label: 'Antagonist (resonant male)' },
  'bright-male':     { sarvam: 'kabir',   gemini: 'Puck',   label: 'Jovial / energetic male' },
  'noble-female':    { sarvam: 'shreya',  gemini: 'Kore',   label: 'Noble (dignified female)' },
  'young-female':    { sarvam: 'kavya',   gemini: 'Leda',   label: 'Youthful female' },
  'aged-female':     { sarvam: 'kavitha', gemini: 'Kore',   label: 'Queen mother (female)' },
};

// Per-character mappings — universal across books. The TTS router
// matches on lowercased character slug; unknown slugs fall back to
// 'narrator'. Add new entries freely as new books ship.
const CHARACTER_ARCHETYPES: Record<string, CharacterArchetype> = {
  // Ramayana
  rama: 'noble-male',
  lakshmana: 'young-male',
  bharata: 'young-male',
  shatrughna: 'young-male',
  hanuman: 'bright-male',
  ravana: 'commanding-male',
  vibhishana: 'wise-male',
  kumbhakarna: 'commanding-male',
  indrajit: 'commanding-male',
  sugriva: 'noble-male',
  vali: 'commanding-male',
  jambavan: 'wise-male',
  dasharatha: 'wise-male',
  janaka: 'wise-male',
  vishvamitra: 'wise-male',
  vasishtha: 'wise-male',
  jatayu: 'wise-male',
  maricha: 'commanding-male',
  sita: 'noble-female',
  kausalya: 'aged-female',
  kaikeyi: 'noble-female',
  sumitra: 'aged-female',
  mandodari: 'noble-female',
  surpanakha: 'noble-female',

  // Mahabharata
  yudhishthira: 'noble-male',
  bhima: 'commanding-male',
  arjuna: 'noble-male',
  nakula: 'young-male',
  sahadeva: 'young-male',
  krishna: 'bright-male',
  duryodhana: 'commanding-male',
  duhshasana: 'commanding-male',
  karna: 'noble-male',
  bhishma: 'wise-male',
  drona: 'wise-male',
  shakuni: 'commanding-male',
  vidura: 'wise-male',
  draupadi: 'noble-female',
  kunti: 'aged-female',
  gandhari: 'aged-female',

  // Panchatantra (animals voiced by archetype)
  vishnu_sharma: 'wise-male',
  pingalaka: 'commanding-male',
  damanaka: 'bright-male',
  sanjivaka: 'wise-male',
};

/** Look up the archetype for a character slug; falls back to 'narrator'. */
export function getCharacterArchetype(characterSlug?: string | null): CharacterArchetype {
  if (!characterSlug) return 'narrator';
  return CHARACTER_ARCHETYPES[characterSlug.toLowerCase()] ?? 'narrator';
}

/** Return the (sarvam, gemini) voice mapping for a character slug. */
export function getVoiceMapping(characterSlug?: string | null): VoiceMapping {
  return ARCHETYPE_VOICES[getCharacterArchetype(characterSlug)];
}

/** Allow callers to override the archetype directly (for villain mode etc). */
export function getVoiceMappingByArchetype(archetype: CharacterArchetype): VoiceMapping {
  return ARCHETYPE_VOICES[archetype];
}
