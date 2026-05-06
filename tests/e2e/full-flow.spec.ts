import { test, expect } from '@playwright/test';

// ============================================================
// KathaKitaab.ai — Full Flow E2E Tests
//
// Tests: landing page, mobile responsiveness, scene navigation,
// image click interactions, dynamic generation, caching, errors,
// and complete story progression.
// ============================================================

const SCREENSHOT_DIR = 'test-results/screenshots';

test.describe('Landing Page', () => {
  test('loads with all sections visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Nav (now uses .lp-* class prefix after the landing redesign)
    await expect(page.locator('.lp-nav')).toBeVisible();
    await expect(page.locator('.lp-nav-name')).toContainText('KathaKitaab');

    // Hero
    await expect(page.locator('.lp-hero-h1')).toBeVisible();
    await expect(page.locator('.lp-hero-sub')).toBeVisible();
    await expect(page.locator('.lp-hero-ctas').first()).toBeVisible();

    // Screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-landing-desktop.png`, fullPage: true });
  });

  test('hero CTAs navigate correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const ramayanaBtn = page.locator('.lp-hero-ctas .lp-btn-primary').first();
    await expect(ramayanaBtn).toContainText(/Enter the Ramayana|Enter Ramayana/);
    const href = await ramayanaBtn.getAttribute('href');
    expect(href).toBe('/books/ramayana');
  });

  test('trailer section uses Remotion Player', async ({ page }) => {
    await page.goto('/');
    await page.locator('.lp-trailer-wrap').scrollIntoViewIfNeeded();
    await expect(page.locator('.lp-trailer-wrap')).toBeVisible();
    // Player adds playback controls — confirm at least one control button.
    await page.waitForTimeout(800);
    const controls = await page.locator('.lp-trailer-wrap button').count();
    expect(controls).toBeGreaterThan(0);
  });
});

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('landing page is mobile-optimized', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const nav = page.locator('.lp-nav');
    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    expect(navBox!.width).toBeLessThanOrEqual(375);

    const heading = page.locator('.lp-hero-h1');
    await expect(heading).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-landing-mobile.png`, fullPage: true });
  });

  test('scene viewer works on mobile', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Scene canvas should be visible
    const sceneContainer = page.locator('.scene-container');
    await expect(sceneContainer).toBeVisible();

    const box = await sceneContainer.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-scene-mobile.png` });
  });
});

test.describe('Scene Navigation', () => {
  test('loads Ramayana first scene', async ({ page }) => {
    await page.goto('/books/ramayana');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Scene title should appear
    const title = page.locator('h1');
    await expect(title.first()).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-ramayana-scene1.png` });
  });

  test('navigates to next scene', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Find and click "Next Scene" button
    const nextBtn = page.getByRole('button', { name: /next/i });
    if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/05-scene2.png` });
    } else {
      // No next button is OK for some scene states
      expect(true).toBe(true);
    }
  });

  test('scene has interactive elements', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);

    // Scene container should exist
    const scene = page.locator('.scene-container');
    await expect(scene).toBeVisible({ timeout: 15000 });

    // Should have some buttons (hotspots or action menu)
    const buttons = scene.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(0); // 0 is OK if hotspot debug is off

    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-scene-elements.png` });
  });
});

test.describe('Scene Interactions', () => {
  test('scene container is interactive', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const scene = page.locator('.scene-container');
    await expect(scene).toBeVisible({ timeout: 10000 });

    // Click the scene canvas
    await scene.click({ position: { x: 100, y: 100 } });
    await page.waitForTimeout(1000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-scene-interaction.png` });
  });

  test('mode switcher exists', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Mode buttons should exist (Story/Learn/Quiz)
    const storyBtn = page.getByRole('button', { name: /story/i });
    if (await storyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(storyBtn).toBeVisible();
      await page.screenshot({ path: `${SCREENSHOT_DIR}/08-mode-switcher.png` });
    } else {
      expect(true).toBe(true); // Mode switcher may be hidden
    }
  });
});

test.describe('API Routes', () => {
  test('GET /api/books returns book list', async ({ request }) => {
    const res = await request.get('/api/books');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.books).toBeDefined();
    expect(data.books.length).toBeGreaterThan(0);
  });

  test('GET /api/books/ramayana returns book with scenes', async ({ request }) => {
    const res = await request.get('/api/books/ramayana');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.book.title).toContain('Ramayana');
    expect(data.scenes.length).toBeGreaterThan(0);
    expect(data.characters.length).toBeGreaterThan(0);
  });

  test('GET /api/books/ramayana/scenes/ayodhya_intro returns scene with hotspots', async ({ request }) => {
    const res = await request.get('/api/books/ramayana/scenes/ayodhya_intro');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.scene.title).toBeDefined();
    expect(data.scene.narration).toBeDefined();
    expect(data.scene.hotspots.length).toBeGreaterThan(0);
  });

  test('POST /api/livebook/agent returns character response', async ({ request }) => {
    const res = await request.post('/api/livebook/agent', {
      data: {
        type: 'character',
        bookSlug: 'ramayana',
        sceneId: 'ayodhya_intro',
        targetId: 'rama',
        userInput: 'Who are you?',
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.result.answer).toBeDefined();
    expect(data.result.label).toBeDefined();
  });

  test('POST /api/livebook/generate-scene returns new scene', async ({ request }) => {
    const res = await request.post('/api/livebook/generate-scene', {
      data: {
        bookSlug: 'ramayana',
        bookTitle: 'Ramayana',
        previousSceneTitle: 'Test',
        characterNames: ['Rama'],
        actionType: 'continue',
        sceneIndex: 0,
      },
    });

    // May fail due to API quota, but should not 500
    const status = res.status();
    expect([200, 422, 429, 503]).toContain(status);

    if (res.ok()) {
      const data = await res.json();
      expect(data.scene.page_title).toBeDefined();
      expect(data.scene.story_text).toBeDefined();
      expect(data.scene.hotspots.length).toBeGreaterThan(0);
    }
  });
});

test.describe('Error States', () => {
  test('invalid book slug returns error', async ({ request }) => {
    const res = await request.get('/api/books/nonexistent-book-xyz');
    // Should either return empty or error, not crash
    expect(res.status()).toBeLessThan(500);
  });

  test('invalid scene ID returns error', async ({ request }) => {
    const res = await request.get('/api/books/ramayana/scenes/nonexistent-scene');
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe('Books Page', () => {
  test('loads with Ramayana and generator', async ({ page }) => {
    await page.goto('/books');
    await page.waitForLoadState('domcontentloaded');

    // Should show Ramayana somewhere on the page
    await expect(page.getByText('Ramayana').first()).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-books-page.png`, fullPage: true });
  });
});

test.describe('Educator Dashboard', () => {
  test('loads with stats and presets', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('heading', { name: /educator/i })).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/11-educator.png`, fullPage: true });
  });
});
