// ============================================================
// Phase G regression: sentence-level subtitle cues.
//
// Before Phase G the movie composition rendered the entire scene
// narration as a single static paragraph. The new SceneShot splits
// the narration into sentences and advances them one at a time,
// emitting a `data-cue-index` attribute on the caption element so
// the cue progression is observable from outside React.
//
// Test plays the movie far enough to observe the cue index advance
// at least once — proves the timing track works end-to-end.
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Movie sentence cues', () => {
  test.setTimeout(90_000);

  test('subtitle cue index advances during scene 1', async ({ page }) => {
    await page.goto('/books/ramayana/movie');
    await page.waitForLoadState('domcontentloaded');

    // Click anywhere in the player to start playback. clickToPlay
    // is enabled, so a single click does it.
    const playerSurface = page.locator('main').first();
    const box = await playerSurface.boundingBox();
    if (!box) throw new Error('player surface not measurable');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);

    // Wait past the title card (4s) into scene 1 (~6s in).
    await page.waitForTimeout(6500);

    // Caption element exposes data-cue-index. It may be -1 briefly
    // between cues; we only need to see a non-negative cue index.
    const caption = page.locator('[data-testid="movie-caption"]').first();
    await expect(caption).toBeVisible({ timeout: 10_000 });

    // Read the cue index now and again 6s later — it must have
    // advanced. Six seconds is roughly two short sentences in our
    // narration, so this is a stable enough threshold.
    const firstIndex = Number(await caption.getAttribute('data-cue-index') ?? '-1');
    expect(firstIndex, 'first observed cue index should be non-negative').toBeGreaterThanOrEqual(0);

    await page.waitForTimeout(6500);

    const secondIndex = Number(await caption.getAttribute('data-cue-index') ?? '-1');
    expect(secondIndex, 'cue index must advance over time').toBeGreaterThan(firstIndex);

    // And the total cue count must be > 1 — proves the scene narration
    // actually decomposed into multiple sentences (not "splits but only
    // ever produces one giant cue").
    const total = Number(await caption.getAttribute('data-cue-total') ?? '0');
    expect(total, 'narration should split into multiple cues').toBeGreaterThan(1);
  });
});
