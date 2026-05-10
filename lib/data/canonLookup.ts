// ============================================================
// KathaKitaab.ai — Universal Canon Lookup
//
// A book-agnostic registry of canonical entries for entities
// (characters, objects, places, events). Two sources:
//
//   1. Static canon JSON at lib/data/canon/{slug}.json — for the
//      hand-curated showcase books (Ramayana, Mahabharata, Panchatantra).
//   2. Runtime canon registered by the book generator — every
//      AI-generated book pushes its characters here so they get the
//      same appearance-injection + anchor-locking the static books do.
//
// Used by entity-interact and ask-character to inject verified
// source material into LLM prompts, and by visualPromptBuilder /
// visualAgent to lock character faces across scenes.
// ============================================================

import type { CanonEntry, CanonFile } from '@/lib/types/canon';

// Static imports so canon ships in the bundle (no runtime fetch).
// Add a new book here and create the JSON file beside it.
import ramayanaCanon from './canon/ramayana.json';
import mahabharataCanon from './canon/mahabharata.json';
import panchatantraCanon from './canon/panchatantra.json';

const STATIC_CANON: Record<string, CanonFile> = {
  ramayana: ramayanaCanon as CanonFile,
  mahabharata: mahabharataCanon as CanonFile,
  panchatantra: panchatantraCanon as CanonFile,
};

// Combined lookup index: bookSlug -> Map<normalizedKey, CanonEntry>.
// Built from STATIC_CANON at module load and extended by
// registerRuntimeCanon() each time an AI-generated book is read or
// generated. Runtime entries shadow static ones with the same key
// for the same slug (a book that ships its own canon overrides the
// static fallback if the slugs collide — they shouldn't in practice).
const INDEX: Record<string, Map<string, CanonEntry>> = {};
// Per-book runtime metadata (style + book_title + source). Lets the
// prompt builder fetch a per-AI-book style preset without forcing
// every caller to thread a style argument through.
const RUNTIME_META: Record<string, CanonFile['meta']> = {};

// Seed the index from the static JSON canon at module load.
for (const [slug, file] of Object.entries(STATIC_CANON)) {
  INDEX[slug] = entriesToMap(file.entries);
}

function entriesToMap(entries: CanonEntry[]): Map<string, CanonEntry> {
  const m = new Map<string, CanonEntry>();
  for (const entry of entries) {
    m.set(normalize(entry.id), entry);
    m.set(normalize(entry.label), entry);
    for (const alias of entry.aliases ?? []) {
      m.set(normalize(alias), entry);
    }
  }
  return m;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Register or update a book's canon at runtime. Idempotent — call as
 * many times as you like with the same slug to overwrite previous
 * entries (e.g., when re-loading a book after its anchor portraits
 * have been baked and the URLs are now filled in).
 *
 * Used by bookRegistry.getBook() after pulling an AI-generated book
 * from Redis, and by bookGeneratorAgent during book creation, so
 * every code path that needs canon (visualPromptBuilder, entity-
 * interact, ask-character) sees a uniform view regardless of whether
 * the book is static or generated.
 */
export function registerRuntimeCanon(
  slug: string,
  entries: CanonEntry[],
  meta?: CanonFile['meta'],
): void {
  if (!slug) return;
  // Don't blow away a static canon file by registering an empty
  // generated canon for the same slug.
  if (entries.length === 0 && INDEX[slug]) return;
  // Static entries stay; runtime entries layer on top so a static
  // canon (Ramayana) is not erased by registering its book record.
  const existing = INDEX[slug] ?? new Map<string, CanonEntry>();
  const merged = new Map(existing);
  for (const entry of entries) {
    merged.set(normalize(entry.id), entry);
    merged.set(normalize(entry.label), entry);
    for (const alias of entry.aliases ?? []) {
      merged.set(normalize(alias), entry);
    }
  }
  INDEX[slug] = merged;
  if (meta) RUNTIME_META[slug] = meta;
}

/**
 * Look up a canonical entry for the given book and entity.
 * Returns null if the book has no canon file or the entity is
 * not in canon. The caller should fall back to research grounding.
 */
export function getCanonEntry(bookSlug: string, idOrLabel: string): CanonEntry | null {
  const idx = INDEX[bookSlug];
  if (!idx) return null;
  const key = normalize(idOrLabel);
  return idx.get(key) ?? null;
}

/**
 * Return the book-level canon metadata (book title, source,
 * top-level forbidden patterns) for a given slug. Useful for
 * adding a "Source: Valmiki Ramayana (public domain)" footer
 * to any prompt.
 */
export function getCanonBookMeta(bookSlug: string): CanonFile['meta'] | null {
  // Runtime meta (AI-generated books) wins so per-book style presets
  // override the static-canon default when both exist for the same slug.
  return RUNTIME_META[bookSlug] ?? STATIC_CANON[bookSlug]?.meta ?? null;
}

/**
 * Build a compact prompt fragment to inject canon context into
 * an LLM system prompt. Returns empty string if the entity is
 * not in canon — caller should NOT inject anything in that case.
 */
export function buildCanonPromptFragment(bookSlug: string, idOrLabel: string): string {
  const entry = getCanonEntry(bookSlug, idOrLabel);
  if (!entry) return '';

  const meta = getCanonBookMeta(bookSlug);
  const lines: string[] = [];
  lines.push('CANONICAL SOURCE — use as the primary, authoritative reference. Do not contradict.');
  if (meta) lines.push(`Source: ${meta.source}`);
  lines.push('');
  lines.push(`Entry: ${entry.label}${entry.aliases?.length ? ` (a.k.a. ${entry.aliases.join(', ')})` : ''}`);
  if (entry.kind) lines.push(`Type: ${entry.kind}`);
  if (entry.kanda) lines.push(`Section: ${entry.kanda}`);
  lines.push(`Summary: ${entry.summary}`);

  if (entry.forbidden_changes?.length) {
    lines.push('');
    lines.push('FORBIDDEN CHANGES (must not violate):');
    for (const f of entry.forbidden_changes) lines.push(`- ${f}`);
  }
  if (entry.source_note) {
    lines.push('');
    lines.push(`Note: ${entry.source_note}`);
  }

  return lines.join('\n');
}

/**
 * Return all entry IDs known for a book. Useful for debugging or
 * for filtering generated entities to canonically-known ones.
 */
export function listCanonIds(bookSlug: string): string[] {
  const idx = INDEX[bookSlug];
  if (!idx) return [];
  // The same entry is registered under multiple keys (id, label,
  // aliases); dedupe via the canonical id field.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of idx.values()) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      out.push(entry.id);
    }
  }
  return out;
}

/**
 * Return the list of book slugs that have any canon registered —
 * static JSON-shipped or runtime-registered. The UI can show a
 * "verified canon" badge on the book card for these.
 */
export function listCanonBooks(): string[] {
  return Object.keys(INDEX);
}
