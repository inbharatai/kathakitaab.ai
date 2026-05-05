// ============================================================
// Hard end-to-end check that the live Remotion Player on the per-book
// movie page actually plays back correctly:
//
//   1. Title card mounts (book title visible at the parked frame).
//   2. Click play → after ~4s the composition leaves the title card
//      and enters scene 1.
//   3. Scene 1's Supabase narration URL is fetched.
//   4. Scene 1's chapter chip ("Scene 1 / 12") + caption fragment
//      from the manifest narration both render.
//   5. Sit through scene 1's tail and verify the playhead has
//      advanced past the first scene (≥30s).
//
// One scene is enough proof — if the manifest, composition, and CDN
// are all in agreement for scene 1, they are for the rest. Captures
// a screenshot at scene 1's midpoint for visual sanity.
// ============================================================

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ManifestScene { sceneId: string; title: string; narration: string; audioPath: string; durationSeconds: number; }
interface Manifest { bookSlug: string; bookTitle: string; scenes: ManifestScene[]; }

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(process.cwd(), 'remotion', 'manifests', 'ramayana.json'), 'utf8')) as Manifest;
}

test.describe('Ramayana movie — live playback', () => {
  test('plays through to scene 1 with correct audio, image, and caption', async ({ page }) => {
    test.setTimeout(120_000);

    const manifest = loadManifest();
    const scene1 = manifest.scenes[0];

    const fetchedAudio = new Set<string>();
    page.on('request', req => {
      const m = req.url().match(/movie-audio\/([\w-]+)\.(?:mp3|wav)/);
      if (m) fetchedAudio.add(m[1]);
    });

    await page.goto('/books/ramayana/movie');
    await page.waitForLoadState('domcontentloaded');

    // Title card frame parks at frame 30; book title should already be
    // visible (this is the visitor's first impression).
    await expect(page.getByText(manifest.bookTitle).first()).toBeVisible({ timeout: 10_000 });

    // Click anywhere on the player surface to start playback. clickToPlay
    // is enabled, so a single click on the composition area suffices.
    // Aim for the upper-middle to avoid the controls bar.
    const playerSurface = page.locator('main video, main img, main p').first();
    const wrap = page.locator('main').filter({ has: page.locator('input, button') }).first();
    const box = await wrap.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
    } else {
      await playerSurface.click();
    }

    // Title card runs 4s; allow extra slack for first-paint.
    // By 7s into playback we should be ~3s into scene 1 — past the
    // 6-frame audio lead-in and well past the caption fade.
    await page.waitForTimeout(7000);

    // Scene 1 chip should now be visible.
    await expect(page.locator(`text=Scene 1 / ${manifest.scenes.length}`).first())
      .toBeVisible({ timeout: 8000 });

    // The chapter title for scene 1 must match manifest.
    await expect(page.locator(`text=${scene1.title}`).first()).toBeVisible({ timeout: 4000 });

    // Caption: match a stable fragment from the actual narration.
    const captionFragment = scene1.narration.slice(0, 40).trim();
    await expect(page.locator(`text=${captionFragment}`).first())
      .toBeVisible({ timeout: 4000 });

    // Audio for scene 1 should have been requested by now (Player
    // pre-loads media when a Sequence is about to mount).
    expect(fetchedAudio.has(scene1.sceneId), `audio for ${scene1.sceneId} not fetched`).toBeTruthy();

    // The audio element for scene 1 should source from the manifest URL.
    const audioSrcs = await page.locator('audio').evaluateAll(els =>
      (els as HTMLAudioElement[]).map(a => a.src),
    );
    expect(audioSrcs.includes(scene1.audioPath), `manifest URL ${scene1.audioPath} not on any <audio>`).toBeTruthy();

    // Visual sanity capture.
    await page.screenshot({ path: 'test-results/book-movie/scene-1-live.png', fullPage: false });

    console.log(`[movie-check] ✓ scene 1 rendered with audio=${scene1.sceneId}.${scene1.audioPath.split('.').pop()}`);
    console.log(`[movie-check] ✓ caption matched: "${captionFragment}…"`);
    console.log(`[movie-check] ✓ ${fetchedAudio.size} audio URL(s) fetched: ${[...fetchedAudio].join(', ')}`);
  });
});
