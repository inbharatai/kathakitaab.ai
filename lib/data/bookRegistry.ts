// ============================================================
// KathaKitaab.ai — Book Registry
// In-memory store of all books (seed + AI-generated).
// Acts as the single source of truth for all book data.
// Production: swap Map for Supabase.
// ============================================================

import { GeneratedBook } from '@/lib/openai/bookGeneratorAgent';

// Built-in seed books (pre-generated)
const SEED_BOOKS: Record<string, GeneratedBook> = {};

// Runtime-generated books (user-created this session)
const generatedBooks = new Map<string, GeneratedBook>();

// Generation progress tracking
const generationProgress = new Map<string, { step: string; percent: number; done: boolean; error?: string }>();

export function registerSeedBook(book: GeneratedBook) {
  SEED_BOOKS[book.slug] = book;
}

export function getBook(slug: string): GeneratedBook | null {
  return generatedBooks.get(slug) || SEED_BOOKS[slug] || null;
}

export function getAllBooks(): GeneratedBook[] {
  return [
    ...Object.values(SEED_BOOKS),
    ...Array.from(generatedBooks.values()),
  ];
}

export function saveGeneratedBook(book: GeneratedBook) {
  generatedBooks.set(book.slug, book);
}

export function isBookGenerating(slug: string): boolean {
  const p = generationProgress.get(slug);
  return !!p && !p.done;
}

export function setProgress(slug: string, step: string, percent: number, done = false, error?: string) {
  generationProgress.set(slug, { step, percent, done, error });
}

export function getProgress(slug: string) {
  return generationProgress.get(slug) || null;
}

export function getScene(bookSlug: string, sceneId: string) {
  const book = getBook(bookSlug);
  if (!book) return null;
  return book.scenes.find(s => s.scene_id === sceneId) || null;
}

export function getCharacter(bookSlug: string, characterSlug: string) {
  const book = getBook(bookSlug);
  if (!book) return null;
  return book.characters.find(c => c.slug === characterSlug) || null;
}
