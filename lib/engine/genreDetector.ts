// ============================================================
// KathaKitaab — Genre / Region / Era Detector
//
// Lightweight pure-function classifier that infers story metadata
// from the book title, subtitle, description, or user prompt.
//
// No LLM call — keyword heuristics + pattern matching only.
// Designed to be fast, deterministic, and safe (no user input
// ever reaches an eval or regex constructor).
//
// The visual prompt builder consumes the output to pick a
// culturally-neutral default style instead of hardcoding Vedic/Bollywood.
// ============================================================

export type GenreCategory =
  | 'mythology'
  | 'history'
  | 'folktale'
  | 'fantasy'
  | 'sci_fi'
  | 'biography'
  | 'education'
  | 'children'
  | 'adventure'
  | 'mystery'
  | 'romance'
  | 'horror'
  | 'generic';

export type CulturalRegion =
  | 'indian'
  | 'greek'
  | 'roman'
  | 'norse'
  | 'celtic'
  | 'chinese'
  | 'japanese'
  | 'african'
  | 'arabic'
  | 'mesoamerican'
  | 'generic';

export type Era =
  | 'ancient'
  | 'medieval'
  | 'renaissance'
  | 'colonial'
  | 'modern'
  | 'future'
  | 'timeless'
  | 'generic';

export type VisualTone =
  | 'epic'
  | 'intimate'
  | 'dark'
  | 'bright'
  | 'whimsical'
  | 'gritty'
  | 'mystical'
  | 'naturalistic'
  | 'generic';

export type AgeSuitability =
  | 'all_ages'
  | 'children'
  | 'teen'
  | 'adult';

export type RecommendedPreset =
  | 'photoreal_cinematic'
  | 'storybook_watercolor'
  | 'cinematic_animation'
  | 'comic_book'
  | 'anime_manga';

export interface GenreProfile {
  genre: GenreCategory;
  region: CulturalRegion;
  era: Era;
  tone: VisualTone;
  age: AgeSuitability;
  recommendedPreset: RecommendedPreset;
  /** One-line summary for debugging / admin UI */
  summary: string;
}

// ── Keyword maps ─────────────────────────────────────────────

interface KeywordMap {
  genre: Record<string, GenreCategory[]>;
  region: Record<string, CulturalRegion[]>;
  era: Record<string, Era[]>;
  age: Record<string, AgeSuitability[]>;
}

const KEYWORDS: KeywordMap = {
  genre: {
    // Mythology
    mythology: ['mythology'],
    myth: ['mythology'],
    myths: ['mythology'],
    epic: ['mythology'],
    legend: ['mythology'],
    divine: ['mythology'],
    god: ['mythology'],
    goddess: ['mythology'],
    pantheon: ['mythology'],
    ramayana: ['mythology'],
    mahabharata: ['mythology'],
    iliad: ['mythology'],
    odyssey: ['mythology'],
    'folk tale': ['folktale'],
    folktale: ['folktale'],
    fable: ['folktale'],
    parable: ['folktale'],
    fairy: ['children'],
    'fairy tale': ['children'],
    fantasy: ['fantasy'],
    dragon: ['fantasy'],
    wizard: ['fantasy'],
    elf: ['fantasy'],
    dwarf: ['fantasy'],
    magic: ['fantasy'],
    quest: ['fantasy'],
    kingdom: ['fantasy'],
    'sci-fi': ['sci_fi'],
    scifi: ['sci_fi'],
    'science fiction': ['sci_fi'],
    'star wars': ['sci_fi'],
    space: ['sci_fi'],
    spaceship: ['sci_fi'],
    robot: ['sci_fi'],
    alien: ['sci_fi'],
    future: ['sci_fi'],
    dystopia: ['sci_fi'],
    cyberpunk: ['sci_fi'],
    utopia: ['sci_fi'],
    anime: ['fantasy'],
    manga: ['fantasy'],
    mecha: ['sci_fi'],
    shonen: ['adventure'],
    isekai: ['fantasy'],
    'super hero': ['adventure'],
    superhero: ['adventure'],
    'teen adventure': ['adventure'],
    'young adult fantasy': ['fantasy'],
    biography: ['biography'],
    autobiography: ['biography'],
    memoir: ['biography'],
    'life of': ['biography'],
    history: ['history'],
    historical: ['history'],
    empire: ['history'],
    revolution: ['history'],
    war: ['history'],
    battle: ['history'],
    ancient: ['history'],
    medieval: ['history'],
    renaissance: ['history'],
    colonial: ['history'],
    akbar: ['history'],
    birbal: ['history'],
    vikram: ['folktale'],
    betaal: ['folktale'],
    tenali: ['folktale'],
    classroom: ['education'],
    lesson: ['education'],
    education: ['education'],
    textbook: ['education'],
    science: ['education'],
    math: ['education'],
    'grade 1': ['education'],
    'grade 2': ['education'],
    'grade 3': ['education'],
    'grade 4': ['education'],
    'grade 5': ['education'],
    'grade 6': ['education'],
    'grade 7': ['education'],
    'grade 8': ['education'],
    'grade 9': ['education'],
    'grade 10': ['education'],
    'grade 11': ['education'],
    'grade 12': ['education'],
    ncert: ['education'],
    kids: ['children'],
    children: ['children'],
    child: ['children'],
    bedtime: ['children'],
    nursery: ['children'],
    adventure: ['adventure'],
    journey: ['adventure'],
    expedition: ['adventure'],
    mystery: ['mystery'],
    detective: ['mystery'],
    crime: ['mystery'],
    romance: ['romance'],
    love: ['romance'],
    horror: ['horror'],
    scary: ['horror'],
    ghost: ['horror'],
    haunted: ['horror'],
    vampire: ['horror'],
  },
  region: {
    india: ['indian'],
    indian: ['indian'],
    hindi: ['indian'],
    sanskrit: ['indian'],
    vedic: ['indian'],
    ramayana: ['indian'],
    mahabharata: ['indian'],
    panchatantra: ['indian'],
    jataka: ['indian'],
    krishna: ['indian'],
    rama: ['indian'],
    ravana: ['indian'],
    hanuman: ['indian'],
    shiva: ['indian'],
    ganesha: ['indian'],
    durga: ['indian'],
    lakshmi: ['indian'],
    kali: ['indian'],
    brahma: ['indian'],
    vishnu: ['indian'],
    arjuna: ['indian'],
    karna: ['indian'],
    draupadi: ['indian'],
    bhishma: ['indian'],
    yudhishthira: ['indian'],
    duryodhana: ['indian'],
    akbar: ['indian'],
    birbal: ['indian'],
    vikram: ['indian'],
    betaal: ['indian'],
    tenali: ['indian'],
    mughal: ['indian'],
    maratha: ['indian'],
    gupta: ['indian'],
    maurya: ['indian'],
    greek: ['greek'],
    iliad: ['greek'],
    odyssey: ['greek'],
    trojan: ['greek'],
    achilles: ['greek'],
    hercules: ['greek'],
    zeus: ['greek'],
    olympus: ['greek'],
    athena: ['greek'],
    apollo: ['greek'],
    poseidon: ['greek'],
    hades: ['greek'],
    perseus: ['greek'],
    theseus: ['greek'],
    minotaur: ['greek'],
    medusa: ['greek'],
    roman: ['roman'],
    caesar: ['roman'],
    gladiator: ['roman'],
    colosseum: ['roman'],
    norse: ['norse'],
    viking: ['norse'],
    odin: ['norse'],
    thor: ['norse'],
    loki: ['norse'],
    valhalla: ['norse'],
    asgard: ['norse'],
    ragnarok: ['norse'],
    celtic: ['celtic'],
    druid: ['celtic'],
    arthur: ['celtic'],
    merlin: ['celtic'],
    chinese: ['chinese'],
    confucius: ['chinese'],
    'sun wukong': ['chinese'],
    wukong: ['chinese'],
    japanese: ['japanese'],
    genji: ['japanese'],
    samurai: ['japanese'],
    ninja: ['japanese'],
    shinto: ['japanese'],
    yokai: ['japanese'],
    tanuki: ['japanese'],
    kitsune: ['japanese'],
    ronin: ['japanese'],
    bushido: ['japanese'],
    edo: ['japanese'],
    meiji: ['japanese'],
    african: ['african'],
    anansi: ['african'],
    zulu: ['african'],
    masai: ['african'],
    yoruba: ['african'],
    arabic: ['arabic'],
    arabian: ['arabic'],
    '1001 nights': ['arabic'],
    'one thousand and one nights': ['arabic'],
    aladdin: ['arabic'],
    sinbad: ['arabic'],
    mesoamerican: ['mesoamerican'],
    aztec: ['mesoamerican'],
    maya: ['mesoamerican'],
    inca: ['mesoamerican'],
    quetzalcoatl: ['mesoamerican'],
  },
  era: {
    ancient: ['ancient'],
    'bc ': ['ancient'],
    'bce ': ['ancient'],
    iliad: ['ancient'],
    odyssey: ['ancient'],
    medieval: ['medieval'],
    'middle ages': ['medieval'],
    renaissance: ['renaissance'],
    colonial: ['colonial'],
    modern: ['modern'],
    '20th century': ['modern'],
    '21st century': ['modern'],
    'world war': ['modern'],
    wwii: ['modern'],
    ww2: ['modern'],
    'cold war': ['modern'],
    future: ['future'],
    futuristic: ['future'],
    'year 3000': ['future'],
    'year 2500': ['future'],
    'far future': ['future'],
  },
  age: {
    kids: ['children'],
    children: ['children'],
    child: ['children'],
    nursery: ['children'],
    bedtime: ['children'],
    'age 3': ['children'],
    'age 4': ['children'],
    'age 5': ['children'],
    'age 6': ['children'],
    'age 7': ['children'],
    'grade 1': ['children'],
    'grade 2': ['children'],
    'grade 3': ['children'],
    'grade 4': ['children'],
    'grade 5': ['children'],
    teen: ['teen'],
    teenager: ['teen'],
    'young adult': ['teen'],
    ya: ['teen'],
    'age 13': ['teen'],
    'age 14': ['teen'],
    'age 15': ['teen'],
    'age 16': ['teen'],
    'age 17': ['teen'],
    horror: ['adult'],
    war: ['adult'],
    crime: ['adult'],
    murder: ['adult'],
    violence: ['adult'],
    romance: ['adult'],
  },
};

// ── Scoring helpers ──────────────────────────────────────────

function scoreKeywords(text: string, map: Record<string, string[]>): Map<string, number> {
  const scores = new Map<string, number>();
  const lower = text.toLowerCase();
  for (const [keyword, tags] of Object.entries(map)) {
    // Count occurrences as a simple scoring heuristic.
    // Use word-boundary matching for short keywords (< 5 chars) to avoid
    // false positives (e.g. "war" inside "warning").
    const pattern = keyword.length < 5 ? new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'gi') : new RegExp(escapeRegex(keyword), 'gi');
    const matches = lower.match(pattern);
    if (matches) {
      for (const tag of tags) {
        scores.set(tag, (scores.get(tag) ?? 0) + matches.length);
      }
    }
  }
  return scores;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function topScore<T>(scores: Map<string, number>, fallback: T): T {
  let best = fallback as unknown as string;
  let bestScore = -1;
  for (const [key, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best as unknown as T;
}

function inferTone(genre: GenreCategory, region: CulturalRegion): VisualTone {
  if (region === 'japanese' && genre === 'mythology') return 'mystical';
  if (region === 'norse' && genre === 'mythology') return 'gritty';
  if (region === 'greek' && genre === 'mythology') return 'epic';
  if (genre === 'mythology') return 'epic';
  if (genre === 'sci_fi') return region === 'generic' ? 'gritty' : 'epic';
  if (genre === 'fantasy') return 'mystical';
  if (genre === 'horror') return 'dark';
  if (genre === 'children' || genre === 'folktale') return 'whimsical';
  if (genre === 'biography') return 'naturalistic';
  if (genre === 'history') return 'naturalistic';
  if (genre === 'mystery') return 'dark';
  if (genre === 'romance') return 'intimate';
  return 'generic';
}

function recommendPreset(genre: GenreCategory, age: AgeSuitability, region: CulturalRegion): RecommendedPreset {
  if (age === 'children' || genre === 'children' || genre === 'folktale') return 'storybook_watercolor';
  if (genre === 'sci_fi') return 'anime_manga';
  if (genre === 'fantasy') return 'anime_manga';
  if (genre === 'adventure' && age === 'teen') return 'anime_manga';
  if (genre === 'mythology' && (region === 'indian' || region === 'greek' || region === 'norse')) return 'photoreal_cinematic';
  if (genre === 'history' || genre === 'biography') return 'photoreal_cinematic';
  if (genre === 'adventure') return 'cinematic_animation';
  return 'photoreal_cinematic';
}

// ── Public API ──────────────────────────────────────────────

/**
 * Infer a full GenreProfile from the book title, subtitle, and description.
 * Safe to call with any user input — no eval, no dynamic regex construction
 * from user strings.
 */
export function detectGenreProfile(
  title: string,
  subtitle?: string,
  description?: string,
): GenreProfile {
  const combined = [title, subtitle, description].filter(Boolean).join(' ');
  const genreScores = scoreKeywords(combined, KEYWORDS.genre);
  const regionScores = scoreKeywords(combined, KEYWORDS.region);
  const eraScores = scoreKeywords(combined, KEYWORDS.era);
  const ageScores = scoreKeywords(combined, KEYWORDS.age);

  const genre = topScore(genreScores, 'generic');
  const region = topScore(regionScores, 'generic');
  const era = topScore(eraScores, 'generic');
  const age = topScore(ageScores, 'all_ages');
  const tone = inferTone(genre, region);
  const recommendedPreset = recommendPreset(genre, age, region);

  return {
    genre,
    region,
    era,
    tone,
    age,
    recommendedPreset,
    summary: `${genre} · ${region} · ${era} · ${tone} · ${age} → ${recommendedPreset}`,
  };
}

/**
 * Build a culturally-neutral, genre-aware visual style fallback clause
 * for use in image prompts when no explicit StylePreset was chosen and
 * no canon style exists.
 *
 * The returned string replaces the old hardcoded Vedic/Bollywood default.
 */
export function buildGenreAwareStyleClause(profile: GenreProfile): string {
  const { genre, region, era, tone } = profile;

  // Base register — cinematic photoreal by default
  let clause = 'Style: photorealistic cinematic still';

  // Genre-specific register
  switch (genre) {
    case 'mythology':
      clause += ' from a high-budget mythological epic film';
      break;
    case 'sci_fi':
      clause += ' from a high-budget science-fiction film';
      break;
    case 'fantasy':
      clause += ' from a high-budget fantasy epic film';
      break;
    case 'history':
      clause += ' from a prestige historical drama';
      break;
    case 'biography':
      clause += ' from a prestige biographical film';
      break;
    case 'folktale':
    case 'children':
      // Watercolour is the better default for these, but the caller
      // should already prefer storybook_watercolor as the preset.
      // If we land here it means no preset was chosen — still keep it
      // photoreal but soften the register.
      clause += ' in a warm storybook-film register — painterly realism, soft lighting';
      break;
    case 'adventure':
      clause += ' from a high-budget adventure film';
      break;
    case 'horror':
      clause += ' from a atmospheric horror film';
      break;
    case 'mystery':
      clause += ' from a prestige mystery thriller';
      break;
    case 'romance':
      clause += ' from a romantic drama';
      break;
    default:
      clause += ' from a high-quality feature film';
  }

  // Region-specific costume / setting hints
  switch (region) {
    case 'indian':
      if (genre === 'mythology' || genre === 'history') {
        clause += ' — ornate ancient Indian costume and architecture, authentic period setting';
      } else if (genre === 'folktale' || genre === 'children') {
        clause += ' — Indian village or palace setting, warm colour palette';
      } else {
        clause += ' — Indian cultural setting';
      }
      break;
    case 'greek':
      clause += ' — classical Greek or Mediterranean setting, bronze-age or Hellenistic costume, marble and olive groves';
      break;
    case 'roman':
      clause += ' — ancient Roman setting, togas, legionary armour, marble columns and forums';
      break;
    case 'norse':
      clause += ' — Nordic Viking-age setting, carved wood halls, fjords, cold northern light';
      break;
    case 'celtic':
      clause += ' — ancient Celtic or Arthurian Britain, misty forests, stone circles, wool and iron';
      break;
    case 'chinese':
      clause += ' — ancient Chinese setting, silk robes, pagodas, misty mountains';
      break;
    case 'japanese':
      clause += ' — feudal Japanese or Shinto setting, traditional architecture, cherry blossoms or bamboo forests';
      break;
    case 'african':
      clause += ' — authentic African setting, savanna or village, vibrant textiles, warm golden light';
      break;
    case 'arabic':
      clause += ' — Arabian or Islamic golden-age setting, desert palaces, ornate geometry, warm desert light';
      break;
    case 'mesoamerican':
      clause += ' — Mesoamerican setting, pyramid temples, jade and feathered regalia, tropical light';
      break;
    case 'generic':
    default:
      // No region override — keep it universal
      break;
  }

  // Era hints (only when region is generic or to add specificity)
  switch (era) {
    case 'ancient':
      if (region === 'generic') clause += ' — ancient world setting';
      break;
    case 'medieval':
      if (region === 'generic') clause += ' — medieval European setting, castles, feudal costume';
      break;
    case 'renaissance':
      if (region === 'generic') clause += ' — Renaissance-era setting, oil-painting richness';
      break;
    case 'colonial':
      if (region === 'generic') clause += ' — colonial-era setting';
      break;
    case 'modern':
      if (region === 'generic') clause += ' — contemporary modern setting';
      break;
    case 'future':
      clause += ' — futuristic technology and environment, sleek or gritty sci-fi production design';
      break;
    case 'timeless':
    case 'generic':
      break;
  }

  // Tone / lighting
  switch (tone) {
    case 'epic':
      clause += ', dramatic golden-hour lighting, sweeping composition';
      break;
    case 'intimate':
      clause += ', soft warm lighting, shallow depth of field, close emotional framing';
      break;
    case 'dark':
      clause += ', low-key chiaroscuro lighting, moody shadows, desaturated palette';
      break;
    case 'bright':
      clause += ', bright clear sunlight, saturated colours, open airy composition';
      break;
    case 'whimsical':
      clause += ', soft pastel lighting, gentle warmth, storybook atmosphere';
      break;
    case 'gritty':
      clause += ', desaturated colour grading, harsh practical lighting, documentary realism';
      break;
    case 'mystical':
      clause += ', ethereal volumetric light, fog and particles, otherworldly atmosphere';
      break;
    case 'naturalistic':
      clause += ', natural daylight, documentary realism, period-accurate detail';
      break;
    case 'generic':
      clause += ', dramatic lighting, rich saturated colour grading, shallow depth of field, subtle film grain, anamorphic widescreen composition, hyper-detailed painterly realism';
      break;
  }

  // Anti-style guard (universal)
  clause += '. NOT cartoon, NOT anime, NOT flat illustration.';

  return clause;
}

/**
 * Convenience: given a title, return the recommended StylePreset string
 * (or undefined if the caller should use their own default logic).
 */
export function recommendPresetForTitle(title: string): RecommendedPreset | undefined {
  const profile = detectGenreProfile(title);
  return profile.recommendedPreset;
}
