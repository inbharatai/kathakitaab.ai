// One-shot smoke test: build the BookMovieManifest the trailer/movie
// page would consume, and report whether multi-beat made it through.
// Pure local math — no Vercel, no audio hydration.
import './_loadEnv';

import { getBook } from '../lib/data/bookRegistry';
import { synthesizeBookMovieManifest } from '../lib/video/manifestSynthesizer';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx scripts/verify-manifest-multibeat.ts <slug>');
    process.exit(1);
  }
  const book = await getBook(slug);
  if (!book) {
    console.error(`No book "${slug}" in Redis.`);
    process.exit(1);
  }
  const manifest = synthesizeBookMovieManifest(book);
  const beatScenes = manifest.scenes.filter(s => Array.isArray(s.beats) && s.beats.length >= 2);
  console.log(`Manifest for ${manifest.bookTitle} (${manifest.bookSlug}):`);
  console.log(`  Scenes:      ${manifest.scenes.length}`);
  console.log(`  Multi-beat:  ${beatScenes.length}/${manifest.scenes.length}`);
  for (const s of manifest.scenes) {
    const beats = Array.isArray(s.beats) ? s.beats.length : 0;
    console.log(`  Scene "${s.title.padEnd(34)}" beats=${beats} mood=${s.mood} motion=${s.motion} effects=${s.effects?.length ?? 0}`);
  }
}

main().catch(err => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
