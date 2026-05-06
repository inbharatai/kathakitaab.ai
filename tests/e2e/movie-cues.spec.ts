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
  test.setTimeout(120_000);

  test('subtitle cue index advances during scene 1', async ({ page }) => {
    await page.goto('/books/ramayana/movie');
    await page.waitForLoadState('domcontentloaded');
    // Give the Player time to mount + buffer audio. A bare click on
    // an unmounted Player is a no-op — without this wait the test
    // sees the player at 0:01 because clickToPlay arrived before the
    // play handler was wired.
    await page.waitForTimeout(2_500);

    // Click the Player's play button. Remotion exposes it with
    // aria-label "Play"; try that first, then fall back to clicking
    // the player surface (40% from the top — well inside the canvas
    // and above the controls).
    const playBtn = page.locator('button[aria-label="Play"]').first();
    if (await playBtn.count() > 0) {
      await playBtn.click().catch(() => {});
    } else {
      const surface = page.locator('main').first();
      const box = await surface.boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.35);
    }

    // Caption element only exists once the Sequence past the 4s title
    // card mounts. Wait long enough for cold-start to clear.
    const caption = page.locator('[data-testid="movie-caption"]').first();
    await expect(caption).toBeVisible({ timeout: 25_000 });

    // Capture the first non-negative cue index, then poll until it
    // advances (or 25s elapses). Cue 0 ends ~8.5s into scene 1, which
    // sits past the 4s title card; a 25s budget covers cold-start
    // audio buffering on slower CI.
    let firstIndex = -1;
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      const idx = Number(await caption.getAttribute('data-cue-index') ?? '-1');
      if (idx >= 0) { firstIndex = idx; break; }
      await page.waitForTimeout(200);
    }
    expect(firstIndex, 'first observed cue index should be non-negative').toBeGreaterThanOrEqual(0);

    let secondIndex = firstIndex;
    const t1 = Date.now();
    while (Date.now() - t1 < 30_000) {
      const idx = Number(await caption.getAttribute('data-cue-index') ?? '-1');
      if (idx > firstIndex) { secondIndex = idx; break; }
      await page.waitForTimeout(250);
    }
    expect(secondIndex, 'cue index must advance over time').toBeGreaterThan(firstIndex);

    // And the total cue count must be > 1 — proves the scene narration
    // actually decomposed into multiple sentences (not "splits but only
    // ever produces one giant cue").
    const total = Number(await caption.getAttribute('data-cue-total') ?? '0');
    expect(total, 'narration should split into multiple cues').toBeGreaterThan(1);
  });
});
