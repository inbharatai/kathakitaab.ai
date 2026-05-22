import './_loadEnv';

import { generateBook } from '../lib/openai/bookGeneratorAgent';
import { saveGeneratedBook, deleteBook, getBook } from '../lib/data/bookRegistry';
import { saveScenes, type PersistedScene } from '../lib/data/sceneRegistry';
import { hydrateBookAudio } from '../lib/video/manifestSynthesizer';

const TEST_TITLE = 'Tenali Raman';
const TEST_SLUG = 'tenali-raman';

async function testGenerateOne() {
  console.log(`[test-seed] === LOCAL TEST RUN ===`);
  console.log(`[test-seed] Generating: ${TEST_TITLE}`);

  // Optional: delete existing first
  const existing = await getBook(TEST_SLUG);
  if (existing) {
    console.log(`[test-seed] deleting existing ${TEST_SLUG}...`);
    await deleteBook(TEST_SLUG);
  }

  const start = Date.now();
  const book = await generateBook(
    TEST_TITLE,
    (step, percent) => console.log(`[test-seed]   ${percent.toString().padStart(3)}%  ${step}`),
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n[test-seed] === GENERATION COMPLETE in ${elapsed}s ===`);
  console.log(`[test-seed] slug: ${book.slug}`);
  console.log(`[test-seed] scenes: ${book.scenes.length}`);

  // Verify multi-beat integrity
  let beatsTotal = 0;
  let scenesWithBeats = 0;
  for (const s of book.scenes) {
    const beatCount = s.beats?.length ?? 0;
    beatsTotal += beatCount;
    if (beatCount > 0) scenesWithBeats++;
    console.log(`[test-seed]   Scene ${s.scene_number}: ${beatCount} beat(s)`);
  }
  console.log(`\n[test-seed] SUMMARY: ${scenesWithBeats}/${book.scenes.length} scenes have beats | total beats: ${beatsTotal}`);

  if (scenesWithBeats < book.scenes.length * 0.5) {
    console.error('[test-seed] FAIL: fewer than 50% of scenes have multi-beat images.');
    process.exit(1);
  }

  // Save to Redis
  const finalBook = {
    ...book,
    mode: 'world' as const,
    visibility: 'public' as const,
    movieStatus: 'ready' as const,
    updatedAt: Date.now(),
  };

  await saveGeneratedBook(finalBook);
  console.log(`[test-seed] book saved to Redis.`);

  // Hydrate audio
  console.log(`[test-seed] hydrating audio...`);
  const hydrated = await hydrateBookAudio(finalBook);
  await saveGeneratedBook(hydrated);

  const persistedScenes: PersistedScene[] = hydrated.scenes.map(s => ({
    ...s,
    savedAt: Date.now(),
    imageStatus: s.background_asset_url ? 'completed' : 'pending',
    ttsStatus: s.narration_audio_url ? 'completed' : 'pending',
  }));
  await saveScenes(TEST_SLUG, persistedScenes);

  const audioOk = hydrated.scenes.filter(s => s.narration_audio_url).length;
  console.log(`[test-seed] audio: ${audioOk}/${hydrated.scenes.length} scenes`);
  console.log(`[test-seed] === TEST PASSED ===`);
}

testGenerateOne().catch(err => {
  console.error('[test-seed] fatal:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
