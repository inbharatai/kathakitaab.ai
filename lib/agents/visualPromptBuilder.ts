// ============================================================
// KathaKitaab.ai — Visual Prompt Builder
//
// Turns a raw scene description into a fully-locked image prompt:
//   1. Scans the description for canonical character names + aliases.
//   2. Auto-injects each character's locked appearance.
//   3. Layers per-book style bible (palette, medium, framing, era).
//   4. Adds mood-aware lighting.
//   5. Builds an explicit negative prompt.
//
// The whole point: keep Rama looking like the same Rama in every
// scene, every book, every branch. Universal — works for any book
// that has a canon file with appearance fields.
// ============================================================

import { listCanonIds, getCanonEntry, getCanonBookMeta } from '@/lib/data/canonLookup';
import type { CanonEntry, CanonStyle } from '@/lib/types/canon';

const MOOD_LIGHTING: Record<string, string> = {
  serene: 'Soft golden sunrise light, peaceful warm shadows, gentle aerial haze.',
  tense: 'Dramatic side-lit shadows, deep amber and storm-bruise sky, low-angle composition.',
  joyful: 'Bright clear sunlight, vibrant saturated colours, fluttering banners or petals.',
  mysterious: 'Misty blue-purple twilight, soft volumetric god-rays, half-seen silhouettes.',
  dramatic: 'Bold chiaroscuro, fiery rim-light, dynamic diagonal composition.',
  sacred: 'Divine golden light rays, celestial glow, faint background mandala or temple silhouette.',
  melancholy: 'Soft grey-blue hour, gentle drizzle or mist, muted warm interior tones.',
  triumphant: 'Sweeping golden hour, banners catching the light, low hero-shot.',
  fearful: 'Long shadows, low-key cyan-blue cast, tight close-up framing.',
};

// Theme axis — narrative motif. Modulates the *feel* of the image
// independently of mood (which is mostly lighting). A duty-themed
// scene should look weighty and resolute even if its mood is joyful;
// a devotion-themed scene should look intimate even if its mood is
// dramatic. Keep these short — they stack on top of mood, not replace
// it. The map mixes universal themes (courage, love, betrayal, hope…)
// with culture-specific aliases (dharma → duty, bhakti → devotion) so
// any book — Ramayana, Iliad, Aesop — can pick the closest motif.
const THEME_GUIDANCE: Record<string, string> = {
  // Universal — work for any tradition.
  duty: 'Compositional weight on moral duty — upright postures, frontal hero placement, balanced symmetrical staging, clean horizon line.',
  courage: 'Forward-leaning silhouettes, open chest poses, weapons or tools in hand, elevated camera angle looking up at the protagonist.',
  sacrifice: 'Solitary figure framed against a wide empty backdrop, palms open or laid down, muted saturation, downcast eyes.',
  devotion: 'Intimate close framing, soft gaze upward or toward the beloved/divine, joined palms or reaching hands, warm low light, candles or garlands.',
  loss: 'Figures half-turned away from each other, foreground emptiness, drifting petals or rain, desaturated periphery, single warm focal point.',
  love: 'Two figures sharing a small private space, soft eye-contact, gentle warm rim-light, blossoms or fluttering cloth in the foreground.',
  betrayal: 'Off-balance composition, one figure in shadow looking back at another in light, cold-warm split palette, broken or tilted symmetry.',
  hope: 'Figure looking toward a brightening horizon or rising sun, low-angle composition, distant warm light breaking through clouds.',
  wonder: 'Wide awe-struck framing, small figure beneath a vast luminous sky or interior, dust motes / fireflies / particles catching light.',
  fear: 'Tight cropped framing, predator silhouette in negative space, cold cyan-violet shadows, single small protected light source.',
  redemption: 'Kneeling or rising figure bathed in directional light from above, dropped weapon at the feet, soft pastel halo, opening clouds.',
  // Culture-specific aliases — map to the closest universal motif so
  // a book can ship its native vocabulary without us hard-coding every
  // tradition's nuance.
  dharma: 'Compositional weight on dharmic duty — upright postures, frontal hero placement, balanced symmetrical staging, clean horizon line.',
  bhakti: 'Intimate devotional close framing, soft gaze upward toward the divine, joined palms, garlands and lamps, warm low light.',
  karma: 'Cause-and-effect staging — past action visible in the background, present consequence framed in the foreground, soft motion-blur connecting them.',
  hubris: 'Figure raised too high — towering pose, looking down, cracked or tilting ground beneath, crown or weapon catching too much light.',
};

export interface BuildVisualPromptInput {
  /** The LLM's raw scene description ("Rama and Sita walk through the forest..."). */
  description: string;
  /** Book slug — used to pull style bible + canon. Optional; empty falls back to generic style. */
  bookSlug?: string;
  /** Mood tag from the scene metadata. */
  mood?: string;
  /**
   * Narrative theme — independent of mood. Modulates composition and
   * tone (dharma vs courage vs sacrifice vs bhakti vs loss). Optional;
   * empty string skips theme guidance entirely.
   */
  theme?: string;
  /** Characters explicitly known to be in the scene (from scene metadata).
   *  These are always injected even if the description doesn't name them. */
  characters?: string[];
  /** Hard limit on injected appearance text per character (chars). Default 600.
   * Big enough to carry skin/hair/clothing/signature-items details for the
   * average canonical character. The whole prompt still fits well inside
   * gpt-image-1's 4000-char budget even with five characters injected. */
  appearanceClampPerChar?: number;
}

export interface BuiltVisualPrompt {
  /** The final positive prompt to send to gpt-image-1. */
  prompt: string;
  /** Negative prompt — what must NOT appear. gpt-image-1 doesn't take a separate
   *  negative_prompt param, so the builder embeds it as "Avoid: ..." in the prompt. */
  negative: string;
  /** Diagnostics — which canonical characters got injected. Useful for admin UI. */
  charactersInjected: string[];
  /** Whether a per-book style bible was applied. */
  styleApplied: boolean;
}

/**
 * Build a fully-locked image prompt for the given scene description.
 * Pure function — safe to unit-test, no I/O.
 */
export function buildVisualPrompt(input: BuildVisualPromptInput): BuiltVisualPrompt {
  const { description, bookSlug, mood = 'serene', theme } = input;
  const clamp = input.appearanceClampPerChar ?? 600;

  const detected = detectCharacters(description, bookSlug, input.characters ?? []);
  const characterAppearance = detected
    .map(e => `${e.label}: ${truncate(e.appearance!, clamp)}`)
    .join(' | ');

  const characterNegatives = detected
    .flatMap(e => e.negative_appearance ?? []);

  const meta = bookSlug ? getCanonBookMeta(bookSlug) : null;
  const style = meta?.style;

  const moodLine = MOOD_LIGHTING[mood] || MOOD_LIGHTING.serene;

  // Positive prompt — assembled in the order that matters most to
  // gpt-image-1: scene action, then character locks, then style, then
  // mood, then framing.
  const positiveParts: string[] = [];
  positiveParts.push(`Scene: ${description.trim()}`);

  if (characterAppearance) {
    positiveParts.push(`Character identity (must remain consistent): ${characterAppearance}`);
  }

  if (style) {
    positiveParts.push(buildStyleClause(style));
  } else {
    // Universal default — photorealistic cinematic Bollywood-mythology
    // film still. Real actors, ornate period costume, dramatic lighting,
    // anamorphic widescreen composition. This applies to any book that
    // doesn't ship its own canon style override.
    positiveParts.push(
      'Style: photorealistic cinematic still from a high-budget Bollywood mythological epic film — real actors in ornate ancient Vedic-era costume, authentic period setting, dramatic golden-hour lighting, rich saturated color grading, shallow depth of field, subtle film grain, anamorphic widescreen composition, hyper-detailed painterly realism. NOT cartoon, NOT anime, NOT flat illustration.',
    );
  }

  positiveParts.push(`Lighting and mood: ${moodLine}`);

  // Theme stacks on top of mood — its job is composition + emotional
  // motif, not lighting. Skip silently when the theme isn't recognised
  // so callers can pass an arbitrary string without breaking prompts.
  if (theme) {
    const themeLine = THEME_GUIDANCE[theme.toLowerCase()];
    if (themeLine) positiveParts.push(`Theme (${theme}): ${themeLine}`);
  }

  if (style?.framing) {
    positiveParts.push(`Composition: ${style.framing}`);
  }

  // Negative prompt — bundle book-level "never_show" + per-character
  // negatives. gpt-image-1 ignores a literal "negative_prompt" field,
  // so we end the prompt with an explicit Avoid clause.
  const negativeParts: string[] = [];
  if (style?.never_show?.length) {
    negativeParts.push(...style.never_show);
  }
  if (characterNegatives.length) {
    negativeParts.push(...characterNegatives);
  }
  negativeParts.push(
    'No text, captions, watermarks, signatures, or modern objects.',
    'No cartoon style, no anime, no flat illustration — this is a photorealistic film still.',
  );

  const negative = negativeParts.join(' ');
  const prompt = `${positiveParts.join('\n\n')}\n\nAvoid: ${negative}`;

  return {
    prompt,
    negative,
    charactersInjected: detected.map(e => e.id),
    styleApplied: !!style,
  };
}

// ── Helpers ──

/**
 * Find canonical characters mentioned in the description (or supplied
 * directly via `extra`). Looks up by id, label, and aliases.
 */
function detectCharacters(
  description: string,
  bookSlug: string | undefined,
  extra: string[],
): CanonEntry[] {
  if (!bookSlug) return [];

  const ids = listCanonIds(bookSlug);
  if (ids.length === 0) return [];

  const lower = description.toLowerCase();
  const found = new Map<string, CanonEntry>();

  // Pass 1: explicit charactersPresent[] supplied by the caller.
  for (const name of extra) {
    const e = getCanonEntry(bookSlug, name);
    if (e?.kind === 'character' && e.appearance) found.set(e.id, e);
  }

  // Pass 2: scan description text for canonical names + aliases.
  // Matches with word-boundaries so "ram" doesn't match "rampart".
  for (const id of ids) {
    if (found.has(id)) continue;
    const entry = getCanonEntry(bookSlug, id);
    if (!entry || entry.kind !== 'character' || !entry.appearance) continue;
    const tokens = [entry.label, ...(entry.aliases ?? [])].map(t => t.toLowerCase());
    if (tokens.some(t => matchesWord(lower, t))) {
      found.set(entry.id, entry);
    }
  }

  return Array.from(found.values());
}

function matchesWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  // Use a manual scan — easier than building a fresh regex per call,
  // and safe against special characters in aliases.
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return false;
    const before = idx === 0 ? ' ' : haystack[idx - 1];
    const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = idx + 1;
  }
  return false;
}

function isWordChar(ch: string): boolean {
  return /[a-z0-9]/i.test(ch);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

function buildStyleClause(style: CanonStyle): string {
  const parts = [
    `Style: ${style.tagline}`,
    `Palette: ${style.palette}`,
    `Medium: ${style.medium}`,
    `Era: ${style.era}`,
  ];
  return parts.join(' ');
}
