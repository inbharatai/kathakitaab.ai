/** Resolve effective visibility from a book record.
 *
 *  Rules:
 *  - Explicit visibility field wins.
 *  - personalized_text, personalized_photo, classroom → private
 *    (these are child-specific or classroom-specific stories).
 *  - Everything else (world mode, legacy missing metadata) → public.
 *    Admin/founder-generated folktales and epics fall through here.
 */
export function resolveBookVisibility(
  book: { mode?: string; visibility?: 'public' | 'private' },
): 'public' | 'private' {
  if (book.visibility) return book.visibility;
  if (book.mode === 'personalized_text' || book.mode === 'personalized_photo' || book.mode === 'classroom') {
    return 'private';
  }
  return 'public';
}

/** Returns true when the caller may read a book.
 *  Public books are always readable. Private books are readable only
 *  by the owner (cookie match). For non-owners we return false —
 *  callers should turn that into a 404 so the existence of a private
 *  slug isn't disclosed. */
export function canReadBook(
  book: { visibility?: 'public' | 'private'; ownerId?: string },
  ownerId: string | null,
): boolean {
  const effective = resolveBookVisibility(book);
  if (effective === 'public') return true;
  if (!ownerId) return false;
  return book.ownerId === ownerId;
}
