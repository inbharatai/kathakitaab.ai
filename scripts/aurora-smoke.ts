// ============================================================
// scripts/aurora-smoke.ts
//
// End-to-end smoke test of the Aurora durable path against the live
// DATABASE_URL. Creates a throwaway story via the real adapter
// (upsertStory), reads it back (getStoryBySlug), asserts the Redis
// key was NOT created (proves Aurora is the durable branch, not a
// Redis echo), soft-deletes it, and confirms the read now misses.
//
// Run:  npm run aurora:smoke
//
// Exit code 0 = pass. Non-zero = fail. Never deletes from Redis.
// ============================================================

import './_loadEnv';
import { getRedis } from '@/lib/redis';
import { isAuroraEnabled } from '@/lib/db/aurora';
import { upsertStory, getStoryBySlug, softDeleteStory } from '@/lib/storage/storyStore';
import type { GeneratedBook } from '@/lib/openai/bookGeneratorAgent';

const SLUG = `aurora-smoke-${Date.now()}`;
const BOOK_KEY = `kk:book:${SLUG}`;

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('  ✗ FAIL:', msg); process.exitCode = 1; }
  else console.log('  ✓', msg);
}

(async () => {
  console.log('[smoke] USE_AURORA enabled:', isAuroraEnabled());
  if (!isAuroraEnabled()) {
    console.error('[smoke] USE_AURORA=false or DATABASE_URL missing — nothing to test.');
    process.exitCode = 1;
    return;
  }

  const book: GeneratedBook = {
    id: SLUG,
    slug: SLUG,
    title: 'Aurora Smoke Test Story',
    subtitle: 'H0 durable-layer verification',
    description: 'A throwaway story used to prove Aurora writes + reads work.',
    source_tradition: 'smoke-test',
    generatedAt: Date.now(),
    mode: 'world',
    visibility: 'public',
    accuracyLabel: 'CREATIVE_RETELLING',
    scenes: [
      {
        scene_id: 'scene-1',
        title: 'Opening',
        order_index: 0,
        narration: 'The smoke test begins.',
        short_summary: 'begin',
        visual_description: 'a quiet lab',
        background_asset_url: 'https://example.com/img.png',
        narration_audio_url: 'https://example.com/audio.wav',
        audio_provider: 'sarvam',
        learning_points: [],
        source_notes: '',
        hotspots: [],
        quiz_questions: [],
        previous_scene_id: null,
        next_scene_id: null,
      },
    ],
    characters: [
      { slug: 'tester', name: 'Tester', role: 'protagonist', short_summary: 'runs the smoke', traits: [], speech_tone: '', talk_examples: [], source_notes: '' },
    ],
  };

  console.log('[smoke] 1. upsertStory');
  const wrote = await upsertStory(book);
  assert(wrote, 'upsertStory returned true');

  console.log('[smoke] 2. getStoryBySlug');
  const read = await getStoryBySlug(SLUG);
  assert(!!read, 'read returned a book');
  assert(read?.title === book.title, 'title round-trips');
  assert(read?.slug === SLUG, 'slug round-trips');
  assert(read?.scenes?.length === 1, 'one scene round-trips');
  assert(read?.scenes?.[0]?.background_asset_url === 'https://example.com/img.png', 'scene image URL round-trips');
  assert(read?.characters?.length === 1, 'one character round-trips');

  console.log('[smoke] 3. Redis was NOT written by the Aurora path');
  const r = getRedis();
  if (r) {
    const exists = await r.exists(BOOK_KEY);
    assert(exists === 0, `Redis key ${BOOK_KEY} absent (Aurora is not a Redis echo)`);
  } else {
    console.log('  (Redis not configured locally — skipping Redis-untouched check)');
  }

  console.log('[smoke] 4. softDeleteStory');
  const del = await softDeleteStory(SLUG);
  assert(del, 'softDeleteStory returned true');
  const after = await getStoryBySlug(SLUG);
  assert(after === null, 'read after soft-delete returns null');

  console.log('[smoke] done. exitCode=', process.exitCode ?? 0);
})().catch((err: unknown) => {
  console.error('[smoke] crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});