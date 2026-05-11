// ============================================================
// Anonymous → authenticated book claiming.
//
// On sign-in completion, walk every Redis book whose ownerId matches
// the caller's legacy anonymous cookie and rewrite ownerId to the
// new userId. The cookie sent on the auth/callback request IS the
// proof of ownership — only the browser holding that cookie could
// have generated those books.
//
// Idempotent: re-running with no anonymous books is a no-op.
// ============================================================

import { getRedis } from '@/lib/redis';
import type { GeneratedBook } from '@/lib/openai/bookGeneratorAgent';

export interface ClaimResult {
  scanned: number;
  claimed: number;
}

/**
 * Migrate every Redis-stored book where ownerId === legacyOwnerId
 * over to userId. Skips books with no ownerId or a different one
 * (no false-positive claims).
 */
export async function claimAnonymousBooks(
  legacyOwnerId: string | null,
  userId: string,
): Promise<ClaimResult> {
  const out: ClaimResult = { scanned: 0, claimed: 0 };
  if (!legacyOwnerId || !userId || legacyOwnerId === userId) return out;

  const r = getRedis();
  if (!r) return out;

  const keys = await r.keys('kk:book:*');
  for (const key of keys) {
    out.scanned++;
    try {
      const book = await r.get<GeneratedBook>(key);
      if (!book) continue;
      if (book.ownerId !== legacyOwnerId) continue;
      const updated: GeneratedBook = {
        ...book,
        ownerId: userId,
        updatedAt: Date.now(),
      };
      await r.set(key, updated, { ex: 60 * 60 * 24 * 30 });
      out.claimed++;
    } catch {
      // Skip malformed entries — they'll be cleaned up by TTL.
    }
  }
  return out;
}
