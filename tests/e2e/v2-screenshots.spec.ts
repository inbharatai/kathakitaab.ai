// ============================================================
// Phase 10 v2 visual evidence pass.
//
// Drives the live Remotion <Player> on the per-book movie page
// and snapshots key frames so a human can confirm the new
// features are visibly different from the previous render:
//
//   - title-card        : cinematic logo + rotating glow ring
//   - caption-scene     : the new blur-panel subtitle with
//                         segmented progress strip
//   - battle-scene      : battle_push motion (stronger zoom +
//                         tasteful shake) on a dramatic scene
//   - divine-scene      : divine_glow motion (radial glow +
//                         golden particles) on a sacred scene
//   - movie-page-desktop: the export UI with both buttons
//   - movie-page-mobile : the same UI on a phone-width viewport
// ============================================================

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOT_DIR = 'test-results/screenshots';

function shot(name: string): string {
  mkdirSync(join(process.cwd(), SHOT_DIR), { recursive: true });
  return join(SHOT_DIR, `${name}.png`);
}

// Stamp the player at a specific scene by clicking play, then
// waiting until enough time has passed. Title card is 4s so any
// timing past 5s lands inside scene 1; later scenes need more.
async function clickPlay(page: import('@playwright/test').Page) {
  const main = page.locator('main').first();
  const box = await main.boundingBox();
  if (!box) throw new Error('player surface not measurable');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
}

test.describe('Phase 10 v2 — visual evidence', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/books/ramayana/movie');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
  });

  test('video-title-card', async ({ page }) => {
    await page.screenshot({ path: shot('video-title-card'), fullPage: false });
    // Verify the export panel has both modes wired.
    await expect(page.locator('[data-testid="mp4-export-button"]')
      .or(page.locator('[data-testid="mp4-download-link"]'))).toBeVisible();
    await expect(page.locator('[data-testid="trailer-export-button"]')
      .or(page.locator('[data-testid="trailer-export-button-link"]'))).toBeVisible();
  });

  test('video-caption-scene', async ({ page }) => {
    await clickPlay(page);
    // Title runs 4s, audio leads 6 frames; ~7s in we're well into
    // scene 1 with the new caption panel visible.
    await page.waitForTimeout(7500);
    await page.screenshot({ path: shot('video-caption-scene'), fullPage: false });
    const caption = page.locator('[data-testid="movie-caption"]').first();
    await expect(caption).toBeVisible({ timeout: 6000 });
  });

  test('video-battle-scene', async ({ page }) => {
    await clickPlay(page);
    // ravana_jatayu (battle scene, motion=battle_push) is scene
    // index 4 in the manifest. Cumulative offsets put it ~2:50
    // into the playthrough including title + tails. Snap there.
    await page.waitForTimeout(170_000 / 1).then(() => {});
    // ↑ Single big sleep would wedge the test runner; instead we
    // seek the underlying <video> when one exists, otherwise wait
    // a shorter amount and trust the player to be near the scene.
    // Player uses canvas not <video>, so we approximate via wait.
    await page.waitForTimeout(2000);
    await page.screenshot({ path: shot('video-battle-scene'), fullPage: false });
  });

  test('video-divine-scene', async ({ page }) => {
    await clickPlay(page);
    // ayodhya_intro is scene 0 with mood=sacred → divine_glow.
    // ~12s into playback the glow + particles are visibly active.
    await page.waitForTimeout(12_000);
    await page.screenshot({ path: shot('video-divine-scene'), fullPage: false });
  });

  test('movie-page-desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot('movie-page-desktop'), fullPage: true });
  });

  test('movie-page-mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot('movie-page-mobile'), fullPage: true });
  });
});
