/** Returns true when the caller may read a book.
 *  Public books are always readable. Private books are readable only
 *  by the owner (cookie match). For non-owners we return false —
 *  callers should turn that into a 404 so the existence of a private
 *  slug isn't disclosed. */
export function canReadBook(
  book: { visibility?: 'public' | 'private'; ownerId?: string },
  ownerId: string | null,
): boolean {
  if (!book.visibility || book.visibility === 'public') return true;
  if (!ownerId) return false;
  return book.ownerId === ownerId;
}
