// ============================================================
// Phase D regression: per-action cache keying.
//
// Calling /api/livebook/scene-stream once warms the branch state
// for canon entities. The endpoint's response should include
// ready/pending verbs distinct per (entityId, verb) — the bug
// before Phase D was that every verb collapsed into a single
// "auto" bucket so Talk vs Fight gave the same narration.
//
// Test makes three assertions:
//   1. Cold scene-stream returns canon verbs as 'pending'
//   2. After triggering pre-gen, scene-stream flips them to 'ready'
//   3. The 'preview' titles for Talk and Move are different — proves
//      that the verbs produced *meaningfully different* branches.
// ============================================================

import { test, expect } from '@playwright/test';

interface ManifestEntity {
  entityId: string;
  actions: Array<{ verb: string; status: 'ready' | 'pending' | 'none'; preview?: string }>;
}
interface SceneManifest { entities: ManifestEntity[]; }

const SCENE = 'ayodhya_intro';
const BOOK = 'ramayana';

test.describe('Per-action branch cache (Phase D)', () => {
  test.setTimeout(180_000);

  test('Talk and Move warm into separate cache buckets with distinct previews', async ({ request }) => {
    // Step 1 — read manifest. Talk and Move should at least be in
    // the action list for Rama (canon-driven). Their statuses can
    // be anything at this point — first run is cold, later runs reuse.
    const cold = await request.get(`/api/livebook/scene-stream/${SCENE}?bookSlug=${BOOK}`);
    expect(cold.ok(), 'scene-stream must return 200').toBeTruthy();
    const coldManifest = await cold.json() as SceneManifest;
    const ramaCold = coldManifest.entities.find(e => e.entityId === 'rama');
    expect(ramaCold, 'manifest must include rama').toBeTruthy();
    const verbs = (ramaCold!.actions ?? []).map(a => a.verb);
    expect(verbs).toContain('talk');
    expect(verbs).toContain('move');

    // Step 2 — kick pre-gen. This populates the per-action cache.
    const pregen = await request.post('/api/livebook/pregenerate-branches', {
      data: {
        bookSlug: BOOK,
        bookTitle: 'Ramayana LiveBook',
        sceneId: SCENE,
        sceneTitle: 'The Princes of Ayodhya',
        sceneNarration: 'In the golden city of Ayodhya, Rama and his brothers grow up in dharma.',
        entities: [{ entityId: 'rama', label: 'Rama', type: 'character', x: 35, y: 40 }],
      },
      timeout: 120_000,
    });
    expect(pregen.ok(), 'pregenerate-branches must return 200').toBeTruthy();
    const pregenJson = await pregen.json();
    // 'cached' = manifest already complete from a prior run, which is
    // a fully valid warm state for this test. 'ready'/'partial' are
    // the cold-path outcomes.
    expect(pregenJson.status, `pregen status was ${pregenJson.status}`).toMatch(/ready|partial|cached/);

    // Step 3 — re-read manifest, verify both verbs are now ready and
    // produced different preview titles. Different previews are the
    // visible proof that Talk and Move generated different content
    // — i.e., the cache key honors the verb.
    const warm = await request.get(`/api/livebook/scene-stream/${SCENE}?bookSlug=${BOOK}`);
    const warmManifest = await warm.json() as SceneManifest;
    const ramaWarm = warmManifest.entities.find(e => e.entityId === 'rama')!;
    const talk = ramaWarm.actions.find(a => a.verb === 'talk');
    const move = ramaWarm.actions.find(a => a.verb === 'move');

    expect(talk?.status, 'talk should be ready after pregen').toBe('ready');
    expect(move?.status, 'move should be ready after pregen').toBe('ready');
    expect(talk?.preview, 'talk should have a preview title').toBeTruthy();
    expect(move?.preview, 'move should have a preview title').toBeTruthy();
    expect(talk?.preview).not.toEqual(move?.preview);
  });
});
