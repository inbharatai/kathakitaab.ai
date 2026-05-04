// Probe: open Rama's hotspot menu, dump button labels.
import { test, expect } from '@playwright/test';

test('Rama hotspot shows canon-locked actions', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/books/ramayana');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Find Rama's hotspot specifically by aria-label
  const ramaHotspot = page.locator('button[aria-label*="Rama" i]').first();
  await ramaHotspot.click({ force: true });
  await page.waitForTimeout(800);

  // Capture menu button labels
  const buttons = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'));
    // Filter to action menu buttons only — they live in a popup
    const candidates = all.filter(b => {
      const t = (b.textContent || '').trim();
      return /^(Talk|Move|Change|Continue|Ask|Inspect|Animate|Leap|Fight|Confront|Observe|Comfort|Guard|Counsel|Ally|Learn|Petition|Honor|Follow)$/i.test(t);
    });
    return candidates.map(b => (b.textContent || '').trim());
  });

  console.log('[menu-probe] action buttons:', buttons);
  await page.screenshot({ path: 'test-results/probe-menu.png', fullPage: false });

  // Rama's canon: ['talk', 'move', 'continue']. Tight assertion — the
  // menu must match the canon exactly (no extra Change/Inspect leaking
  // in from the default character menu).
  expect(buttons.sort()).toEqual(['Continue', 'Move', 'Talk']);
});
