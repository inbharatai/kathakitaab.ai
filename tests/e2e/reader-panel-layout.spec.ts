import { test, expect, type Page } from '@playwright/test';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function mockEntityInteract(page: Page) {
  await page.route('**/api/livebook/entity-interact', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'Rama speaks of duty',
        narration: 'Rama stood tall beneath the ancient banyan, his voice steady as the mountain wind. "Duty is not a burden, Lakshmana. It is the thread that weaves us into the fabric of dharma."',
        imageUrl: null,
        imagePrompt: '',
        imageStatus: 'none',
        nextActions: ['Ask about dharma', 'What happens next?', 'Return to scene'],
      }),
    });
  });
}

async function assertInteractionPanelOutsideScene(page: Page) {
  const sceneWrapper = page.locator('[data-testid="scene-wrapper"]').first();
  const interactionPanel = page.locator('[data-testid="interaction-panel"]').first();

  await expect(sceneWrapper).toBeVisible();
  await expect(interactionPanel).toBeVisible();

  // The interaction panel must NOT be a descendant of the scene wrapper.
  const panelIsInsideScene = await page.evaluate(() => {
    const scene = document.querySelector('[data-testid="scene-wrapper"]');
    const panel = document.querySelector('[data-testid="interaction-panel"]');
    if (!scene || !panel) return null;
    return scene.contains(panel);
  });
  expect(panelIsInsideScene).toBe(false);
}

async function clickHotspotAndOpenBranch(page: Page) {
  // Rama hotspot should exist in the Ramayana ayodhya_intro scene.
  const hotspot = page.locator('[data-testid="hotspot-rama"]').first();
  await expect(hotspot).toBeVisible({ timeout: 10_000 });
  await hotspot.click();

  // Action menu opens.
  const talkButton = page.locator('[data-testid="action-talk"]').first();
  await expect(talkButton).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await talkButton.click({ force: true });

  // Branch panel appears.
  const branchTitle = page.locator('text=Rama speaks of duty').first();
  await expect(branchTitle).toBeVisible({ timeout: 10_000 });
}

test.describe('Reader Panel Layout Regression', () => {
  test.beforeEach(async ({ page }) => {
    await mockEntityInteract(page);
  });

  test('desktop — scene image stays visible, interaction panel renders below it', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');

    await clickHotspotAndOpenBranch(page);

    // Scene wrapper must remain visible and unobscured.
    await assertInteractionPanelOutsideScene(page);

    // Interaction panel must sit below the scene wrapper (higher Y coordinate).
    const sceneBox = await page.locator('[data-testid="scene-wrapper"]').first().boundingBox();
    const panelBox = await page.locator('[data-testid="interaction-panel"]').first().boundingBox();
    expect(sceneBox).toBeTruthy();
    expect(panelBox).toBeTruthy();
    expect(panelBox!.y).toBeGreaterThanOrEqual(sceneBox!.y + sceneBox!.height - 10);
  });

  test('mobile — image stacks first, interaction panel below, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');

    await clickHotspotAndOpenBranch(page);

    await assertInteractionPanelOutsideScene(page);

    // Vertical stack: panel must be below scene.
    const sceneBox = await page.locator('[data-testid="scene-wrapper"]').first().boundingBox();
    const panelBox = await page.locator('[data-testid="interaction-panel"]').first().boundingBox();
    expect(sceneBox).toBeTruthy();
    expect(panelBox).toBeTruthy();
    expect(panelBox!.y).toBeGreaterThanOrEqual(sceneBox!.y + sceneBox!.height - 10);

    // No horizontal overflow.
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  });

  test('hotspot buttons remain clickable after returning from branch', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');

    await clickHotspotAndOpenBranch(page);

    // Close branch.
    const backButton = page.locator('button[aria-label="Back to scene"]').first();
    await expect(backButton).toBeVisible();
    await backButton.click({ force: true });
    await page.waitForTimeout(600);

    // Branch should disappear.
    await expect(page.locator('text=Rama speaks of duty').first()).not.toBeVisible({ timeout: 8_000 });

    // Hotspot must remain clickable.
    const hotspot = page.locator('[data-testid="hotspot-rama"]').first();
    await expect(hotspot).toBeVisible({ timeout: 5_000 });
    await hotspot.click();

    const talkButton = page.locator('[data-testid="action-talk"]').first();
    await expect(talkButton).toBeVisible({ timeout: 5_000 });
  });
});
