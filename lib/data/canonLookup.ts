// ============================================================
// KathaKitaab.ai — Universal Canon Lookup
//
// A book-agnostic registry of canonical entries for entities
// (characters, objects, places, events). Each book has its own
// JSON file in lib/data/canon/{slug}.json. Books without a canon
// file gracefully degrade — the system returns null and the
// caller falls back to research grounding.
//
// Used by entity-interact and ask-character to inject verified
// source material into LLM prompts, dramatically reducing
// hallucination for canonical entities.
// ============================================================

import type { CanonEntry, CanonFile } from '@/lib/types/canon';

// Static imports so canon ships in the bundle (no runtime fetch).
// Add a new book here and create the JSON file beside it.
import ramayanaCanon from './canon/ramayana.json';
import mahabharataCanon from './canon/mahabharata.json';
import panchatantraCanon from './canon/panchatantra.json';

const CANON_BY_SLUG: Record<string, CanonFile> = {
  ramayana: ramayanaCanon as CanonFile,
  mahabharata: mahabharataCanon as CanonFile,
  panchatantra: panchatantraCanon as CanonFile,
};

// Pre-built lookup index: bookSlug -> Map<normalizedKey, CanonEntry>
// where normalizedKey is the lowercased id, label, or alias.
const INDEX = buildIndex();

function buildIndex(): Record<string, Map<string, CanonEntry>> {
  const out: Record<string, Map<string, CanonEntry>> = {};
  for (const [slug, file] of Object.entries(CANON_BY_SLUG)) {
    const m = new Map<string, CanonEntry>();
    for (const entry of file.entries) {
      m.set(normalize(entry.id), entry);
      m.set(normalize(entry.label), entry);
      for (const alias of entry.aliases ?? []) {
        m.set(normalize(alias), entry);
      }
    }
    out[slug] = m;
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
  return CANON_BY_SLUG[bookSlug]?.meta ?? null;
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
  const file = CANON_BY_SLUG[bookSlug];
  if (!file) return [];
  return file.entries.map(e => e.id);
}

/**
 * Return the list of book slugs that have a canon file. The UI
 * can show a "verified canon" badge on the book card for these.
 */
export function listCanonBooks(): string[] {
  return Object.keys(CANON_BY_SLUG);
}
