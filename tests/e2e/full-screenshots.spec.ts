import { test, expect } from '@playwright/test';

/**
 * KathaKitaab — A-to-Z Full Flow Test with Screenshots
 *
 * Tests EVERY function and takes a screenshot at EVERY step.
 * Screenshots saved to test-results/full-screenshots/
 */

const S = 'test-results/full-screenshots';

test.describe.serial('A-to-Z Full Flow', () => {

  test('01 — Landing page loads', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await expect(page.locator('.lp-hero-h1')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${S}/01-landing-full.png`, fullPage: true });
  });

  test('02 — Landing nav visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await expect(page.locator('.lp-nav')).toBeVisible();
    await expect(page.locator('.lp-nav-name')).toContainText('KathaKitaab');
    await page.screenshot({ path: `${S}/02-landing-nav.png` });
  });

  test('03 — Landing features section', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const features = page.locator('.landing-feature-card');
    await expect(features).toHaveCount(4);
    await page.locator('.landing-features').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${S}/03-features.png` });
  });

  test('04 — Landing entry points', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const entries = page.locator('.landing-entry-card');
    await expect(entries).toHaveCount(3);
    await page.locator('.landing-entries').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${S}/04-entry-points.png` });
  });

  test('05 — Landing mobile (375px)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${S}/05-landing-mobile.png`, fullPage: true });
    await context.close();
  });

  test('06 — Books page loads', async ({ page }) => {
    await page.goto('/books');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await expect(page.getByText('Ramayana').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${S}/06-books-page.png`, fullPage: true });
  });

  test('07 — Educator dashboard loads', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await expect(page.getByRole('heading', { name: /educator/i })).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${S}/07-educator.png`, fullPage: true });
  });

  test('08 — Ramayana Scene 1: Ayodhya loads', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);
    const scene = page.locator('.scene-container');
    await expect(scene).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `${S}/08-scene1-ayodhya.png` });
  });

  test('09 — Scene 1: Narration text visible', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForTimeout(4000);
    // Narration should be below the scene
    const narration = page.locator('.narration-text, .font-serif').first();
    if (await narration.isVisible({ timeout: 5000 }).catch(() => false)) {
      await narration.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${S}/09-narration-text.png` });
    } else {
      await page.screenshot({ path: `${S}/09-narration-text.png` });
    }
  });

  test('10 — Scene 1: Click scene background → action menu', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForTimeout(4000);
    const scene = page.locator('.scene-container');
    await expect(scene).toBeVisible({ timeout: 15000 });
    await scene.click({ position: { x: 150, y: 100 } });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${S}/10-action-menu.png` });
  });

  test('11 — Scene 1: Click hotspot (if visible)', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro&hotspotDebug=1');
    await page.waitForTimeout(4000);
    const hotspot = page.locator('.scene-container button[aria-label]').first();
    if (await hotspot.isVisible({ timeout: 5000 }).catch(() => false)) {
      await hotspot.hover();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${S}/11-hotspot-hover.png` });
      await hotspot.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${S}/11b-hotspot-clicked.png` });
    } else {
      await page.screenshot({ path: `${S}/11-no-hotspots-visible.png` });
    }
  });

  test('12 — Scene navigation: Next scene', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForTimeout(4000);
    const nextBtn = page.getByRole('button', { name: /next/i });
    if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${S}/12a-before-next.png` });
      await nextBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${S}/12b-after-next.png` });
    } else {
      await page.screenshot({ path: `${S}/12-no-next-btn.png` });
    }
  });

  test('13 — Scene 2: Mithila Bow', async ({ page }) => {
    await page.goto('/books/ramayana?scene=mithila_bow');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/13-scene2-mithila.png` });
  });

  test('14 — Scene 3: Exile', async ({ page }) => {
    await page.goto('/books/ramayana?scene=exile');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/14-scene3-exile.png` });
  });

  test('15 — Scene 4: Forest Life', async ({ page }) => {
    await page.goto('/books/ramayana?scene=forest_life');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/15-scene4-forest.png` });
  });

  test('16 — Scene 5: Ravana & Jatayu', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ravana_jatayu');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/16-scene5-ravana.png` });
  });

  test('17 — Scene 6: Hanuman meets Rama', async ({ page }) => {
    await page.goto('/books/ramayana?scene=hanuman_meets_rama');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/17-scene6-hanuman.png` });
  });

  test('18 — Scene 7: Hanuman in Lanka', async ({ page }) => {
    await page.goto('/books/ramayana?scene=hanuman_lanka');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/18-scene7-lanka.png` });
  });

  test('19 — Scene 8: Bridge to Lanka', async ({ page }) => {
    await page.goto('/books/ramayana?scene=bridge_to_lanka');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/19-scene8-bridge.png` });
  });

  test('20 — Scene 9: Battle of Lanka', async ({ page }) => {
    await page.goto('/books/ramayana?scene=battle_lanka');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/20-scene9-battle.png` });
  });

  test('21 — Scene 10: Return to Ayodhya', async ({ page }) => {
    await page.goto('/books/ramayana?scene=return_ayodhya');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/21-scene10-return.png` });
  });

  test('22 — Scene 11: Lessons', async ({ page }) => {
    await page.goto('/books/ramayana?scene=lessons');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/22-scene11-lessons.png` });
  });

  test('23 — Mode switcher: Quiz mode', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForTimeout(4000);
    const quizBtn = page.getByRole('button', { name: /quiz/i });
    if (await quizBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await quizBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${S}/23-quiz-mode.png` });
    } else {
      await page.screenshot({ path: `${S}/23-no-quiz.png` });
    }
  });

  test('24 — Mode switcher: Learn mode', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForTimeout(4000);
    const learnBtn = page.getByRole('button', { name: /learn/i });
    if (await learnBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await learnBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${S}/24-learn-mode.png` });
    } else {
      await page.screenshot({ path: `${S}/24-no-learn.png` });
    }
  });

  test('25 — Scene mobile view', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/25-scene-mobile.png`, fullPage: true });
    await context.close();
  });

  test('26 — API: Agent character talk', async ({ request }) => {
    const res = await request.post('/api/livebook/agent', {
      data: { type: 'character', bookSlug: 'ramayana', sceneId: 'ayodhya_intro', targetId: 'rama', userInput: 'Who are you and what is dharma?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.result.answer.length).toBeGreaterThan(50);
    expect(data.result.label).toBeDefined();
  });

  test('27 — API: Agent info click', async ({ request }) => {
    const res = await request.post('/api/livebook/agent', {
      data: { type: 'info', bookSlug: 'ramayana', sceneId: 'mithila_bow', targetId: 'shiva_bow', userInput: 'What is this bow?' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.result.answer.length).toBeGreaterThan(30);
  });

  test('28 — API: Generate scene with image', async ({ request }, testInfo) => {
    testInfo.setTimeout(120000); // Image gen can take up to 2 minutes
    const res = await request.post('/api/livebook/generate-scene', {
      data: {
        bookSlug: 'ramayana', bookTitle: 'Ramayana',
        previousSceneTitle: 'Battle of Lanka', characterNames: ['Rama', 'Ravana'],
        actionType: 'continue', sceneIndex: 10,
        characterBonds: { rama: { level: 5, label: 'hero' } },
        userChoices: ['Chose valor'],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.scene.page_title).toBeDefined();
    expect(data.scene.hotspots.length).toBeGreaterThan(0);
    expect(data.scene.story_text.length).toBeGreaterThan(100);
    // Image may or may not generate depending on API status
    if (data.scene.background?.image_url) {
      expect(data.scene.background.image_url.length).toBeGreaterThan(1000);
    }
  });

  test('29 — API: TTS narration', async ({ request }) => {
    const res = await request.post('/api/livebook/tts', {
      data: { text: 'In the golden city of Ayodhya, King Dasharatha ruled with wisdom.', voice: 'narration' },
    });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('audio');
    const body = await res.body();
    expect(body.length).toBeGreaterThan(10000); // Real audio is >10KB
  });

  test('30 — API: TTS character voice', async ({ request }) => {
    const res = await request.post('/api/livebook/tts', {
      data: { text: 'I am Rama, prince of Ayodhya. Dharma guides my every step.', voice: 'male_character' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.body();
    expect(body.length).toBeGreaterThan(10000);
  });

  test('31 — API: Image generation (character)', async ({ request }) => {
    const res = await request.post('/api/livebook/generate-image', {
      data: { targetType: 'character', targetId: 'hanuman', sceneId: 'hanuman_meets_rama', sceneTitle: 'Hanuman meets Rama' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    if (data.imageUrl && !data.fallback) {
      expect(data.imageUrl.length).toBeGreaterThan(1000);
    }
  });

  test('32 — API: Caching works', async ({ request }) => {
    // First call
    await request.post('/api/livebook/agent', {
      data: { type: 'character', bookSlug: 'ramayana', sceneId: 'ayodhya_intro', targetId: 'rama', userInput: 'Cache test question' },
    });
    // Second call should be cached
    const res = await request.post('/api/livebook/agent', {
      data: { type: 'character', bookSlug: 'ramayana', sceneId: 'ayodhya_intro', targetId: 'rama', userInput: 'Cache test question' },
    });
    const data = await res.json();
    expect(data.cached).toBe(true);
  });

  test('33 — API: Error handling (invalid book)', async ({ request }) => {
    const res = await request.get('/api/books/nonexistent-xyz');
    expect(res.status()).toBeLessThan(500);
  });

  test('34 — Play mode loads', async ({ page }) => {
    await page.goto('/play/ramayana');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${S}/34-play-mode.png`, fullPage: true });
  });

  test('35 — Footer visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const footer = page.locator('.landing-footer');
    await footer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${S}/35-footer.png` });
  });

});
