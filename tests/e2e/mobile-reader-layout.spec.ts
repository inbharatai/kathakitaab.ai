import { test, expect, type Page } from '@playwright/test';

type MobileViewport = { name: string; width: number; height: number };

type ReaderScene = {
  id: string;
  sceneId: string;
  expectedTitle: RegExp;
};

const VIEWPORTS: MobileViewport[] = [
  { name: 'android-360x740', width: 360, height: 740 },
  { name: 'android-390x844', width: 390, height: 844 },
  { name: 'iphone-393x852', width: 393, height: 852 },
];

const SCENES: ReaderScene[] = [
  { id: 'ayodhya', sceneId: 'ayodhya_intro', expectedTitle: /The Princes of Ayodhya/i },
  { id: 'mithila', sceneId: 'mithila_bow', expectedTitle: /Sita and the Bow of Shiva/i },
  { id: 'ravana', sceneId: 'ravana_jatayu', expectedTitle: /Ravana.*Courage/i },
];

function boxesIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

for (const viewport of VIEWPORTS) {
  test.describe(`Mobile reader layout ${viewport.name}`, () => {
    test(`keeps full image, title readability, and controls usability across key scenes`, async ({ page }) => {
      test.setTimeout(120000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const scene of SCENES) {
        await page.goto(`/books/ramayana?scene=${scene.sceneId}`);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByRole('heading', { name: scene.expectedTitle }).first()).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2500);

        const sceneCard = page.locator('.scene-container').first();
        await expect(sceneCard).toBeVisible({ timeout: 15000 });

        // 1. No horizontal page overflow.
        await assertNoHorizontalOverflow(page);

        // 2. Scene card must stay within viewport width.
        const cardBox = await sceneCard.boundingBox();
        expect(cardBox).toBeTruthy();
        expect(cardBox!.width).toBeLessThanOrEqual(viewport.width);

        // 3. Mobile contain-fit mode must be active.
        await expect(sceneCard).toHaveAttribute('data-fit-mode', 'contain');

        // 4. Title must not overlap floating read controls.
        const title = page.getByRole('heading', { name: scene.expectedTitle }).first();
        await expect(title).toBeVisible();

        const readControl = page.locator(
          'button[aria-label="Read aloud"], button[aria-label="Stop narration"], button:has-text("Read"), button:has-text("Stop")'
        ).first();
        await expect(readControl).toBeVisible();

        const overlapCheck = await page.evaluate(() => {
          const titleEl = document.querySelector('h1.font-serif');
          const controlEl = document.querySelector('button[aria-label="Read aloud"], button[aria-label="Stop narration"]');
          if (!titleEl || !controlEl) return null;
          const t = titleEl.getBoundingClientRect();
          const c = controlEl.getBoundingClientRect();
          return {
            title: { x: t.x, y: t.y, width: t.width, height: t.height },
            control: { x: c.x, y: c.y, width: c.width, height: c.height },
          };
        });
        expect(overlapCheck).toBeTruthy();
        expect(boxesIntersect(overlapCheck!.title, overlapCheck!.control)).toBeFalsy();

        // 5. Story/Learn/Quiz + Read controls should remain usable.
        const storyButton = page.locator('.mode-tab', { hasText: /story/i }).first();
        const learnButton = page.locator('.mode-tab', { hasText: /learn/i }).first();
        const readToggle = page.locator('button', { hasText: /read|hide/i }).first();

        await expect(storyButton).toBeVisible();
        await expect(learnButton).toBeVisible();
        await expect(readToggle).toBeVisible();

        const modeRow = storyButton.locator('xpath=..').first();
        const rowMetrics = await modeRow.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return {
            rowLeft: rect.left,
            rowRight: rect.right,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          };
        });
        const storyMetrics = await storyButton.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        const learnMetrics = await learnButton.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });

        expect(storyMetrics.left).toBeGreaterThanOrEqual(rowMetrics.rowLeft - 1);
        expect(storyMetrics.right).toBeLessThanOrEqual(rowMetrics.rowRight + 1);
        expect(learnMetrics.left).toBeGreaterThanOrEqual(rowMetrics.rowLeft - 1);
        expect(learnMetrics.right).toBeLessThanOrEqual(rowMetrics.rowRight + 1);
        expect(rowMetrics.scrollWidth).toBeGreaterThanOrEqual(rowMetrics.clientWidth);

        await page.screenshot({
          path: `test-results/mobile-reader-after/${viewport.name}-${scene.id}.png`,
          fullPage: true,
        });
      }
    });
  });
}
