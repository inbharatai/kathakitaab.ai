// Refresh remotion/manifests/<slug>.json from the live AI book in Redis.
// Used after regenerating a showcase book so the landing-page Player
// (which loads the static JSON synchronously at module init) picks up
// the new images, audio URLs, and hotspots without needing a dev
// server or full movie build.

import './_loadEnv';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBook } from '../lib/data/bookRegistry';
import { synthesizeBookMovieManifest } from '../lib/video/manifestSynthesizer';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx scripts/refresh-static-manifest.ts <slug>');
    process.exit(1);
  }

  const book = await getBook(slug);
  if (!book) {
    console.error(`No book "${slug}" in Redis. Generate it first.`);
    process.exit(1);
  }

  const manifest = synthesizeBookMovieManifest(book);
  const out = join(process.cwd(), 'remotion', 'manifests', `${slug}.json`);
  writeFileSync(out, JSON.stringify(manifest, null, 2));

  const audioCount = manifest.scenes.filter(s => s.audioPath).length;
  const hotspotCount = manifest.scenes.reduce((n, s) => n + (s.hotspots?.length ?? 0), 0);
  console.log(`wrote ${out}`);
  console.log(`  scenes: ${manifest.scenes.length}`);
  console.log(`  with audio URL: ${audioCount}/${manifest.scenes.length}`);
  console.log(`  hotspots total: ${hotspotCount}`);
  console.log(`  total duration: ${manifest.scenes.reduce((n, s) => n + (s.durationSeconds ?? 0), 0).toFixed(1)}s`);
}

main().catch(e => {
  console.error('failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
