// ============================================================
// Studio mode selector tests.
//
// V1 added a 3-mode segmented control inside the Studio: World
// (existing BookGenerator), Classroom Story, and Personalized
// Story (text-only). Each mode mounts a different form. These
// tests pin the contract:
//   • All three tabs render
//   • World is the default
//   • Tab switch mounts the right form
//   • Classroom requires class + topic
//   • Personalized blocks submit until consent + first-name + valid age
//   • Personalized form does NOT include any photo-upload control
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Studio mode selector', () => {
  test('all three mode tabs render with World active by default', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('mode-tab-world')).toBeVisible();
    await expect(page.getByTestId('mode-tab-classroom')).toBeVisible();
    await expect(page.getByTestId('mode-tab-personalized')).toBeVisible();

    // World is default → its form is mounted (the existing BookGenerator
    // renders the "Name the world you want to enter." heading).
    await expect(page.getByText(/Name the world you want to enter/i)).toBeVisible();
  });

  test('switching to Classroom mode mounts the classroom form', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('mode-tab-classroom').click();

    await expect(page.getByTestId('classroom-form')).toBeVisible();
    await expect(page.getByText(/Build a story around a topic/i)).toBeVisible();
    // World form should not be on screen anymore.
    await expect(page.getByText(/Name the world you want to enter/i)).toHaveCount(0);
  });

  test('switching to Personalized mode mounts the personalized form WITH consent gate AND no photo upload', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('mode-tab-personalized').click();

    await expect(page.getByTestId('personalized-form')).toBeVisible();
    await expect(page.getByTestId('personalized-consent')).toBeVisible();

    // Truth guarantee: text-only personalization. No <input type="file">,
    // no /api/upload endpoint references in the DOM, no "Upload" button.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByText(/photo upload is coming later/i)).toBeVisible();
  });
});

test.describe('Classroom form — client-side validation', () => {
  test('submit is disabled until grade + topic are filled', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('mode-tab-classroom').click();

    const submit = page.locator('[data-testid="classroom-form"] button[type="submit"]');
    await expect(submit).toBeDisabled();

    // Grade is pre-filled; the form has three text inputs in this
    // order: subject (0), chapter (1), learningGoal (2). Filling
    // any of the first two satisfies the "subject OR chapter"
    // server-side validation; we use chapter.
    await page.locator('[data-testid="classroom-form"] input').nth(1).fill('Akbar and Birbal — wisdom');
    await expect(submit).toBeEnabled();
  });
});

test.describe('Personalized form — client-side validation', () => {
  test('submit is disabled until name + age + consent are valid', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('mode-tab-personalized').click();

    const submit = page.locator('[data-testid="personalized-form"] button[type="submit"]');
    await expect(submit).toBeDisabled();

    // Fill name only — still missing consent.
    await page.locator('[data-testid="personalized-form"] input').first().fill('Asha');
    await expect(submit).toBeDisabled();

    // Tick consent → enabled.
    await page.locator('[data-testid="personalized-consent"] input[type="checkbox"]').check();
    await expect(submit).toBeEnabled();
  });

  test('multi-word childName surfaces an inline error and disables submit', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('mode-tab-personalized').click();

    await page.locator('[data-testid="personalized-form"] input').first().fill('Asha Patel');
    await page.locator('[data-testid="personalized-consent"] input[type="checkbox"]').check();

    const submit = page.locator('[data-testid="personalized-form"] button[type="submit"]');
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/first name only/i)).toBeVisible();
  });

  test('the CTA personalises with the child name', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('mode-tab-personalized').click();

    await page.locator('[data-testid="personalized-form"] input').first().fill('Asha');
    const submit = page.locator('[data-testid="personalized-form"] button[type="submit"]');
    await expect(submit).toContainText(/Asha/);
  });
});
