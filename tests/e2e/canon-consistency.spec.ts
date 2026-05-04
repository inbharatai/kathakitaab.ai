// ============================================================
// Canon-consistency tests.
//
// Two layers of evidence that the character-lock system actually
// works:
//
// 1. Unit-level — call `buildVisualPrompt` directly with various
//    book + character combinations and assert that canonical
//    appearance strings are present in the assembled prompt. This
//    proves we are sending the right instructions to gpt-image-1.
//
// 2. End-to-end — generate two Rama branches from the same scene
//    via different hotspots, save both screenshots side-by-side
//    in test-results/walkthrough/consistency/. The screenshots
//    are intended for human (or vision-LLM) review.
// ============================================================

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildVisualPrompt } from '@/lib/agents/visualPromptBuilder';

const OUT_DIR = join(process.cwd(), 'test-results', 'walkthrough', 'consistency');
mkdirSync(OUT_DIR, { recursive: true });

async function snap(page: Page, name: string) {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  // eslint-disable-next-line no-console
  console.log(`[snap] ${name} → ${path}`);
}

// ── Layer 1: Unit-level prompt-builder assertions ──────────────

test.describe('visualPromptBuilder injects canon correctly', () => {
  test('Ramayana — Rama gets locked appearance + style', () => {
    const built = buildVisualPrompt({
      description: 'Rama stands at the throne of Ayodhya at sunrise, calm and composed.',
      bookSlug: 'ramayana',
      mood: 'sacred',
    });

    // Character appearance was detected and injected
    expect(built.charactersInjected).toContain('rama');
    // Locked physical traits show up verbatim in the prompt
    expect(built.prompt).toMatch(/blue-tinted/i);
    expect(built.prompt).toMatch(/topknot/i);
    expect(built.prompt).toMatch(/saffron-orange/i);
    // Per-book style bible was applied
    expect(built.styleApplied).toBe(true);
    expect(built.prompt).toMatch(/saffron orange/i);
    expect(built.prompt).toMatch(/hand-painted 2D animation/i);
    // Negative clause closes the prompt
    expect(built.prompt).toMatch(/Avoid:/);
    expect(built.negative).toMatch(/no text, captions/i);
  });

  test('Ramayana — Sita and Rama together both get locked', () => {
    const built = buildVisualPrompt({
      description: 'Rama and Sita walk together through the forest at twilight.',
      bookSlug: 'ramayana',
      characters: ['Rama', 'Sita'],
      mood: 'serene',
    });

    expect(built.charactersInjected.sort()).toEqual(['rama', 'sita']);
    expect(built.prompt).toMatch(/blue-tinted/i);          // Rama's skin
    expect(built.prompt).toMatch(/golden-honey complexion/i); // Sita's skin
    expect(built.prompt).toMatch(/marigold/i);              // Sita's hair flowers
  });

  test('Ramayana — Hanuman appearance includes vanara mark', () => {
    const built = buildVisualPrompt({
      description: 'Hanuman leaps across the ocean to Lanka.',
      bookSlug: 'ramayana',
      mood: 'dramatic',
    });

    expect(built.charactersInjected).toContain('hanuman');
    expect(built.prompt).toMatch(/vanara/i);
    expect(built.prompt).toMatch(/tawny saffron-orange fur/i);
    expect(built.prompt).toMatch(/gada/i); // mace
  });

  test('Mahabharata — Krishna gets blue skin + peacock feather lock', () => {
    const built = buildVisualPrompt({
      description: 'Krishna speaks to Arjuna on the chariot at Kurukshetra.',
      bookSlug: 'mahabharata',
      mood: 'sacred',
    });

    expect(built.charactersInjected.sort()).toEqual(['arjuna', 'krishna']);
    expect(built.prompt).toMatch(/cobalt-blue/i);
    expect(built.prompt).toMatch(/peacock feather/i);
    expect(built.prompt).toMatch(/Bronze-and-indigo war epic/i); // Mahabharata style
  });

  test('Panchatantra — Pingalaka watercolour storybook style', () => {
    const built = buildVisualPrompt({
      description: 'Pingalaka the lion sits on a flat rock under the banyan tree.',
      bookSlug: 'panchatantra',
      mood: 'serene',
    });

    expect(built.charactersInjected).toContain('pingalaka');
    expect(built.prompt).toMatch(/storybook lion/i);
    expect(built.prompt).toMatch(/Watercolour-and-ink/i);
    expect(built.prompt).toMatch(/cream paper/i);
  });

  test('Unknown book — graceful no-op (no canon injection)', () => {
    const built = buildVisualPrompt({
      description: 'A hero stands at the gates of an unknown city.',
      bookSlug: 'odyssey-not-in-canon',
      mood: 'serene',
    });

    expect(built.charactersInjected).toEqual([]);
    expect(built.styleApplied).toBe(false);
    // Should still produce a usable prompt with a generic style fallback
    expect(built.prompt).toMatch(/Cinematic 2D illustration/i);
  });

  test('Word-boundary safety — "ram" inside "rampart" must not match', () => {
    const built = buildVisualPrompt({
      description: 'A guard climbs the rampart of the city.',
      bookSlug: 'ramayana',
      mood: 'serene',
    });

    // Detection must not falsely fire on substrings.
    expect(built.charactersInjected).not.toContain('rama');
  });

  test('Negative-appearance constraints flow through to the prompt', () => {
    const built = buildVisualPrompt({
      description: 'Ravana and Sita in the Ashoka Vatika.',
      bookSlug: 'ramayana',
      mood: 'tense',
    });

    expect(built.charactersInjected).toContain('ravana');
    // Negatives are joined into the closing "Avoid:" clause.
    expect(built.negative).toMatch(/never naked|never with sita touching/i);
  });
});

// ── Layer 2: Two Rama branches captured for human/vision review ──

test.describe.serial('Rama looks like Rama across two different branches', () => {
  // Mobile Safari doesn't render the desktop hotspot layer the same way,
  // and this test is about character consistency in generated images, not
  // viewport behaviour. Restrict to desktop chromium so we get clean
  // side-by-side captures.
  test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'desktop-chromium only — visual consistency check, not viewport check');
  test.setTimeout(360_000); // 6 min — image gen runs twice

  test('capture branch A (first hotspot)', async ({ page }) => {
    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3_000);

    // Skip the StoryHeader buttons (music + read) — only target hotspots
    // inside the scene canvas.
    const hotspots = page.locator('[class*="book-page"] button[aria-label]');
    expect(await hotspots.count()).toBeGreaterThan(0);

    await hotspots.first().click({ force: true });
    await page.waitForTimeout(1_500); // give popup time to mount

    // Hotspot action menus vary per hotspot — some expose Ask, others
    // Talk. Both fire entity-interact and produce a canon-locked branch
    // image, which is all this test cares about. Continue/Move don't
    // generate an image, so we exclude them.
    const actionBtn = page.locator('button').filter({ hasText: /^(Talk|Ask)$/ }).first();
    await actionBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await actionBtn.click({ force: true });

    // Wait for branch text + image
    try {
      await page.waitForFunction(() => !/exploring\.\.\./i.test(document.body.innerText || ''), { timeout: 60_000 });
    } catch { /* */ }
    try {
      await page.waitForFunction(() => !/painting the scene/i.test(document.body.innerText || ''), { timeout: 90_000 });
    } catch { /* */ }
    await page.waitForTimeout(1_500);
    await snap(page, 'A-branch');
  });

  test('capture branch B (second hotspot)', async ({ page }) => {
    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3_000);

    const hotspots = page.locator('[class*="book-page"] button[aria-label]');
    const count = await hotspots.count();
    expect(count).toBeGreaterThan(1);

    // Use the LAST hotspot — different from branch A which used .first().
    // Picks a different character so we get visual variety to compare.
    await hotspots.nth(count - 1).click({ force: true });
    await page.waitForTimeout(1_500);

    const actionBtn = page.locator('button').filter({ hasText: /^(Talk|Ask)$/ }).first();
    await actionBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await actionBtn.click({ force: true });

    try {
      await page.waitForFunction(() => !/exploring\.\.\./i.test(document.body.innerText || ''), { timeout: 60_000 });
    } catch { /* */ }
    try {
      await page.waitForFunction(() => !/painting the scene/i.test(document.body.innerText || ''), { timeout: 90_000 });
    } catch { /* */ }
    await page.waitForTimeout(1_500);
    await snap(page, 'B-branch');
  });
});
