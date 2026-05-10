// ============================================================
// scripts/verify-book.ts
//
// Reads a generated book back out of Redis and reports what shape it
// landed in. Cheap to run — pure Redis read, no API calls. Useful
// after a regenerate to confirm the multi-beat pipeline produced what
// the live reader expects.
//
// Usage:
//   npx tsx scripts/verify-book.ts akbar-and-birbal
// ============================================================

import './_loadEnv';

import { getBook } from '../lib/data/bookRegistry';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx scripts/verify-book.ts <slug>');
    process.exit(1);
  }

  const book = await getBook(slug);
  if (!book) {
    console.error(`No book "${slug}" in Redis. Run npm run regenerate:book first.`);
    process.exit(1);
  }

  const beatScenes = book.scenes.filter(s => Array.isArray(s.beats) && s.beats.length >= 2);
  const totalImages = book.scenes.reduce(
    (sum, s) => sum + (Array.isArray(s.beats) && s.beats.length > 0 ? s.beats.length : 1),
    0,
  );

  console.log(`Book: ${book.title} (${book.slug})`);
  console.log(`  Generated:   ${new Date(book.generatedAt).toISOString()}`);
  console.log(`  Scenes:      ${book.scenes.length}`);
  console.log(`  Multi-beat:  ${beatScenes.length}/${book.scenes.length}`);
  console.log(`  Total imgs:  ${totalImages}`);
  console.log('');

  for (const s of book.scenes) {
    const beats = Array.isArray(s.beats) ? s.beats.length : 0;
    const audio = s.narration_audio_url ? 'audio✓' : 'audio✗';
    const bg = s.background_asset_url ? 'bg✓' : 'bg✗';
    const hotspots = s.hotspots?.length ?? 0;
    console.log(
      `  Scene ${s.order_index + 1}: ${s.title.padEnd(38)} ` +
      `beats=${beats} ${bg} ${audio} hotspots=${hotspots} mood=${s.mood ?? '—'}`,
    );
  }

  if (beatScenes.length === 0) {
    console.log('');
    console.log('⚠️  No multi-beat scenes. The visual_beats prompt may not have landed,');
    console.log('   or the generator was running a pre-multi-beat version.');
    process.exit(2);
  }
  if (beatScenes.length < book.scenes.length) {
    console.log('');
    console.log(`⚠️  ${book.scenes.length - beatScenes.length} scene(s) without multi-beat.`);
    console.log('   The LLM didn\'t emit visual_beats[] for those — fallback to single image.');
  }
}

main().catch(err => {
  console.error('Verify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
