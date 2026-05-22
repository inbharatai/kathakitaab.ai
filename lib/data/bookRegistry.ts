// ============================================================
// KathaKitaab — Book Registry (Redis-backed)
//
// Holds AI-generated books and their in-flight generation
// progress. Redis is the source of truth so that the POST that
// starts a generation and the subsequent polling GETs land on
// the same view of the world even when Vercel routes them to
// different lambda instances. The in-process Map is a hot-path
// cache: cheap when a single lambda answers many requests in a
// row, harmless when the lambda recycles (Redis still has it).
//
// Falls back to in-process Maps when Redis isn't configured so
// local dev still works without Upstash credentials.
// ============================================================
import { GeneratedBook } from '@/lib/openai/bookGeneratorAgent';
import { getRedis } from '@/lib/redis';
import { registerRuntimeCanon } from './canonLookup';
import type { CanonEntry } from '@/lib/types/canon';

interface ProgressEntry {
  step: string;
  percent: number;
  done: boolean;
  error?: string;
}

// Built-in seed books (currently unused — Ramayana lives in ramayanaSeed.ts).
// Kept so registerSeedBook() retains its semantics for future seeds.
const SEED_BOOKS: Record<string, GeneratedBook> = {};

// Per-lambda hot cache. Reads/writes hit Redis too — see below.
const memBooks = new Map<string, GeneratedBook>();
const memProgress = new Map<string, ProgressEntry>();

const MAX_MEM_BOOKS = 500;
const MAX_MEM_PROGRESS = 500;

function capMap<K, V>(map: Map<K, V>, limit: number) {
  if (map.size <= limit) return;
  // Evict oldest 20% when over limit
  const evictCount = Math.ceil(limit * 0.2);
  let i = 0;
  for (const key of map.keys()) {
    if (i >= evictCount) break;
    map.delete(key);
    i++;
  }
}

// 365 days for the finished book — public generated books are
// meant to persist. The library listing depends on these keys
// being present; a 30-day TTL caused books to disappear from the
// listing and return 404 even though their scenes still existed.
const BOOK_TTL_SEC = 60 * 60 * 24 * 365;
// 30 minutes for in-flight progress. A stuck generation expires
// on its own, so a retry from the user gets a clean run.
const PROGRESS_TTL_SEC = 60 * 30;

const bookKey = (slug: string) => `kk:book:${slug}`;
const progressKey = (slug: string) => `kk:gen:progress:${slug}`;

function now() {
  return Date.now();
}

/** Distributed lock for atomic read-modify-write on a Redis key. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const r = getRedis();
  if (!r) return fn();

  const lockKey = `${key}:lock`;
  const token = `lock-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const acquired = await r.set(lockKey, token, { nx: true, ex: 30 });
    if (acquired) {
      try {
        return await fn();
      } finally {
        const current = await r.get<string>(lockKey);
        if (current === token) {
          await r.del(lockKey);
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
  }
  console.warn(`[bookRegistry] Could not acquire lock for ${key}`);
  return null;
}

export function registerSeedBook(book: GeneratedBook) {
  SEED_BOOKS[book.slug] = book;
}

const PRESET_SUFFIXES = ['-photoreal', '-watercolour', '-animation', '-comic', '-anime'];

function stripPresetSuffix(slug: string): string | null {
  for (const suffix of PRESET_SUFFIXES) {
    if (slug.endsWith(suffix)) {
      return slug.slice(0, -suffix.length);
    }
  }
  return null;
}

export async function getBook(slug: string): Promise<GeneratedBook | null> {
  // Hot path: same lambda already answered this slug.
  if (memBooks.has(slug)) {
    const book = memBooks.get(slug)!;
    syncCanonFromBook(book);
    return book;
  }
  if (SEED_BOOKS[slug]) {
    syncCanonFromBook(SEED_BOOKS[slug]);
    return SEED_BOOKS[slug];
  }

  const r = getRedis();
  if (r) {
    try {
      const book = await r.get<GeneratedBook>(bookKey(slug));
      if (book) {
        memBooks.set(slug, book);
        syncCanonFromBook(book);
        return book;
      }

      // Fallback: the caller may be using a bare slug (e.g. "mahabharata")
      // but the book was saved with a preset suffix ("mahabharata-photoreal").
      // This happens when old bookmarks or external links omit the suffix.
      // Scan is cheap on small datasets; we only do it when the exact miss
      // would otherwise return 404.
      const [nextCursor, keys] = await r.scan('0', { match: `${bookKey(slug)}-*`, count: 10 });
      void nextCursor; // single batch is enough for ≤10 matches
      if (keys && keys.length > 0) {
        const fallback = await r.get<GeneratedBook>(keys[0]);
        if (fallback && Array.isArray(fallback.scenes)) {
          console.warn(`[bookRegistry] slug fallback: ${slug} → ${keys[0].replace('kk:book:', '')}`);
          memBooks.set(slug, fallback);
          syncCanonFromBook(fallback);
          return fallback;
        }
      }

      // Reverse fallback: the caller uses a suffixed slug
      // (e.g. "mahabharata-photoreal") but the book was saved with a
      // bare slug ("mahabharata"). This happens for legacy showcase
      // books generated before the preset suffix logic existed.
      const bareSlug = stripPresetSuffix(slug);
      if (bareSlug) {
        const bareBook = await r.get<GeneratedBook>(bookKey(bareSlug));
        if (bareBook && Array.isArray(bareBook.scenes)) {
          console.warn(`[bookRegistry] slug reverse fallback: ${slug} → ${bareSlug}`);
          memBooks.set(slug, bareBook);
          syncCanonFromBook(bareBook);
          return bareBook;
        }
      }
    } catch (err) {
      console.warn('[bookRegistry] Redis read failed for', slug, ':', err instanceof Error ? err.message : err);
    }
  }
  return null;
}

export async function saveGeneratedBook(book: GeneratedBook): Promise<void> {
  const result = await withLock(bookKey(book.slug), async () => {
    memBooks.set(book.slug, book);
    capMap(memBooks, MAX_MEM_BOOKS);
    syncCanonFromBook(book);
    const r = getRedis();
    if (r) await r.set(bookKey(book.slug), book, { ex: BOOK_TTL_SEC });
    return true;
  });
  if (result === null) {
    throw new Error(`Failed to save book "${book.slug}" — could not acquire registry lock`);
  }
}

/**
 * Push the book's characters into the universal canon index so
 * visualPromptBuilder + visualAgent see them as first-class canon
 * entries. This is what makes every AI-generated book benefit from
 * the same appearance injection + anchor-based face locking that
 * the hand-curated Ramayana / Mahabharata canon books get.
 *
 * Idempotent — calling it on every getBook is fine, the canon
 * registrar merges by normalized key.
 */
function syncCanonFromBook(book: GeneratedBook): void {
  if (!book.slug || !book.characters?.length) return;
  const entries: CanonEntry[] = book.characters
    // Skip characters without enough to anchor against — registering
    // an entry with no appearance teaches visualPromptBuilder to
    // "lock" to an empty string, which hurts more than it helps.
    .filter(c => c.appearance || c.anchor_image_url)
    .map(c => ({
      id: c.slug,
      label: c.name,
      aliases: c.aliases ?? [],
      kind: 'character' as const,
      summary: c.short_summary || c.role || c.name,
      appearance: c.appearance,
      divine: c.divine,
      anchor_image_url: c.anchor_image_url,
    }));
  registerRuntimeCanon(book.slug, entries, {
    book_slug: book.slug,
    book_title: book.title,
    source: book.source_tradition || 'AI-generated narrative',
  });
}

/** Owner-driven deletion of an AI-generated book. Removes both the
 *  in-memory hot copy and the Redis entry. The route handler is
 *  responsible for verifying that the caller owns the book before
 *  invoking this — this function does not check ownership itself. */
export async function deleteBook(slug: string): Promise<void> {
  await withLock(bookKey(slug), async () => {
    memBooks.delete(slug);
    const r = getRedis();
    if (r) await r.del(bookKey(slug));
    // Progress entry shouldn't outlive the book either.
    memProgress.delete(slug);
    if (r) await r.del(progressKey(slug));
  });
}

export async function setProgress(
  slug: string,
  step: string,
  percent: number,
  done = false,
  error?: string,
): Promise<void> {
  const entry: ProgressEntry = { step, percent, done, error };
  memProgress.set(slug, entry);
  capMap(memProgress, MAX_MEM_PROGRESS);
  const r = getRedis();
  if (r) await r.set(progressKey(slug), entry, { ex: PROGRESS_TTL_SEC });
}

export async function getProgress(slug: string): Promise<ProgressEntry | null> {
  // Redis first — the POST that wrote progress may live on a
  // different lambda than the GET reading it. Memory is only
  // authoritative when Redis isn't configured (local dev).
  const r = getRedis();
  if (r) {
    const v = await r.get<ProgressEntry>(progressKey(slug));
    if (v) {
      memProgress.set(slug, v);
      return v;
    }
  }
  return memProgress.get(slug) ?? null;
}

export async function isBookGenerating(slug: string): Promise<boolean> {
  const p = await getProgress(slug);
  return !!p && !p.done;
}

export async function getAllBooks(): Promise<GeneratedBook[]> {
  // Scans Redis for every persisted book and returns them alongside
  // the in-memory hot cache and any registered seeds. Without the
  // Redis pass, a fresh lambda would only see books it has already
  // answered for in this invocation — meaning the public library
  // page would show just the seed Ramayana on every cold boot.
  const r = getRedis();
  const seen = new Set<string>();
  const out: GeneratedBook[] = [];

  for (const b of Object.values(SEED_BOOKS)) {
    seen.add(b.slug);
    out.push(b);
  }
  for (const b of memBooks.values()) {
    if (seen.has(b.slug)) continue;
    seen.add(b.slug);
    out.push(b);
  }

  if (r) {
    try {
      // Use SCAN instead of KEYS to avoid blocking Redis on large datasets.
      // Upstash returns [nextCursor, keys] as a tuple; cursor is a string.
      let cursor = '0';
      const redisKeys: string[] = [];
      do {
        const [nextCursor, keys] = await r.scan(cursor, { match: 'kk:book:*', count: 100 });
        cursor = nextCursor;
        if (keys) redisKeys.push(...keys);
      } while (cursor !== '0');

      const missing = redisKeys.filter(k => !seen.has(k.replace('kk:book:', '')));
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(k => r.get<GeneratedBook>(k).catch(() => null)),
        );
        for (const b of fetched) {
          if (!b || seen.has(b.slug)) continue;
          seen.add(b.slug);
          memBooks.set(b.slug, b);
          syncCanonFromBook(b);
          out.push(b);
        }
      }
    } catch (err) {
      // Don't fail the listing — degrade to the hot/seed view.
      console.warn('[bookRegistry] Redis enumeration failed:',
        err instanceof Error ? err.message : err);
    }
  }

  return out;
}

export async function getScene(bookSlug: string, sceneId: string) {
  const book = await getBook(bookSlug);
  if (!book) return null;
  return book.scenes.find(s => s.scene_id === sceneId) || null;
}

export async function getCharacter(bookSlug: string, characterSlug: string) {
  const book = await getBook(bookSlug);
  if (!book) return null;
  return book.characters.find(c => c.slug === characterSlug) || null;
}
