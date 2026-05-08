// ============================================================
// KathaKitaab.ai — Book Registry (Redis-backed)
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

// 30 days for the finished book — long enough that a generation
// done last week still resolves; short enough that abandoned
// experiments don't pile up forever.
const BOOK_TTL_SEC = 60 * 60 * 24 * 30;
// 30 minutes for in-flight progress. A stuck generation expires
// on its own, so a retry from the user gets a clean run.
const PROGRESS_TTL_SEC = 60 * 30;

const bookKey = (slug: string) => `kk:book:${slug}`;
const progressKey = (slug: string) => `kk:gen:progress:${slug}`;

export function registerSeedBook(book: GeneratedBook) {
  SEED_BOOKS[book.slug] = book;
}

export async function getBook(slug: string): Promise<GeneratedBook | null> {
  // Hot path: same lambda already answered this slug.
  if (memBooks.has(slug)) return memBooks.get(slug)!;
  if (SEED_BOOKS[slug]) return SEED_BOOKS[slug];

  const r = getRedis();
  if (r) {
    const book = await r.get<GeneratedBook>(bookKey(slug));
    if (book) {
      memBooks.set(slug, book);
      return book;
    }
  }
  return null;
}

export async function saveGeneratedBook(book: GeneratedBook): Promise<void> {
  memBooks.set(book.slug, book);
  const r = getRedis();
  if (r) await r.set(bookKey(book.slug), book, { ex: BOOK_TTL_SEC });
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
  // Returns whatever is locally hot plus seeds. Cross-lambda
  // enumeration would need SCAN over Redis, which is fine but
  // unused — `app/api/books/route.ts` reads from ramayanaSeed.
  return [
    ...Object.values(SEED_BOOKS),
    ...Array.from(memBooks.values()),
  ];
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
