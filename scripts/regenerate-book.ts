// ============================================================
// scripts/regenerate-book.ts
//
// Drops a book from Redis and regenerates it end-to-end with the
// current pipeline (multi-beat images, mood-tagged narration,
// per-character ambient layers — whatever the live generator
// is wired to right now).
//
// Use when:
//   - The generator pipeline added a new field (e.g. visual_beats)
//     that older books don't carry, and you want the showcase books
//     to demonstrate it without waiting for a user to retype them.
//   - The image style guide changed and committed bookmarks need a
//     refresh.
//
// Cost: a single book generation runs ~$0.40-$1.20 in API calls
// (gpt-4o-mini for narration + gpt-image-1 per beat + Sarvam/Gemini
// for TTS). Multi-beat scenes are at the high end. Don't loop this.
//
// Usage:
//   npx tsx scripts/regenerate-book.ts akbar-and-birbal "Akbar and Birbal"
//   npx tsx scripts/regenerate-book.ts <slug> "<title>" [--mode=world]
//
// The slug must match the URL slug the book is reached at; the title
// is what the LLM uses to plan the outline. Mode defaults to 'world'
// (the public-library tradition mode) — that's the only mode the
// hand-curated showcase books should use.
// ============================================================

import './_loadEnv';

import { generateBook } from '../lib/openai/bookGeneratorAgent';
import { saveGeneratedBook, deleteBook, getBook } from '../lib/data/bookRegistry';

interface Args {
  slug: string;
  title: string;
  force: boolean;
}

// Mirror of the slugifier inside generateBookOpenAI. Kept here so we
// can fail-fast before spending image-gen money when the requested
// slug wouldn't actually be produced from the given title.
function slugify(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function parseArgs(): Args {
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const slug = positional[0];
  const title = positional[1];
  if (!slug || !title) {
    console.error('Usage: npx tsx scripts/regenerate-book.ts <slug> "<title>" [--force]');
    console.error('Example: npx tsx scripts/regenerate-book.ts akbar-and-birbal "Akbar and Birbal"');
    process.exit(1);
  }
  return { slug, title, force: flags.includes('--force') };
}

async function main() {
  const { slug, title, force } = parseArgs();

  if (slugify(title) !== slug) {
    console.error(`[regen] title "${title}" slugifies to "${slugify(title)}", not "${slug}".`);
    console.error('         Adjust the title so the URL slug matches before spending API credit.');
    process.exit(1);
  }

  // Show what's currently in Redis so the operator knows what they're
  // about to overwrite. Useful sanity check on a real key.
  const existing = await getBook(slug);
  if (existing) {
    const beatScenes = existing.scenes.filter(s => Array.isArray(s.beats) && s.beats.length >= 2).length;
    console.log(`[regen] existing "${slug}":`);
    console.log(`         title: ${existing.title}`);
    console.log(`         scenes: ${existing.scenes.length}`);
    console.log(`         multi-beat scenes: ${beatScenes}/${existing.scenes.length}`);
    console.log(`         generated: ${new Date(existing.generatedAt).toISOString()}`);
    if (!force && beatScenes === existing.scenes.length && existing.scenes.length > 0) {
      console.log('[regen] every scene already has multi-beat. Pass --force to regenerate anyway.');
      process.exit(0);
    }
  } else {
    console.log(`[regen] no existing entry for "${slug}" — generating fresh.`);
  }

  console.log(`[regen] deleting kk:book:${slug}…`);
  await deleteBook(slug);

  console.log(`[regen] generating "${title}" (mode=world)…`);
  const start = Date.now();
  const book = await generateBook(
    title,
    (step, percent) => console.log(`[regen]   ${percent.toString().padStart(3)}%  ${step}`),
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Slug we generate may not match the requested slug if the title
  // contains characters the generator strips. Bail loudly rather than
  // silently writing under the wrong key.
  if (book.slug !== slug) {
    console.error(`[regen] mismatch: generated slug "${book.slug}" != requested "${slug}".`);
    console.error('         Pass a title whose normalised slug matches the URL slug, or update the URL.');
    process.exit(1);
  }

  // The generator saves to Redis on success, but be defensive — if we
  // ever change the lifecycle, we still want this script to leave a
  // valid record on Redis so the books page picks up the new shape.
  await saveGeneratedBook(book);

  const beatScenes = book.scenes.filter(s => Array.isArray(s.beats) && s.beats.length >= 2).length;
  const totalImages = book.scenes.reduce(
    (sum, s) => sum + (Array.isArray(s.beats) && s.beats.length > 0 ? s.beats.length : 1),
    0,
  );

  console.log('');
  console.log(`[regen] done in ${elapsed}s`);
  console.log(`         slug: ${book.slug}`);
  console.log(`         title: ${book.title}`);
  console.log(`         scenes: ${book.scenes.length}`);
  console.log(`         multi-beat scenes: ${beatScenes}/${book.scenes.length}`);
  console.log(`         total painted images: ${totalImages}`);
  console.log('');
  console.log(`Open: http://localhost:5009/books/${book.slug}`);
  console.log(`Movie: http://localhost:5009/books/${book.slug}/movie`);
}

main().catch(err => {
  console.error('[regen] failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
