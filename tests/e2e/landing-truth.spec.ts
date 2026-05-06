// ============================================================
// Phase A regression: the landing page must not promise things
// the engine can't deliver. We had hyperbole like "Click any
// character. Ask any object. Click anywhere." which the actual
// click model doesn't honor (only highlighted hotspots respond
// directly; arbitrary clicks fall through to a classifier).
//
// This test pins the truth-first phrasing so future copy edits
// don't quietly slip back into overpromising.
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Landing copy — truth-first guarantee', () => {
  test('hero subhead names highlighted hotspots, not "any character"', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // The subhead must explicitly call out highlighted hotspots — that's
    // the actual interaction model. The bare "any character / any object"
    // language was the regression we fixed in Phase A.
    const heroSubhead = page.getByText(/highlighted characters and objects/i).first();
    await expect(heroSubhead).toBeVisible({ timeout: 5_000 });
  });

  test('the comparison table no longer claims "ask anything" magic', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Pin the post-Phase-A bullets that describe actual capabilities.
    // The phrase appears twice on v2 (demo subtitle + comparison row),
    // so target the first match — what we're regressing is "this phrase
    // exists on the landing page", not "exists exactly once".
    await expect(page.getByText('Highlighted characters and objects respond on click').first()).toBeVisible();
    await expect(page.getByText(/AI generates a fresh branch the first time, caches it after/i)).toBeVisible();
  });

  test('hero copy never contains the legacy hyperbolic promises', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const html = (await page.content()).toLowerCase();

    // None of these phrases should appear anywhere on the page.
    // Each was a documented overpromise that a careful reader could
    // have called us on. The list grows whenever we strike new claims.
    const banned = [
      'click any character. ask any object',
      'ask any object. click anywhere',
      'every page reads itself',
    ];
    for (const phrase of banned) {
      expect(html, `landing page contains banned phrase: "${phrase}"`).not.toContain(phrase);
    }
  });
});
