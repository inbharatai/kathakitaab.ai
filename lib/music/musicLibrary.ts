// ============================================================
// KathaKitaab — Universal Music Library
//
// Generic (genre, mood) → MusicProfile mapping that works for
// any book the user generates, not just Ramayana. Each profile
// defines a procedural-drone fallback (notes_hz) and an optional
// licensed audio file path. The orchestrator loads the file when
// present and falls back to procedural otherwise.
//
// Add new profiles freely; the music orchestrator will pick the
// best match for the requested (genre, mood). Audio file assets
// belong under public/audio/drones/{id}.mp3.
// ============================================================

import type { VoiceType } from '@/lib/audio/proceduralVoices';

export type SceneMood =
  | 'serene'
  | 'tense'
  | 'joyful'
  | 'mysterious'
  | 'dramatic'
  | 'sacred'
  | 'sorrowful'
  | 'triumphant'
  | 'playful'
  | 'melancholic'
  | 'valor';

export type MusicGenre =
  | 'mythology-indian'
  | 'fable-indian'
  | 'buddhist'
  | 'fantasy'
  | 'sci-fi'
  | 'kids'
  | 'biography'
  | 'education'
  | 'historical'
  | 'default';

export interface MusicProfile {
  /** Stable slug — also used as the audio file name (id.mp3). */
  id: string;
  /** Display name. */
  name: string;
  /** One or more genres this profile fits. */
  genres: MusicGenre[];
  /** Moods this profile expresses well. */
  moods: SceneMood[];
  /**
   * Procedural voice type — the primary path. The engine synthesizes
   * this voice from `notes_hz` using Web Audio. Always works without
   * any external assets or licensing.
   */
  voice: VoiceType;
  /** Frequencies (Hz) used by the procedural voice. */
  notes_hz: number[];
  /**
   * Optional audio file path — purely an escape hatch for users who
   * want to drop their own CC0 / public-domain samples at
   * /public/audio/drones/{audio_file}. The engine prefers procedural
   * synthesis by default; this is never required.
   */
  audio_file?: string;
  /** Cultural/musicological note (shown in admin/debug). */
  description: string;
}

// ── Profile registry ──
// Order matters only for tie-breaking — earlier profiles win when
// multiple match the same (genre, mood) pair.

const PROFILES: MusicProfile[] = [
  // ── Indian classical ragas (mythology + fable Indian) ──
  {
    id: 'raga-bhairav',
    name: 'Raga Bhairav',
    genres: ['mythology-indian'],
    moods: ['sacred', 'dramatic', 'valor'],
    voice: 'tanpura',
    notes_hz: [73.4, 110, 146.8],
    audio_file: 'raga-bhairav.mp3',
    description: 'Dawn raga; awakening, valor, sanctity. Used at scenes of vows, dawn, royal courts.',
  },
  {
    id: 'raga-yaman',
    name: 'Raga Yaman',
    genres: ['mythology-indian'],
    moods: ['joyful', 'triumphant', 'serene'],
    voice: 'tanpura',
    notes_hz: [130.8, 196, 261.6],
    audio_file: 'raga-yaman.mp3',
    description: 'Evening raga; aspiration, hope, devotion. Suits weddings, returns, blessings.',
  },
  {
    id: 'raga-bhairavi',
    name: 'Raga Bhairavi',
    genres: ['mythology-indian', 'fable-indian'],
    moods: ['sacred', 'melancholic', 'serene'],
    voice: 'tanpura',
    notes_hz: [98, 146.8, 196],
    audio_file: 'raga-bhairavi.mp3',
    description: 'Morning raga of deep devotion and reflection. Closing scenes, bhakti, parting.',
  },
  {
    id: 'raga-malkauns',
    name: 'Raga Malkauns',
    genres: ['mythology-indian'],
    moods: ['mysterious', 'dramatic', 'tense'],
    voice: 'tanpura',
    notes_hz: [82.4, 123.5, 164.8],
    audio_file: 'raga-malkauns.mp3',
    description: 'Midnight raga; pentatonic, gravely mysterious. Suits demonic forests, abductions.',
  },
  {
    id: 'raga-bhimpalasi',
    name: 'Raga Bhimpalasi',
    genres: ['mythology-indian'],
    moods: ['sorrowful', 'melancholic'],
    voice: 'tanpura',
    notes_hz: [110, 164.8, 220],
    audio_file: 'raga-bhimpalasi.mp3',
    description: 'Late-afternoon raga of yearning and separation. Suits exile, loss, captivity.',
  },
  {
    id: 'raga-desh',
    name: 'Raga Desh',
    genres: ['mythology-indian'],
    moods: ['triumphant', 'joyful'],
    voice: 'tanpura',
    notes_hz: [123.5, 185, 246.9],
    audio_file: 'raga-desh.mp3',
    description: 'Night raga of homecoming and patriotism. Suits returns and coronations.',
  },
  {
    id: 'raga-marwa',
    name: 'Raga Marwa',
    genres: ['mythology-indian'],
    moods: ['mysterious', 'tense', 'melancholic'],
    voice: 'tanpura',
    notes_hz: [87.3, 130.8, 174.6],
    audio_file: 'raga-marwa.mp3',
    description: 'Twilight raga; uneasy beauty, foreboding. Suits omens and turning points.',
  },
  {
    id: 'raga-hindolam',
    name: 'Raga Hindolam',
    genres: ['mythology-indian', 'fable-indian'],
    moods: ['playful', 'joyful', 'serene'],
    voice: 'tanpura',
    notes_hz: [146.8, 220, 293.6],
    audio_file: 'raga-hindolam.mp3',
    description: 'Light pentatonic raga of forest groves and play. Suits forests, animal scenes.',
  },

  // ── Buddhist / contemplative ──
  {
    id: 'singing-bowls',
    name: 'Tibetan Singing Bowls',
    genres: ['buddhist'],
    moods: ['sacred', 'serene', 'melancholic'],
    voice: 'bowls',
    notes_hz: [80, 110, 200],
    audio_file: 'singing-bowls.mp3',
    description: 'Slow resonant bowls and bells. Suits monasteries, meditation, parables.',
  },
  {
    id: 'temple-bells',
    name: 'Temple Bells',
    genres: ['buddhist', 'mythology-indian'],
    moods: ['sacred', 'triumphant'],
    voice: 'bowls',
    notes_hz: [196, 261.6, 392],
    audio_file: 'temple-bells.mp3',
    description: 'Bright bells and gongs. Suits ceremonies, blessings, arrivals at sacred sites.',
  },

  // ── Fantasy / cinematic ──
  {
    id: 'cinematic-orchestral',
    name: 'Cinematic Orchestral',
    genres: ['fantasy', 'historical', 'biography', 'default'],
    moods: ['dramatic', 'triumphant', 'valor'],
    voice: 'cinematic-pad',
    notes_hz: [98, 130.8, 196],
    audio_file: 'cinematic-orchestral.mp3',
    description: 'Heroic orchestral pad. Suits epic battles, declarations, grand entrances.',
  },
  {
    id: 'cinematic-ambient',
    name: 'Cinematic Ambient',
    genres: ['fantasy', 'biography', 'historical', 'default'],
    moods: ['serene', 'mysterious', 'melancholic'],
    voice: 'cinematic-pad',
    notes_hz: [110, 165, 220],
    audio_file: 'cinematic-ambient.mp3',
    description: 'Soft sustained pads. The neutral fallback for unfamiliar moods.',
  },

  // ── Sci-fi ──
  {
    id: 'ambient-synth',
    name: 'Ambient Synth Pad',
    genres: ['sci-fi'],
    moods: ['mysterious', 'serene', 'tense'],
    voice: 'synth-pad',
    notes_hz: [55, 82.4, 110],
    audio_file: 'ambient-synth.mp3',
    description: 'Deep low pads with shimmer. Suits space, future tech, cold landscapes.',
  },
  {
    id: 'tense-pulse',
    name: 'Tense Synth Pulse',
    genres: ['sci-fi', 'fantasy'],
    moods: ['tense', 'dramatic'],
    voice: 'tense-pulse',
    notes_hz: [73.4, 98, 146.8],
    audio_file: 'tense-pulse.mp3',
    description: 'Pulsing low synth with rising tension. Suits chases, escapes, countdowns.',
  },

  // ── Kids ──
  {
    id: 'playful-piano',
    name: 'Playful Piano',
    genres: ['kids', 'fable-indian'],
    moods: ['playful', 'joyful', 'serene'],
    voice: 'bells',
    notes_hz: [261.6, 329.6, 392],
    audio_file: 'playful-piano.mp3',
    description: 'Light major-key piano figures. Suits cheerful kids stories and fables.',
  },
  {
    id: 'storybook-marimba',
    name: 'Storybook Marimba',
    genres: ['kids'],
    moods: ['playful', 'joyful'],
    voice: 'marimba',
    notes_hz: [220, 277.2, 329.6],
    audio_file: 'storybook-marimba.mp3',
    description: 'Bright wooden marimba. Suits whimsical or silly moments.',
  },

  // ── Education ──
  {
    id: 'lo-fi-focus',
    name: 'Lo-Fi Focus',
    genres: ['education'],
    moods: ['serene', 'playful'],
    voice: 'lo-fi',
    notes_hz: [130.8, 174.6, 220],
    audio_file: 'lo-fi-focus.mp3',
    description: 'Soft warm beats. Suits study mode and biography breakdowns.',
  },
];

// ── Selection ──

/**
 * Pick the best music profile for the given (genre, mood). Falls
 * through three layers of preference:
 *   1. Exact (genre, mood) match.
 *   2. Same genre, any of its moods.
 *   3. 'default' genre with the requested mood.
 *   4. cinematic-ambient as last resort.
 */
export function selectMusicProfile(genre: MusicGenre, mood: SceneMood): MusicProfile {
  const exact = PROFILES.find(p => p.genres.includes(genre) && p.moods.includes(mood));
  if (exact) return exact;

  const genreMatch = PROFILES.find(p => p.genres.includes(genre));
  if (genreMatch) return genreMatch;

  const moodMatch = PROFILES.find(p => p.genres.includes('default') && p.moods.includes(mood));
  if (moodMatch) return moodMatch;

  return PROFILES.find(p => p.id === 'cinematic-ambient')!;
}

/** Public read-only access for debugging / admin UI. */
export function listMusicProfiles(): MusicProfile[] {
  return PROFILES.slice();
}

/**
 * Map a free-form mood string from the LLM into our enum. Tolerates
 * unknown values by returning 'serene'.
 */
export function normalizeMood(raw: string | undefined | null): SceneMood {
  if (!raw) return 'serene';
  const v = raw.toLowerCase();
  const known: SceneMood[] = [
    'serene', 'tense', 'joyful', 'mysterious', 'dramatic', 'sacred',
    'sorrowful', 'triumphant', 'playful', 'melancholic', 'valor',
  ];
  if (known.includes(v as SceneMood)) return v as SceneMood;
  // Common synonyms
  const synonyms: Record<string, SceneMood> = {
    calm: 'serene', peaceful: 'serene', quiet: 'serene',
    happy: 'joyful', cheerful: 'joyful', bright: 'joyful',
    sad: 'sorrowful', grief: 'sorrowful', mournful: 'sorrowful',
    fearful: 'tense', anxious: 'tense', urgent: 'tense',
    epic: 'dramatic', grand: 'dramatic', cinematic: 'dramatic',
    holy: 'sacred', divine: 'sacred', ceremonial: 'sacred',
    fun: 'playful', light: 'playful', whimsical: 'playful',
    eerie: 'mysterious', uncanny: 'mysterious', strange: 'mysterious',
    victorious: 'triumphant', heroic: 'valor', brave: 'valor',
    // Common LLM emissions that we map onto the closest enum:
    melancholy: 'melancholic', wistful: 'melancholic',
    devotional: 'sacred', reverent: 'sacred', solemn: 'sacred',
    battle: 'dramatic', war: 'dramatic', conflict: 'tense',
    contemplative: 'serene', reflective: 'melancholic',
  };
  return synonyms[v] ?? 'serene';
}

/**
 * Infer a music genre from a book slug. Uses the canon registry's
 * declared genre when available; falls back to keyword heuristics.
 */
export function inferGenreFromBook(
  bookSlug: string | undefined | null,
  bookTitle: string | undefined | null,
  declaredGenre?: string | undefined,
): MusicGenre {
  if (declaredGenre) {
    const known: MusicGenre[] = [
      'mythology-indian', 'fable-indian', 'buddhist', 'fantasy', 'sci-fi',
      'kids', 'biography', 'education', 'historical', 'default',
    ];
    if (known.includes(declaredGenre as MusicGenre)) return declaredGenre as MusicGenre;
  }

  const haystack = `${bookSlug ?? ''} ${bookTitle ?? ''}`.toLowerCase();
  if (/ramayana|mahabharata|shiva|vishnu|krishna|durga|indian myth/.test(haystack)) return 'mythology-indian';
  if (/panchatantra|jataka|fable|aesop/.test(haystack)) return 'fable-indian';
  if (/buddha|buddhist|zen|dharma path/.test(haystack)) return 'buddhist';
  if (/sci.?fi|space|robot|alien|future|cyber/.test(haystack)) return 'sci-fi';
  if (/fantasy|wizard|dragon|magic|elf|hobbit|witch/.test(haystack)) return 'fantasy';
  if (/kid|child|bedtime|nursery|fairy/.test(haystack)) return 'kids';
  if (/biography|life of|memoir/.test(haystack)) return 'biography';
  if (/lesson|class|education|study|tutorial/.test(haystack)) return 'education';
  if (/history|empire|war of|revolution|kingdom/.test(haystack)) return 'historical';
  return 'default';
}
