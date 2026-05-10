// ============================================================
// KathaKitaab.ai — Visual style presets
//
// A book is "locked" to one preset at generation time. The choice
// drives the prompt builder's style clause for every scene image
// and anchor portrait, so all 30 illustrations in a book look like
// they came from the same hand.
//
// Style and accuracy are decoupled: regardless of preset, scene
// images still receive the per-character appearance specs and use
// anchor portraits for face locking. Only the rendering aesthetic
// differs.
// ============================================================

export type StylePreset =
  | 'photoreal_cinematic'
  | 'storybook_watercolor'
  | 'cinematic_animation';

export interface StylePresetMeta {
  /** UI label shown to the user when choosing a preset. */
  label: string;
  /** One-sentence description shown beneath the label. */
  description: string;
  /** The style clause spliced into the image prompt — placed where
   *  the per-book canon style would otherwise go. Should mention
   *  medium, framing register, and any anti-style guards. */
  promptClause: string;
  /** Phrases that must NOT appear in the image. Joined into the
   *  prompt's `Avoid:` clause to keep the preset honest under
   *  ambiguous scene descriptions. */
  negative: string[];
}

export const STYLE_PRESETS: Record<StylePreset, StylePresetMeta> = {
  photoreal_cinematic: {
    label: 'Photoreal cinematic',
    description:
      'Bollywood-mythology film still. Real actors in ornate period costume, dramatic lighting. Best for epics like Ramayana, Mahabharata, historical drama.',
    promptClause:
      'Style: photorealistic cinematic still from a high-budget Bollywood mythological epic film — real actors in ornate ancient costume, authentic period setting, dramatic golden-hour lighting, rich saturated color grading, shallow depth of field, subtle film grain, anamorphic widescreen composition, hyper-detailed painterly realism. NOT cartoon, NOT anime, NOT flat illustration.',
    negative: ['cartoon style', 'anime', 'flat illustration', 'CGI animation feel'],
  },
  storybook_watercolor: {
    label: 'Storybook watercolour',
    description:
      'Soft watercolour and ink on cream paper, visible brush textures. Best for fables (Panchatantra, Jataka), Akbar-Birbal, children\'s stories with talking animals.',
    promptClause:
      'Style: watercolour-and-ink storybook illustration on warm cream paper. Visible brush textures, soft saturated wash, hand-drawn linework in dark sepia, characters expressive and slightly stylised, gentle pastoral or interior backgrounds. Charming, warm, story-time register. Think Anant Pai Amar Chitra Katha meets early Studio Ghibli watercolour backgrounds.',
    negative: ['photorealism', 'photographic faces', 'CGI', 'hyperrealistic detail'],
  },
  cinematic_animation: {
    label: 'Cinematic animation',
    description:
      'Pixar / Studio Ghibli middle ground. Stylised but rendered with depth and warmth. Best for biographies, adventure tales, anything where photoreal feels heavy but storybook feels too soft.',
    promptClause:
      'Style: cinematic 3D animation still — Pixar / Studio Ghibli register, stylised but volumetric, soft global illumination, warm character lighting, painterly textures, expressive character faces, depth of field. Not photoreal, not flat — the warm-rendered animation feel of a high-budget feature.',
    negative: ['photorealism', 'photographic film grain', 'flat 2D outline cartoon', 'anime cel-shading'],
  },
};

/**
 * Map a generic book genre / mode hint to a sensible default preset
 * so the UI can pre-select something the user usually wants without
 * forcing them to choose. Conservative — when in doubt, photoreal
 * cinematic (the default house style).
 */
export function defaultPresetForBook(opts: {
  title?: string;
  tradition?: string;
  isChildrenStory?: boolean;
}): StylePreset {
  if (opts.isChildrenStory) return 'storybook_watercolor';
  const t = (opts.title ?? '').toLowerCase();
  const tr = (opts.tradition ?? '').toLowerCase();
  // Fable / animal-protagonist tells default to watercolour because
  // photoreal talking animals are uncanny.
  if (/panchatantra|jataka|aesop|fable|hitopadesha/.test(t + ' ' + tr)) {
    return 'storybook_watercolor';
  }
  return 'photoreal_cinematic';
}
