// ============================================================
// scripts/hydrate-book-audio.ts
//
// Pre-render narration audio for an AI-generated book that's
// already in Redis. Cheap path: text + images stay; only the
// missing `narration_audio_url` fields are filled in, then the
// book is saved back.
//
// Why this exists:
//   The book gen lambda used to render audio inline but kept
//   blowing past the 300s Vercel ceiling, so audio was moved to
//   lazy hydration in /api/livebook/manifest. That works for the
//   movie path, but the live reader can be opened WITHOUT visiting
//   the movie first — and then it falls through to /api/livebook/tts
//   per scene, adding a 3-5s wait at every scene change. For
//   showcase books we'd rather just have the URLs ready.
//
// Cost: ~$0.01-0.02 per scene (Gemini TTS). 8 scenes ≈ $0.10.
//
// Usage:
//   npx tsx scripts/hydrate-book-audio.ts akbar-and-birbal
// ============================================================

import './_loadEnv';

import { getBook, saveGeneratedBook } from '../lib/data/bookRegistry';
import { hydrateBookAudio } from '../lib/video/manifestSynthesizer';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx scripts/hydrate-book-audio.ts <slug>');
    process.exit(1);
  }

  const book = await getBook(slug);
  if (!book) {
    console.error(`No book "${slug}" in Redis. Generate it first.`);
    process.exit(1);
  }

  const before = book.scenes.filter(s => s.narration_audio_url).length;
  console.log(`[hydrate] ${slug}: ${before}/${book.scenes.length} scenes already have audio`);

  if (before === book.scenes.length) {
    console.log('[hydrate] every scene is hydrated — nothing to do.');
    process.exit(0);
  }

  const start = Date.now();
  console.log(`[hydrate] rendering ${book.scenes.length - before} missing scenes (serial Gemini, ~8s each)…`);
  const hydrated = await hydrateBookAudio(book);
  await saveGeneratedBook(hydrated);

  const after = hydrated.scenes.filter(s => s.narration_audio_url).length;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[hydrate] done in ${elapsed}s — ${after}/${hydrated.scenes.length} scenes hydrated.`);
  if (after < hydrated.scenes.length) {
    console.log('[hydrate] some scenes failed — re-run the script to retry only the missing ones.');
    process.exit(2);
  }
}

main().catch(err => {
  console.error('[hydrate] failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
