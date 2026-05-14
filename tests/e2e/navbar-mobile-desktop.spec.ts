import { test, expect, type Page } from '@playwright/test';

const MOBILE_VIEWPORTS = [
  { name: 'android-360x740', width: 360, height: 740 },
  { name: 'android-390x844', width: 390, height: 844 },
  { name: 'iphone-430x932', width: 430, height: 932 },
];

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

async function assertNavItemsVisible(page: Page) {
  const stories = page.locator('nav .lp-nav-pill-saffron').first();
  const studio = page.locator('nav .lp-nav-pill-white').first();
  const signin = page.locator('nav .lp-nav-pill-signin').first();

  await expect(stories).toBeVisible({ timeout: 5000 });
  await expect(studio).toBeVisible({ timeout: 5000 });
  await expect(signin).toBeVisible({ timeout: 5000 });

  // Ensure tap targets meet 44px minimum
  for (const locator of [stories, studio, signin]) {
    const box = await locator.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
}

async function assertEnterRamayanaRemovedFromNav(page: Page) {
  const nav = page.locator('nav').first();
  const html = (await nav.innerHTML()).toLowerCase();
  expect(html).not.toContain('enter ramayana');
}

async function assertHeroCtaPresent(page: Page) {
  const heroCta = page.locator('.lp-hero a', { hasText: /Enter the Ramayana/i }).first();
  await expect(heroCta).toBeVisible({ timeout: 5000 });
}

test.describe('Navbar — desktop', () => {
  test('shows Stories, Studio, Sign in and hides Enter Ramayana without overflow', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await assertNavItemsVisible(page);
    await assertEnterRamayanaRemovedFromNav(page);
    await assertHeroCtaPresent(page);
    await assertNoHorizontalOverflow(page);

    // Header must not overlap hero badge
    const nav = page.locator('nav').first();
    const badge = page.locator('.lp-hero-badge').first();
    const navBox = await nav.boundingBox();
    const badgeBox = await badge.boundingBox();
    expect(navBox).toBeTruthy();
    expect(badgeBox).toBeTruthy();
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(badgeBox!.y + 2); // allow 2px sub-pixel
  });
});

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`Navbar — mobile ${viewport.name}`, () => {
    test('shows Stories, Studio, Sign in and hides Enter Ramayana without overflow', async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      await assertNavItemsVisible(page);
      await assertEnterRamayanaRemovedFromNav(page);
      await assertHeroCtaPresent(page);
      await assertNoHorizontalOverflow(page);

      // Header must not overlap hero badge
      const nav = page.locator('nav').first();
      const badge = page.locator('.lp-hero-badge').first();
      const navBox = await nav.boundingBox();
      const badgeBox = await badge.boundingBox();
      expect(navBox).toBeTruthy();
      expect(badgeBox).toBeTruthy();
      expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(badgeBox!.y + 2);

      await page.screenshot({
        path: `test-results/navbar-mobile/${viewport.name}.png`,
        fullPage: false,
      });
    });
  });
}
