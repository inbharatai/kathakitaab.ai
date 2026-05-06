// ============================================================
// KathaKitaab.ai — Universal Emotion / Tone Tagger
//
// Pure-function classifier that maps a piece of narration text to
// a coarse emotional tone, then translates the tone into TTS
// pace/pitch/loudness triples that Sarvam Bulbul v2 understands.
//
// Universal: book-agnostic word lists, same vocabulary works for
// Ramayana, Mahabharata, Panchatantra, sci-fi, biography, etc.
// Deterministic: no model call, no network — same input always
// gives the same output, so cache keys derived from tone are stable.
//
// Why scene-mood isn't enough:
//   - Two scenes can both be "dramatic" but one is a fierce battle
//     and the other is a tense confrontation. Same TTS shape would
//     flatten both. The tagger looks at the actual *sentence text*
//     so a single scene can carry multiple tones across cues.
//
// The mapping ranges are tuned to Sarvam Bulbul v2:
//   pace     ∈ [0.5, 2.0]   (1.0 = neutral)
//   pitch    ∈ [-100, 100]  (0  = neutral, units = cents-ish)
//   loudness ∈ [-3, 3]      (0  = neutral)
// All three are clamped on send; we keep a generous safety margin.
// ============================================================

export type Tone = 'neutral' | 'serene' | 'joyful' | 'dramatic' | 'sorrowful' | 'sacred' | 'tense';

/** A delivery shape: how Sarvam Bulbul should speak this line. */
export interface ToneDelivery {
  /** Speaking rate. 1.0 is neutral; <1 is slower, >1 is faster. */
  pace: number;
  /** Pitch shift. 0 is neutral; positive = higher, negative = lower. */
  pitch: number;
  /** Volume shift. 0 is neutral; positive = louder, negative = quieter. */
  loudness: number;
}

const TONE_DELIVERY: Record<Tone, ToneDelivery> = {
  // Neutral narration — what the engine has done so far.
  neutral:   { pace: 1.00, pitch:   0, loudness:  0 },
  // Quiet, reflective. Slightly slower, slightly softer, slightly lower.
  serene:    { pace: 0.92, pitch: -10, loudness: -1 },
  // Bright, celebratory. Faster, higher, louder.
  joyful:    { pace: 1.10, pitch:  20, loudness:  1 },
  // Battle, action, urgency. Markedly faster, slightly louder.
  dramatic:  { pace: 1.15, pitch:  10, loudness:  1 },
  // Loss, grief, regret. Slower, lower, quieter.
  sorrowful: { pace: 0.85, pitch: -25, loudness: -2 },
  // Reverence, awe, prayer. Slower, lower, but full-voiced — not quiet.
  sacred:    { pace: 0.90, pitch: -15, loudness:  0 },
  // Suspense, confrontation, tense quiet. Pace slightly slower (drawn
  // out), pitch slightly raised (tightness), loudness held.
  tense:     { pace: 0.95, pitch:   8, loudness:  0 },
};

// Word lists are deliberately curated — small, high-precision triggers
// rather than exhaustive synonyms. We only need to *bias* the score;
// neutral is the safe fallback when nothing matches.
const TRIGGERS: Record<Exclude<Tone, 'neutral'>, string[]> = {
  serene:    [
    'gentle', 'calm', 'quiet', 'peaceful', 'soft', 'breath', 'whisper',
    'still', 'hush', 'serene', 'tranquil', 'meadow', 'stream', 'morning',
    'rest', 'wisdom',
  ],
  joyful:    [
    'joy', 'rejoice', 'celebrate', 'cheered', 'laugh', 'laughter',
    'beam', 'beaming', 'wedding', 'crown', 'crowned', 'triumph',
    'victorious', 'feast', 'dance', 'song', 'sang', 'blessed',
    'reunion', 'returned',
  ],
  dramatic:  [
    'battle', 'fight', 'fought', 'strike', 'struck', 'arrow', 'bow',
    'sword', 'clash', 'roar', 'thunder', 'storm', 'fury', 'rage',
    'rush', 'charge', 'leap', 'leaped', 'crash', 'shatter',
    'shattered', 'flame', 'fire', 'blaze', 'demon', 'demons',
    'rakshasa', 'shouted', 'cried out', 'erupted',
  ],
  sorrowful: [
    'sorrow', 'grief', 'wept', 'weep', 'tear', 'tears', 'mourn',
    'mourning', 'broken', 'heartbroken', 'lament', 'farewell',
    'exile', 'banished', 'lost', 'silent tear', 'fell silent',
    'died', 'death', 'fallen', 'alone', 'forsaken', 'longing',
  ],
  sacred:    [
    'divine', 'blessed', 'sage', 'sacred', 'holy', 'temple', 'altar',
    'mantra', 'prayer', 'pray', 'prayed', 'bowed', 'reverence',
    'dharma', 'vow', 'vows', 'oath', 'gods', 'goddess', 'lord',
    'rama', 'sita', 'hanuman', 'shiva', 'vishnu', 'brahma', 'krishna',
    'ganga', 'yamuna', 'aarti', 'puja', 'ashram', 'hermitage',
  ],
  tense:     [
    'shadow', 'shadows', 'crept', 'whispered to', 'watching',
    'narrowed', 'narrowed eyes', 'silence fell', 'paused', 'froze',
    'tightened', 'gripped', 'unease', 'doubt', 'suspicion',
    'confronted', 'demanded', 'warned', 'whispered',
  ],
};

/**
 * Classify a piece of text into a Tone. Falls back to 'neutral' when
 * no triggers match strongly enough.
 *
 * Algorithm: score each non-neutral tone by counting whole-word matches
 * (word boundaries on both sides). Pick the highest non-zero score; tie
 * broken by the order in TRIGGERS (sacred before tense, etc.). If no
 * tone scores at all, return neutral.
 */
export function detectTone(text: string): Tone {
  if (!text || text.length < 8) return 'neutral';
  const lc = text.toLowerCase();

  let bestTone: Tone = 'neutral';
  let bestScore = 0;

  for (const tone of Object.keys(TRIGGERS) as Array<Exclude<Tone, 'neutral'>>) {
    let score = 0;
    for (const trigger of TRIGGERS[tone]) {
      // Word-boundary match so "battle" doesn't match "rebattlement"
      // and "fire" doesn't match "fireworks" (we don't have the second
      // case, but the principle is what we want for adversarial text).
      const re = new RegExp(`\\b${trigger.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lc)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTone = tone;
    }
  }

  return bestTone;
}

/**
 * Translate a Tone into the (pace, pitch, loudness) triple that
 * Sarvam Bulbul v2 accepts. Neutral is the identity transform.
 */
export function deliveryForTone(tone: Tone): ToneDelivery {
  return TONE_DELIVERY[tone];
}

/**
 * Convenience: text → delivery, skipping the intermediate tone label.
 * Use this when the caller doesn't care about the tone, only the
 * shape it should send to Sarvam.
 */
export function deliveryForText(text: string): ToneDelivery {
  return deliveryForTone(detectTone(text));
}

/**
 * Map a scene mood (the existing manifest field, set per-scene) to
 * a Tone. Lets callers without per-line classification still get
 * tone-aware delivery without any text inspection.
 */
const MOOD_TO_TONE: Record<string, Tone> = {
  serene: 'serene',
  joyful: 'joyful',
  dramatic: 'dramatic',
  somber: 'sorrowful',
  sacred: 'sacred',
  mysterious: 'tense',
};

export function toneFromMood(mood?: string | null): Tone {
  if (!mood) return 'neutral';
  return MOOD_TO_TONE[mood.toLowerCase()] ?? 'neutral';
}
