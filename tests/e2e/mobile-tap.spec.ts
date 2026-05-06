// ============================================================
// Phase F regression on mobile.
//
// The hotspot click model has to work under iOS's tap event chain
// (no hover, touchstart-driven). When Phase F added the parallax
// wrapper around the canvas we wanted to confirm it doesn't swallow
// touch events. Run only under the Mobile Safari project so the
// test sees `(hover: none)` and the touch heuristics in SceneCanvas.
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Mobile hotspot tap', () => {
  test.skip(({ browserName, isMobile }) => browserName !== 'webkit' || !isMobile, 'mobile-only spec');
  test.setTimeout(90_000);

  test('tapping Rama opens the action menu on touch devices', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');

    // On mobile, the scene canvas may load below the fold or behind a
    // loading skeleton — wait for the hotspot to be attached, scroll it
    // into view, then verify visibility.
    const ramaHotspot = page.locator('[data-testid="hotspot-rama"]').first();
    await ramaHotspot.waitFor({ state: 'attached', timeout: 30_000 });
    await ramaHotspot.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await expect(ramaHotspot).toBeVisible({ timeout: 15_000 });

    // tap() on Mobile Safari emits the full touch sequence. If the
    // parallax wrapper is intercepting these (z-index / overflow regression),
    // the action menu won't appear and the test fails.
    await ramaHotspot.tap();

    const talkButton = page.locator('[data-testid="action-talk"]').first();
    await expect(talkButton).toBeVisible({ timeout: 5_000 });
  });
});
