// ============================================================
// scripts/seed-showcase.ts
//
// Batch-regenerates the showcase books that power the landing page
// and library demos. Run this after a Redis flush or when showcase
// books have gone missing.
//
// Showcase books (world mode, public, default preset):
//   1. Mahabharata
//   2. Akbar and Birbal
//   3. Vikram and Betaal
//   4. Panchatantra
//
// Cost: ~4 × $0.40–$1.20 = ~$1.60–$4.80 in API calls.
//
// Usage:
//   npx tsx scripts/seed-showcase.ts [--force]
//
// Each book is generated serially so the operator can watch progress.
// Pass --force to regenerate even if the book already exists.
// ============================================================

import './_loadEnv';

import { generateBook } from '../lib/openai/bookGeneratorAgent';
import { saveGeneratedBook, deleteBook, getBook } from '../lib/data/bookRegistry';
import { saveScenes, type PersistedScene } from '../lib/data/sceneRegistry';
import { hydrateBookAudio } from '../lib/video/manifestSynthesizer';

const SHOWCASE = [
  { slug: 'mahabharata', title: 'Mahabharata' },
  { slug: 'akbar-and-birbal', title: 'Akbar and Birbal' },
  { slug: 'vikram-and-betaal', title: 'Vikram and Betaal' },
  { slug: 'panchatantra', title: 'Panchatantra' },
  { slug: 'tenali-raman', title: 'Tenali Raman' },
];

const force = process.argv.slice(2).includes('--force');

async function seedOne(entry: typeof SHOWCASE[number]) {
  const existing = await getBook(entry.slug);
  if (existing && !force) {
    console.log(`[seed-showcase] "${entry.slug}" already exists. Pass --force to regenerate.`);
    return { slug: entry.slug, status: 'skipped' as const };
  }

  if (existing && force) {
    console.log(`[seed-showcase] deleting existing "${entry.slug}" for forced regeneration…`);
    await deleteBook(entry.slug);
  }

  console.log(`[seed-showcase] generating "${entry.title}" …`);
  const start = Date.now();
  const book = await generateBook(
    entry.title,
    (step, percent) => console.log(`[seed-showcase]   ${percent.toString().padStart(3)}%  ${step}`),
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (book.slug !== entry.slug) {
    console.error(`[seed-showcase] slug mismatch: generated "${book.slug}" != expected "${entry.slug}".`);
    return { slug: entry.slug, status: 'error' as const, error: 'slug mismatch' };
  }

  // Stamp metadata the generator doesn't know about
  const finalBook = {
    ...book,
    mode: 'world' as const,
    visibility: 'public' as const,
    movieStatus: 'ready' as const,
    updatedAt: Date.now(),
  };

  await saveGeneratedBook(finalBook);

  // Hydrate audio
  console.log(`[seed-showcase] hydrating audio for "${entry.slug}" …`);
  const hydrated = await hydrateBookAudio(finalBook);
  await saveGeneratedBook(hydrated);

  // Persist per-scene registry entries
  const persistedScenes: PersistedScene[] = hydrated.scenes.map(s => ({
    ...s,
    savedAt: Date.now(),
    imageStatus: s.background_asset_url ? 'completed' : 'pending',
    ttsStatus: s.narration_audio_url ? 'completed' : 'pending',
  }));
  await saveScenes(entry.slug, persistedScenes);

  const audioOk = hydrated.scenes.filter(s => s.narration_audio_url).length;
  console.log(`[seed-showcase] done "${entry.slug}" in ${elapsed}s — ${hydrated.scenes.length} scenes, ${audioOk}/${hydrated.scenes.length} audio.`);

  return { slug: entry.slug, status: 'ok' as const, scenes: hydrated.scenes.length, audio: audioOk };
}

async function main() {
  console.log('[seed-showcase] starting showcase seed batch…');
  console.log(`[seed-showcase] force=${force}, books=${SHOWCASE.length}`);
  console.log('');

  const results = [];
  for (const entry of SHOWCASE) {
    const result = await seedOne(entry);
    results.push(result);
    console.log('');
  }

  const ok = results.filter(r => r.status === 'ok');
  const skipped = results.filter(r => r.status === 'skipped');
  const errors = results.filter(r => r.status === 'error');

  console.log('[seed-showcase] batch complete:');
  console.log(`            ok: ${ok.length}`);
  console.log(`       skipped: ${skipped.length}`);
  console.log(`        errors: ${errors.length}`);
  for (const r of errors) {
    console.log(`         - ${r.slug}: ${(r as { error: string }).error}`);
  }

  if (ok.length > 0) {
    console.log('');
    console.log('Open the library:');
    console.log('  http://localhost:5009/books');
  }
}

main().catch(err => {
  console.error('[seed-showcase] fatal:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
