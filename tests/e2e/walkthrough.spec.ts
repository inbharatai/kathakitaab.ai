// ============================================================
// A-to-Z human-paced walkthrough.
// Each step waits for things to settle and snaps a screenshot
// into test-results/walkthrough/ for a vision review.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'test-results', 'walkthrough');
mkdirSync(OUT_DIR, { recursive: true });

async function snap(page: Page, name: string) {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  // eslint-disable-next-line no-console
  console.log(`[snap] ${name} → ${path}`);
}

test.describe.serial('KathaKitaab a-to-z walkthrough', () => {
  test.setTimeout(300_000); // 5 minutes — image generation is slow

  test('1. landing page loads', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await snap(page, '01-landing');

    // sanity — a logo or hero title should be visible
    const body = await page.textContent('body');
    expect(body?.length ?? 0).toBeGreaterThan(100);
  });

  test('2. books library', async ({ page }) => {
    await page.goto('/books');
    await page.waitForLoadState('networkidle');
    await snap(page, '02-books');
  });

  test('3. ramayana scene loads', async ({ page }) => {
    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');

    // Wait for the scene canvas image to actually appear.
    // The first scene fetches /api/books/ramayana/scenes/ayodhya_intro
    // and then renders an <img> on the page.
    await page.waitForTimeout(2_000);
    await snap(page, '03a-ramayana-loaded');

    // Wait for the background image inside SceneCanvas
    const sceneImg = page.locator('img').filter({ hasText: '' }).first();
    try {
      await sceneImg.waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      // not fatal — proceed and let the screenshot speak
    }
    await page.waitForTimeout(1_000);
    await snap(page, '03b-ramayana-image');
  });

  test('4. top control bar — music slider reveals', async ({ page }) => {
    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2_000);

    // Music button has aria-label="Music volume". Click reveals slider.
    const musicBtn = page.getByRole('button', { name: 'Music volume' }).first();
    if (await musicBtn.count() > 0) {
      await musicBtn.click();
      await page.waitForTimeout(500);
      await snap(page, '04-music-slider-open');
    } else {
      await snap(page, '04-music-slider-not-found');
    }
  });

  test('5. click a hotspot → branch view', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });

    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3_000);

    // SceneCanvas paints the background as a CSS backgroundImage on a
    // <div>, then layers <motion.button aria-label="..."> hotspots above
    // it. The fixed top-right pill also has aria-labelled buttons —
    // those are NOT hotspots, so we skip them by counting from index 3.
    await page.waitForTimeout(2_000); // give SceneCanvas time to paint
    const hotspots = page.locator('main button[aria-label], [class*="book-page"] button[aria-label]');
    const hotspotCount = await hotspots.count();
    // eslint-disable-next-line no-console
    console.log(`[walkthrough] found ${hotspotCount} hotspot candidates`);

    await snap(page, '05a-before-hotspot-click');

    if (hotspotCount > 3) {
      await hotspots.nth(3).click({ force: true });
    } else {
      // Fallback: click roughly in the centre of the page to hit the canvas
      const vp = page.viewportSize();
      if (vp) await page.mouse.click(vp.width * 0.5, vp.height * 0.5);
    }

    // Hotspot click opens the ActionMenu. Click "Ask" to trigger an
    // entity-interact branch (Continue advances the scene instead).
    await page.waitForTimeout(800);
    const askBtn = page.getByRole('button', { name: /^ask$/i }).first();
    if (await askBtn.count() > 0) {
      await askBtn.click({ force: true });
    }

    await page.waitForTimeout(1_500);
    await snap(page, '05b-branch-loading');

    // Wait for the spinner to disappear (it disappears once activeBranch is
    // set and we drop the loading state). "Exploring..." is the spinner text.
    try {
      await page.waitForFunction(() => !/exploring\.\.\./i.test(document.body.innerText || ''), { timeout: 60_000 });
    } catch { /* screenshot will show the state */ }

    await page.waitForTimeout(2_000);
    await snap(page, '05c-branch-text');

    // Wait for image to swap in (placeholder text disappears).
    try {
      await page.waitForFunction(() => !/painting the scene/i.test(document.body.innerText || ''), { timeout: 60_000 });
    } catch { /* */ }

    await page.waitForTimeout(1_000);
    await snap(page, '05d-branch-image');

    // Surface any browser-side errors so the test report is honest.
    if (consoleErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[walkthrough] browser issues:\n' + consoleErrors.slice(0, 10).join('\n'));
    }
  });

  test('6. back button returns to scene', async ({ page }) => {
    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4_000);

    const hotspots = page.locator('main button[aria-label], [class*="book-page"] button[aria-label]');
    if (await hotspots.count() > 3) {
      await hotspots.nth(3).click({ force: true });
    } else {
      const vp = page.viewportSize();
      if (vp) await page.mouse.click(vp.width * 0.5, vp.height * 0.45);
    }

    // Click Ask in the action menu so the entity-interact branch fires.
    await page.waitForTimeout(800);
    const askBtn = page.getByRole('button', { name: /^ask$/i }).first();
    if (await askBtn.count() > 0) {
      await askBtn.click({ force: true });
    }

    await page.waitForTimeout(12_000); // narration ships within ~5-7s; allow margin
    await snap(page, '06a-branch-active');

    const backBtn = page.getByRole('button', { name: /back/i }).first();
    if (await backBtn.count() > 0) {
      await backBtn.click();
      await page.waitForTimeout(1_000);
    }
    await snap(page, '06b-back-to-scene');
  });

  test('7. mobile viewport sanity', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2_500);
    await snap(page, '07-mobile');
  });
});
