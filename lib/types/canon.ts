// ============================================================
// KathaKitaab — Canon Registry Types
//
// Universal contract for per-book canon JSON files. Every
// supported book lives at lib/data/canon/{slug}.json and conforms
// to the CanonFile shape below. Books without a canon file
// gracefully degrade to research-only grounding.
// ============================================================

export type CanonEntryKind =
  | 'character'
  | 'object'
  | 'place'
  | 'event'
  | 'concept';

export interface CanonEntry {
  /** Stable slug — lowercase, snake_case. Matches entity IDs in scenes. */
  id: string;
  /** Human-readable display name. */
  label: string;
  /** Alternate names / spellings the LLM or user might use. */
  aliases?: string[];
  /** What category this entry belongs to. */
  kind: CanonEntryKind;
  /**
   * Optional book section reference (e.g., 'Bala Kanda', 'Sabha Parva',
   * 'Tantra 1'). Helps the LLM cite source-accurate context.
   */
  kanda?: string;
  /**
   * 3–6 sentences of canonical fact-set. This is what gets injected
   * into LLM prompts, so it must be tight, accurate, and free of
   * editorializing.
   */
  summary: string;
  /**
   * Negative constraints — things the LLM must never do with this
   * entry (e.g., "Do not portray Rama as cruel"). These get injected
   * as hard rules into prompts.
   */
  forbidden_changes?: string[];
  /** Specific source citation (verse, chapter, edition). */
  source_note?: string;
  /**
   * Locked visual identity for image generation. Detailed enough to
   * keep faces/bodies recognisable across scenes (skin tone, hair,
   * eyes, age, build, signature items, clothing palette). Injected
   * automatically into every image prompt that mentions this entry.
   * Characters need this; objects/places usually don't.
   */
  appearance?: string;
  /**
   * Visual things this entry must never display (wrong colors, wrong
   * weapons, wrong era). Becomes the negative side of the prompt.
   */
  negative_appearance?: string[];
  /**
   * Role-locked action menu. When the user clicks this entity in a
   * scene, only these actions are offered — Rama gets `talk/move/
   * continue`, Hanuman gets `talk/leap/fight/continue`, Ravana gets
   * `confront/observe/continue`, etc. Empty/missing → falls back to a
   * generic default in the UI.
   */
  allowed_actions?: string[];
  /**
   * Public CDN URL of a pre-baked canonical portrait. Generated once
   * by `scripts/prebake-portraits.ts` and stored in S3 (served via
   * CloudFront), then referenced as the anchor image for `images.edit`
   * calls so faces stay locked across scenes (especially deities).
   */
  anchor_image_url?: string;
  /**
   * Marks deity / sacred figures whose appearance must be especially
   * guarded — these get routed to anchor-portrait-based generation
   * (images.edit) when present alone in a scene, instead of free
   * text-to-image. Avoids the "Rama looks different every time" drift.
   */
  divine?: boolean;
}

/** Per-book visual style bible. Locks palette/medium/framing so every
 * scene in the same book feels like it came from the same illustrator.
 * Tone differs by book: Ramayana = devotional epic, Mahabharata = war
 * epic, Panchatantra = whimsical storybook. */
export interface CanonStyle {
  /** One-line creative direction ("epic devotional Indian animation"). */
  tagline: string;
  /** Concrete colour palette — names or hexes the model can lock onto. */
  palette: string;
  /** Medium / rendering technique ("hand-painted 2D animation cel"). */
  medium: string;
  /** Framing rules ("cinematic 3:2 wide, slight low-angle hero shots"). */
  framing: string;
  /** Period and culture cues ("ancient Vedic India, no modern objects"). */
  era: string;
  /** Things that should never appear in this book's images. */
  never_show?: string[];
}

export interface CanonFile {
  meta: {
    book_slug: string;
    book_title: string;
    /** Top-level source attribution, e.g., 'Valmiki Ramayana (public domain)'. */
    source: string;
    /** Genre tag for the music orchestrator and other systems. */
    genre?: string;
    /** Per-book visual style bible — locks the illustrator's hand. */
    style?: CanonStyle;
  };
  entries: CanonEntry[];
}
