// Force-re-render every scene's narration_audio_url for one or more
// books, regardless of whether the existing URL HEADs OK. Built for
// the case where a book was hydrated under the broken Sarvam path
// (pre-chunker-fix), so its CDN WAVs are Gemini-voiced even
// though the URLs still resolve.
//
// Idempotent: strips narration_audio_url first, then runs the
// universal hydrateBookAudio (Sarvam → Gemini fallback chain) which
// checkpoints per-scene. Safe to interrupt and re-run.
//
// Usage:
//   npx tsx scripts/force-reaudio.ts akbar-and-birbal-stories
//   npx tsx scripts/force-reaudio.ts                            # all books in Redis

import './_loadEnv';

import { getRedis } from '../lib/redis';
import { getBook, saveGeneratedBook } from '../lib/data/bookRegistry';
import { hydrateBookAudio } from '../lib/video/manifestSynthesizer';

async function reaudio(slug: string): Promise<void> {
  const book = await getBook(slug);
  if (!book) {
    console.warn(`[force-reaudio] ${slug}: not in Redis`);
    return;
  }
  console.log(`\n=== ${slug} (${book.scenes.length} scenes) ===`);

  // Strip every existing audio URL so hydrateBookAudio re-renders them
  // all. Old URLs stay on S3 (upsert overwrites them by path on
  // re-upload) so we don't orphan anything.
  const stripped = {
    ...book,
    scenes: book.scenes.map(s => {
      const next = { ...s };
      delete next.narration_audio_url;
      return next;
    }),
  };
  await saveGeneratedBook(stripped);
  console.log(`  stripped ${book.scenes.length} URL(s); now re-rendering via Sarvam→Gemini chain…`);

  const t0 = Date.now();
  const fresh = await getBook(slug);
  if (!fresh) return;
  const hydrated = await hydrateBookAudio(fresh);
  await saveGeneratedBook(hydrated);

  const ok = hydrated.scenes.filter(s => s.narration_audio_url).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ ${ok}/${hydrated.scenes.length} narrations re-rendered (${elapsed}s)`);
}

async function main() {
  const args = process.argv.slice(2);
  let slugs = args.filter(a => !a.startsWith('--'));
  if (slugs.length === 0) {
    const r = getRedis();
    if (!r) { console.error('No Redis configured'); process.exit(1); }
    const keys = await r.keys('kk:book:*');
    slugs = keys.map(k => k.replace('kk:book:', '')).sort();
  }
  console.log(`[force-reaudio] targets: ${slugs.join(', ')}`);
  for (const slug of slugs) {
    try {
      await reaudio(slug);
    } catch (err) {
      console.error(`[force-reaudio] ${slug} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log('\n[force-reaudio] done');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
