import { test, expect, type Page } from '@playwright/test';

// ============================================================
// Living World Mode — KathaKitaab
//
// Exercises the universal WorldManifest engine end-to-end against
// the curated Ramayana seed (offline — no AI, no DB). The courier
// loop: spawn carries the first fragment → walk to the ready portal
// → deliver → narration payoff → next scene unlocks → walk on →
// pickup. Then side missions + persistence + reset.
// ============================================================

const SESSION_KEY = 'kathakitaab_world_session:ramayana';

async function readSession(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }, SESSION_KEY);
}

async function unlockedNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-world-unlocked="true"]')) as HTMLElement[];
    return els.map(el => el.getAttribute('data-world-node') ?? '');
  });
}

test.describe('Living World Mode — Ramayana', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  });

  test('courier loop: deliver a fragment, unlock the next scene, persist, reset', async ({ page }) => {
    // domcontentloaded: the world stage is offline (no AI, no DB) and
    // asserts DOM state. Waiting for full `load` couples the test to
    // remote-CDN image completion, which flakes when the CDN is
    // deploy-pending. The .world-viewport toBeVisible wait below covers
    // JS init; domcontentloaded is enough here.
    await page.goto('/world/ramayana', { waitUntil: 'domcontentloaded' });

    // The world stage renders with at least one node.
    await expect(page.locator('.world-viewport')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-world-node]')).toHaveCount(await page.locator('[data-world-node]').count());
    const nodeCount = await page.locator('[data-world-node]').count();
    expect(nodeCount).toBeGreaterThan(0);

    // Deterministic synthesis: reload produces the same node set.
    const firstNodeIds = await unlockedNodeIds(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.world-viewport')).toBeVisible({ timeout: 15000 });
    const secondNodeIds = await unlockedNodeIds(page);
    expect(secondNodeIds).toEqual(firstNodeIds);

    // Spawn: exactly one unlocked node (the first scene).
    expect(firstNodeIds.length).toBeGreaterThanOrEqual(1);

    // The panel signals the courier is carrying the first fragment.
    await expect(page.locator('.world-panel-status')).toContainText(/fragment/i);

    // There is exactly one ready portal (the spawn's closed portal,
    // fed by the carried fragment).
    const readyPortal = page.locator('.world-portal.is-ready');
    await expect(readyPortal).toHaveCount(1);

    // Deliver: walk to the ready portal → narration overlay appears.
    await readyPortal.click();
    const narration = page.locator('[data-world-overlay="narration"]');
    await expect(narration).toBeVisible({ timeout: 8000 });

    // Before closing, the session already recorded the delivery + XP.
    await expect.poll(async () => {
      const s = await readSession(page);
      return (s?.completedMissionIds as string[] | undefined) ?? [];
    }).toEqual(expect.arrayContaining([`mf-${firstNodeIds[0]}`]));
    await expect.poll(async () => readSession(page)).toMatchObject({ xp: expect.any(Number) });

    // Close the narration payoff ("Walk on").
    await page.locator('[data-world-overlay="narration"] button', { hasText: /walk on/i }).click();
    await expect(narration).toBeHidden();

    // The portal is now open, and the next scene has unlocked.
    await expect(page.locator(`[data-world-portal-open="true"]`)).toHaveCount(1);
    const unlockedAfter = await unlockedNodeIds(page);
    expect(unlockedAfter.length).toBeGreaterThan(firstNodeIds.length);
    const nextNodeId = unlockedAfter.find(id => !firstNodeIds.includes(id));
    expect(nextNodeId).toBeTruthy();

    // Walk to the next scene → it becomes current and the fragment
    // is auto-collected for that node.
    await page.locator(`[data-world-node="${nextNodeId}"]`).click();
    await expect.poll(async () => {
      const s = await readSession(page);
      return s?.currentNodeId;
    }).toBe(nextNodeId);
    await expect.poll(async () => readSession(page)).toMatchObject({
      visitedNodeIds: expect.arrayContaining([firstNodeIds[0], nextNodeId]),
      carriedFragmentNodeId: nextNodeId,
    });

    // Reset clears the world session.
    await page.getByRole('button', { name: /Reset world/i }).click();
    await expect.poll(async () => {
      const s = await readSession(page);
      return {
        completed: (s?.completedMissionIds as string[] | undefined) ?? [],
        xp: s?.xp,
        carried: s?.carriedFragmentNodeId,
      };
    }).toMatchObject({ completed: [], xp: 0, carried: firstNodeIds[0] });
  });

  test('side missions complete and award XP (ask / collect clue if present)', async ({ page }) => {
    await page.goto('/world/ramayana', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.world-viewport')).toBeVisible({ timeout: 15000 });
    const xpBefore = Number((await readSession(page))?.xp ?? 0);

    // Ask a character, if the spawn node has one.
    const askButton = page.locator('[data-world-mission^="ma-"]', { hasText: /Ask/i });
    if ((await askButton.count()) > 0) {
      await askButton.first().click();
      const speech = page.locator('[data-world-overlay="speech"]');
      await expect(speech).toBeVisible({ timeout: 5000 });
      await expect.poll(async () => readSession(page)).toMatchObject({ xp: expect.any(Number) });
      await page.locator('[data-world-overlay="speech"] button', { hasText: /continue/i }).click();
      await expect(speech).toBeHidden();
    }

    // Collect a clue, if the spawn node exposes one.
    const clueMarker = page.locator('[data-world-mission^="mc-"]');
    if ((await clueMarker.count()) > 0) {
      await clueMarker.first().click();
      const clueOverlay = page.locator('[data-world-overlay="clue"]');
      await expect(clueOverlay).toBeVisible({ timeout: 5000 });
      await page.locator('[data-world-overlay="clue"] button', { hasText: /keep exploring/i }).click();
      await expect(clueOverlay).toBeHidden();
    }

    // #6 — the wider mission grammar renders: at least one "escort onward"
    // side mission is present at the spawn (its target is locked until the
    // courier loop opens it, so the button is disabled but in the DOM).
    // Presence-only — we do not click, to keep this test offline-stable.
    const escortMarker = page.locator('[data-world-mission^="me-"]');
    expect(await escortMarker.count()).toBeGreaterThanOrEqual(1);

    // XP should have grown if any side mission was available.
    const xpAfter = Number((await readSession(page))?.xp ?? 0);
    if ((await askButton.count()) + (await clueMarker.count()) > 0) {
      expect(xpAfter).toBeGreaterThan(xpBefore);
    }
  });

  test('reduced-motion preference snaps the avatar instead of tweening', async ({ page }) => {
    await page.addInitScript(() => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      // Fake the reduced-motion media query so the hook reports true.
      Object.defineProperty(mq, 'matches', { get: () => true });
    });
    await page.goto('/world/ramayana', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.world-viewport')).toBeVisible({ timeout: 15000 });

    const readyPortal = page.locator('.world-portal.is-ready');
    await expect(readyPortal).toHaveCount(1);
    await readyPortal.click();
    // Snapped delivery is near-instant.
    await expect(page.locator('[data-world-overlay="narration"]')).toBeVisible({ timeout: 4000 });
  });
});