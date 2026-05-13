// ============================================================
// lib/data/bookStyle.ts
//
// One-line lookup: given a book slug, return its stylePreset (or
// undefined when unknown / seed). Used by every route that
// generates an image on the fly — generate-image, generate-scene,
// entity-interact — so a comic-book reader who clicks a hotspot
// gets a comic-style branch panel, not a photoreal one.
//
// Universal — same helper for every preset. Adding a 5th preset
// later requires no change here. The lookup is async because
// getBook() is async (Redis-backed); callers must await.
// ============================================================

import { getBook } from './bookRegistry';
import type { StylePreset } from '@/lib/types/style';

/**
 * Resolve the style preset for a book slug. Returns:
 *   - The book's stylePreset when set
 *   - undefined when the book isn't in the registry (seed books
 *     like ramayana, or unknown slugs)
 *
 * Callers should pass the return value straight to generateSceneImage
 * or generateCharacterPortrait — both accept `stylePreset?: StylePreset`
 * and fall through to the universal default when undefined.
 */
export async function getBookStylePreset(slug: string | undefined): Promise<StylePreset | undefined> {
  if (!slug) return undefined;
  const book = await getBook(slug);
  return book?.stylePreset;
}
