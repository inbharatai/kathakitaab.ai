// ============================================================
// KathaKitaab — Quality Scorer
//
// Evaluates a GeneratedBook on 13 dimensions and produces a
// structured score with warnings and regeneration suggestions.
//
// Design constraints:
//   • Pure functions — no I/O, safe to unit-test.
//   • Deterministic — same book → same score.
//   • Fast — no LLM calls. Heuristic + keyword scoring only.
//   • Honest — never inflate scores to make the product look good.
//
// Usage: call scoreBook(book) after generation, before persisting.
// If score.isSafeToShow === false, trigger regeneration or show a
// "preview quality" warning to the user.
// ============================================================

import type { GeneratedBook, GeneratedScene, GeneratedCharacter } from '@/lib/openai/bookGeneratorAgent';

export type QualityDimension =
  | 'coherence'
  | 'originality'
  | 'ageFit'
  | 'culturalFit'
  | 'characterConsistency'
  | 'sceneContinuity'
  | 'visualPromptQuality'
  | 'interactionRichness'
  | 'educationalValue'
  | 'safety'
  | 'repetition'
  | 'endingQuality'
  | 'movieReadiness';

export interface DimensionScore {
  name: QualityDimension;
  score: number; // 0–100
  weight: number;
  comment: string;
}

export interface QualityReport {
  totalScore: number; // 0–100
  maxPossible: number;
  perCategory: Record<QualityDimension, DimensionScore>;
  warnings: string[];
  regenerationSuggestions: string[];
  isSafeToShow: boolean;
  passThreshold: number;
}

// ── Config ─────────────────────────────────────────────────

const MIN_PASS_SCORE = 60;
const MAX_POSSIBLE = 100;

const WEIGHTS: Record<QualityDimension, number> = {
  coherence: 12,
  originality: 6,
  ageFit: 8,
  culturalFit: 8,
  characterConsistency: 10,
  sceneContinuity: 10,
  visualPromptQuality: 7,
  interactionRichness: 6,
  educationalValue: 5,
  safety: 12,
  repetition: 8,
  endingQuality: 8,
  movieReadiness: 5,
};

// ── Scoring helpers ────────────────────────────────────────

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function avg(...vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function lexicalDiversity(texts: string[]): number {
  const allWords = texts.join(' ').toLowerCase().split(/\W+/).filter(w => w.length > 2);
  if (allWords.length === 0) return 0;
  const unique = new Set(allWords).size;
  return unique / allWords.length;
}

function repetitionPenalty(texts: string[]): number {
  // Penalise books that reuse the same adjectives / phrases heavily.
  const allWords = texts.join(' ').toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const counts = new Map<string, number>();
  for (const w of allWords) counts.set(w, (counts.get(w) ?? 0) + 1);
  let overused = 0;
  for (const [, c] of counts) {
    if (c > 3) overused += c - 3;
  }
  const penalty = (overused / Math.max(allWords.length, 1)) * 100;
  return clamp(100 - penalty * 3);
}

function hasEducationalSignals(scenes: GeneratedScene[]): boolean {
  return scenes.some(s =>
    s.learning_points.length > 0 ||
    s.quiz_questions.length > 0 ||
    /lesson|learn|teach|moral|wisdom|virtue|knowledge|discovery/i.test(s.narration),
  );
}

function safetyCheck(scenes: GeneratedScene[]): { score: number; issues: string[] } {
  const issues: string[] = [];
  let penalty = 0;

  for (const s of scenes) {
    const text = s.narration + ' ' + s.short_summary;
    if (/\b(kill|murder|blood|gore|torture|suicide)\b/i.test(text)) {
      penalty += 15;
      issues.push(`Scene "${s.title}" contains graphic/violent language.`);
    }
    if (/\b(sex|nude|naked|erotic|pornograph)\b/i.test(text)) {
      penalty += 30;
      issues.push(`Scene "${s.title}" contains sexual content.`);
    }
    if (/\b(hate\s+speech|racial\s+slur|bigot)\b/i.test(text)) {
      penalty += 30;
      issues.push(`Scene "${s.title}" contains hate speech indicators.`);
    }
    if (/\b(drug|cocaine|heroin|meth)\b/i.test(text)) {
      penalty += 10;
      issues.push(`Scene "${s.title}" references hard drugs.`);
    }
  }

  return { score: clamp(100 - penalty), issues };
}

function endingQuality(scenes: GeneratedScene[]): number {
  if (scenes.length === 0) return 0;
  const last = scenes[scenes.length - 1];
  const text = last.narration.toLowerCase();
  let score = 70;

  // Strong ending signals
  if (/return|home|peace|joy|lesson|wisdom|hope|forever|remember/i.test(text)) score += 10;
  if (/and then|next day|suddenly|after that/i.test(text)) score -= 15; // abrupt continuation
  if (last.quiz_questions.length > 0) score += 5;
  if (last.learning_points.length > 0) score += 5;

  return clamp(score);
}

function movieReadiness(scenes: GeneratedScene[]): number {
  let score = 80;
  for (const s of scenes) {
    if (!s.background_asset_url) score -= 8;
    if (!s.mood) score -= 3;
    if (wordCount(s.narration) < 30) score -= 5;
  }
  return clamp(score);
}

function characterConsistency(characters: GeneratedCharacter[]): number {
  if (characters.length === 0) return 50;
  let score = 80;
  for (const c of characters) {
    if (!c.appearance || c.appearance.length < 20) score -= 10;
    if (!c.traits || c.traits.length === 0) score -= 5;
    if (!c.speech_tone || c.speech_tone.length < 3) score -= 5;
  }
  return clamp(score);
}

function sceneContinuity(scenes: GeneratedScene[]): number {
  if (scenes.length < 2) return 70;
  let score = 85;
  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1];
    const curr = scenes[i];
    if (curr.previous_scene_id !== prev.scene_id) score -= 5;
    if (curr.order_index !== prev.order_index + 1) score -= 5;
  }
  return clamp(score);
}

function visualPromptQuality(scenes: GeneratedScene[]): number {
  let score = 80;
  for (const s of scenes) {
    const desc = s.visual_description || '';
    if (wordCount(desc) < 15) score -= 10;
    if (!/light|colour|color|sky|ground|weather|atmosphere|mood|texture/i.test(desc)) score -= 5;
  }
  return clamp(score);
}

function interactionRichness(scenes: GeneratedScene[]): number {
  let score = 70;
  let totalHotspots = 0;
  for (const s of scenes) {
    totalHotspots += s.hotspots?.length ?? 0;
  }
  const avgHotspots = totalHotspots / Math.max(scenes.length, 1);
  if (avgHotspots >= 3) score += 20;
  else if (avgHotspots >= 2) score += 10;
  else if (avgHotspots < 1) score -= 20;

  const quizCount = scenes.reduce((sum, s) => sum + (s.quiz_questions?.length ?? 0), 0);
  if (quizCount >= scenes.length) score += 5;

  return clamp(score);
}

function culturalFit(title: string, scenes: GeneratedScene[]): number {
  // Simple check: does the narration match the title's cultural signals?
  const lowerTitle = title.toLowerCase();
  let expectedRegion: string | null = null;
  if (/ramayana|mahabharata|krishna|shiva|hanuman|ravana|akbar|birbal|vikram|betaal|panchatantra|jataka/.test(lowerTitle)) expectedRegion = 'indian';
  if (/iliad|odyssey|trojan|achilles|hercules|zeus|olympus/.test(lowerTitle)) expectedRegion = 'greek';
  if (/norse|odin|thor|valhalla/.test(lowerTitle)) expectedRegion = 'norse';
  if (/star wars|sci-fi|space|robot|alien|future/.test(lowerTitle)) expectedRegion = 'sci-fi';

  if (!expectedRegion) return 75; // no strong expectation

  let mismatch = 0;
  for (const s of scenes) {
    const text = s.narration.toLowerCase();
    if (expectedRegion === 'indian' && /sword|castle|knight|viking|samurai|spaceship|laser/.test(text)) mismatch++;
    if (expectedRegion === 'greek' && /sari|turban|palace|mughal|spaceship|laser/.test(text)) mismatch++;
    if (expectedRegion === 'norse' && /sari|turban|palace|spaceship|laser/.test(text)) mismatch++;
    if (expectedRegion === 'sci-fi' && /sari|turban|palace|sword|castle|knight/.test(text)) mismatch++;
  }

  return clamp(100 - mismatch * 8);
}

function ageFit(scenes: GeneratedScene[], title: string): number {
  let score = 80;
  for (const s of scenes) {
    const text = s.narration;
    const wc = wordCount(text);
    if (wc > 300) score -= 5; // too long for young readers
    if (wc < 40) score -= 5; // too short
    if (/\b(kill|murder|death|blood|torture|suicide)\b/i.test(text)) score -= 15;
  }
  if (/kids|children|nursery|bedtime|fable|grade [1-5]/.test(title.toLowerCase())) {
    // Stricter expectations for children's books
    if (scenes.some(s => /\b(kill|murder|death)\b/i.test(s.narration))) score -= 20;
  }
  return clamp(score);
}

function coherence(scenes: GeneratedScene[]): number {
  if (scenes.length === 0) return 0;
  const narrations = scenes.map(s => s.narration);
  const diversity = lexicalDiversity(narrations);
  let score = 70 + diversity * 30;

  // Penalise if every scene is the same length (robotic uniformity)
  const lengths = scenes.map(s => wordCount(s.narration));
  const avgLen = avg(...lengths);
  const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avgLen, 2), 0) / lengths.length;
  if (variance < 50) score -= 10;

  return clamp(score);
}

function originality(title: string, scenes: GeneratedScene[]): number {
  const narrations = scenes.map(s => s.narration);
  const diversity = lexicalDiversity(narrations);
  let score = 60 + diversity * 40;

  // Penalise generic openings
  const firstScene = scenes[0]?.narration.toLowerCase() ?? '';
  if (/once upon a time|long ago|in a land far away/.test(firstScene)) score -= 5;

  // Penalise if title is extremely common and scenes are thin
  if (scenes.length < 6) score -= 10;

  return clamp(score);
}

// ── Main API ───────────────────────────────────────────────

export function scoreBook(book: GeneratedBook): QualityReport {
  const scenes = book.scenes ?? [];
  const characters = book.characters ?? [];

  const safetyResult = safetyCheck(scenes);

  const dims: Record<QualityDimension, DimensionScore> = {
    coherence: {
      name: 'coherence',
      score: coherence(scenes),
      weight: WEIGHTS.coherence,
      comment: 'How well the scenes form a unified narrative arc.',
    },
    originality: {
      name: 'originality',
      score: originality(book.title, scenes),
      weight: WEIGHTS.originality,
      comment: 'How fresh and non-generic the storytelling feels.',
    },
    ageFit: {
      name: 'ageFit',
      score: ageFit(scenes, book.title),
      weight: WEIGHTS.ageFit,
      comment: 'Whether vocabulary and content match the intended age group.',
    },
    culturalFit: {
      name: 'culturalFit',
      score: culturalFit(book.title, scenes),
      weight: WEIGHTS.culturalFit,
      comment: 'Whether visual and narrative details match the title\'s cultural context.',
    },
    characterConsistency: {
      name: 'characterConsistency',
      score: characterConsistency(characters),
      weight: WEIGHTS.characterConsistency,
      comment: 'Whether characters have stable appearances, traits, and voices.',
    },
    sceneContinuity: {
      name: 'sceneContinuity',
      score: sceneContinuity(scenes),
      weight: WEIGHTS.sceneContinuity,
      comment: 'Whether scene ordering and previous/next links are coherent.',
    },
    visualPromptQuality: {
      name: 'visualPromptQuality',
      score: visualPromptQuality(scenes),
      weight: WEIGHTS.visualPromptQuality,
      comment: 'Whether visual descriptions are vivid enough for image generation.',
    },
    interactionRichness: {
      name: 'interactionRichness',
      score: interactionRichness(scenes),
      weight: WEIGHTS.interactionRichness,
      comment: 'Density of clickable hotspots, quizzes, and learning content.',
    },
    educationalValue: {
      name: 'educationalValue',
      score: hasEducationalSignals(scenes) ? 80 : 40,
      weight: WEIGHTS.educationalValue,
      comment: 'Presence of learning points, quizzes, and moral takeaways.',
    },
    safety: {
      name: 'safety',
      score: safetyResult.score,
      weight: WEIGHTS.safety,
      comment: 'Absence of graphic violence, sexual content, hate speech, and unsafe material.',
    },
    repetition: {
      name: 'repetition',
      score: repetitionPenalty(scenes.map(s => s.narration)),
      weight: WEIGHTS.repetition,
      comment: 'How much the text reuses the same words and phrases across scenes.',
    },
    endingQuality: {
      name: 'endingQuality',
      score: endingQuality(scenes),
      weight: WEIGHTS.endingQuality,
      comment: 'Whether the final scene provides resolution, lesson, or closure.',
    },
    movieReadiness: {
      name: 'movieReadiness',
      score: movieReadiness(scenes),
      weight: WEIGHTS.movieReadiness,
      comment: 'Whether every scene has images, mood tags, and narration of playable length.',
    },
  };

  // Weighted total
  let weightedSum = 0;
  let totalWeight = 0;
  for (const d of Object.values(dims)) {
    weightedSum += d.score * d.weight;
    totalWeight += d.weight;
  }
  const totalScore = clamp(weightedSum / totalWeight);

  // Warnings
  const warnings: string[] = [];
  if (dims.coherence.score < 50) warnings.push('Narrative coherence is weak — scenes may feel disjointed.');
  if (dims.culturalFit.score < 50) warnings.push('Cultural details may not match the title — verify visual accuracy.');
  if (dims.characterConsistency.score < 50) warnings.push('Character descriptions are thin — faces may drift between scenes.');
  if (dims.visualPromptQuality.score < 50) warnings.push('Visual descriptions are too vague — images may be generic.');
  if (dims.repetition.score < 50) warnings.push('Text is highly repetitive across scenes.');
  if (dims.endingQuality.score < 50) warnings.push('Ending feels abrupt or unresolved.');
  if (safetyResult.issues.length > 0) {
    warnings.push('Safety issues detected: ' + safetyResult.issues.join('; '));
  }

  // Regeneration suggestions
  const regenerationSuggestions: string[] = [];
  if (dims.coherence.score < 60) regenerationSuggestions.push('Regenerate with a stronger narrative arc prompt.');
  if (dims.culturalFit.score < 60) regenerationSuggestions.push('Add canon grounding or verify the title spelling.');
  if (dims.characterConsistency.score < 60) regenerationSuggestions.push('Strengthen character appearance descriptions in the outline.');
  if (dims.visualPromptQuality.score < 60) regenerationSuggestions.push('Request more detailed visual descriptions from the outline LLM.');
  if (dims.safety.score < 60) regenerationSuggestions.push('Regenerate with stricter safety constraints.');
  if (totalScore < MIN_PASS_SCORE) regenerationSuggestions.push('Consider regenerating the entire book with a refined title or style preset.');

  const isSafeToShow =
    totalScore >= MIN_PASS_SCORE &&
    dims.safety.score >= 70 &&
    dims.coherence.score >= 40;

  return {
    totalScore,
    maxPossible: MAX_POSSIBLE,
    perCategory: dims,
    warnings,
    regenerationSuggestions,
    isSafeToShow,
    passThreshold: MIN_PASS_SCORE,
  };
}

/**
 * Quick check: is this book safe to persist and show?
 * Useful for short-circuiting before a full report is needed.
 */
export function isBookSafe(book: GeneratedBook): boolean {
  return scoreBook(book).isSafeToShow;
}
