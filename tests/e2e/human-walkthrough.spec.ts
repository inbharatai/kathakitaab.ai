// ============================================================
// "Click through it like a human would" walkthrough.
//
// Captures a screenshot at every meaningful waypoint into
// test-results/walkthrough/ — read them after the run to
// eyeball the actual visual state. The assertions are
// intentionally lenient (mostly visibility) so the spec
// surfaces *visual* bugs the strict specs would miss
// (mis-aligned overlays, stuck spinners, wrong mood, etc.)
// rather than redoing what the targeted specs already cover.
// ============================================================

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOT_DIR = 'test-results/human-walkthrough';

function shotPath(name: string): string {
  mkdirSync(join(process.cwd(), SHOT_DIR), { recursive: true });
  return join(SHOT_DIR, `${name}.png`);
}

test.describe('Ramayana — full human walkthrough with screenshots', () => {
  test.setTimeout(5 * 60_000);

  test('landing → reader → branch → next scene → movie → export', async ({ page }) => {
    // ── 1. Landing ──────────────────────────────────────────
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: shotPath('01-landing-top'), fullPage: false });

    // The hero subhead must reflect the truth-first phrasing.
    await expect(page.getByText(/highlighted characters and objects/i).first())
      .toBeVisible({ timeout: 10_000 });

    // Scroll to comparison section and capture.
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(800);
    await page.screenshot({ path: shotPath('02-landing-mid'), fullPage: false });

    // Scroll to the bottom and capture the full narrative arc.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    await page.screenshot({ path: shotPath('03-landing-bottom'), fullPage: false });

    // ── 2. Enter the reader ─────────────────────────────────
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    await page.waitForLoadState('domcontentloaded');

    // Wait for at least one hotspot to mount — that's the proof
    // SceneCanvas finished its first render.
    await page.locator('[data-testid="hotspot-rama"]').first()
      .waitFor({ state: 'attached', timeout: 30_000 });
    // Give a beat for image + narration to settle visually.
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: shotPath('04-scene-ayodhya'), fullPage: false });

    // ── 3. Click Rama, see action menu, capture readiness dots ──
    await page.locator('[data-testid="hotspot-rama"]').first().click();
    const talkButton = page.locator('[data-testid="action-talk"]').first();
    await expect(talkButton).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: shotPath('05-action-menu'), fullPage: false });

    // Read the readiness dot status — useful diagnostic in CI logs.
    const talkStatus = await talkButton.getAttribute('data-action-status');
    console.log(`[walkthrough] Talk verb status: ${talkStatus}`);

    // ── 4. Take the Talk action, watch the branch resolve ──
    await talkButton.click();
    // Branch panel / narration update — we don't pin exact wording.
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: shotPath('06-after-talk'), fullPage: false });

    // ── 5. Navigate to the next scene via the in-page nav ──
    // Look for a Next button — fall back to URL nav if missing.
    const nextButton = page.locator('button:has-text("Next"), [aria-label*="Next"]').first();
    if (await nextButton.count() > 0 && await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(3_000);
    } else {
      await page.goto('/books/ramayana?scene=mithila_bow');
      await page.waitForLoadState('domcontentloaded');
      await page.locator('[data-testid="hotspot-rama"], [data-testid="hotspot-sita"]').first()
        .waitFor({ state: 'attached', timeout: 20_000 });
      await page.waitForTimeout(2_000);
    }
    await page.screenshot({ path: shotPath('07-scene-mithila'), fullPage: false });

    // ── 6. Movie page — verify player mounts and starts ──
    await page.goto('/books/ramayana/movie');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: shotPath('08-movie-title'), fullPage: false });

    // Click into the Player to start playback (clickToPlay).
    const main = page.locator('main').first();
    const box = await main.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
    }
    // Title card runs 4s, scene 1 starts after that — wait into scene 1.
    await page.waitForTimeout(7_500);
    await page.screenshot({ path: shotPath('09-movie-scene1'), fullPage: false });

    // Verify caption is the new sentence-cue track, not a static blob.
    const caption = page.locator('[data-testid="movie-caption"]').first();
    const cueIndex = await caption.getAttribute('data-cue-index');
    const cueTotal = await caption.getAttribute('data-cue-total');
    console.log(`[walkthrough] caption cue: ${cueIndex} / ${cueTotal}`);
    expect(Number(cueTotal)).toBeGreaterThan(1);

    // ── 7. Export MP4 — should hit the local cache and respond fast ──
    const exportBtn = page.locator('[data-testid="mp4-export-button"]').first();
    await expect(exportBtn).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: shotPath('10-export-before'), fullPage: false });

    const downloadResponse = page.waitForResponse(
      r => r.url().includes('/api/livebook/render-movie'),
      { timeout: 8 * 60_000 },
    );
    await exportBtn.click();
    await downloadResponse;

    // Wait for the URL to populate the download link.
    await expect(page.locator('[data-testid="mp4-download-link"]').first())
      .toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: shotPath('11-export-done'), fullPage: false });

    const downloadHref = await page.locator('[data-testid="mp4-download-link"]').first()
      .getAttribute('href');
    console.log(`[walkthrough] MP4 ready at: ${downloadHref}`);
    expect(downloadHref).toBeTruthy();
  });
});
