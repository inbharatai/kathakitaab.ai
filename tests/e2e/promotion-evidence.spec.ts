// ============================================================
// Promotion-readiness screenshot evidence.
//
// Captures one full-page screenshot per state the user asked to
// see. Skips the "generated reader" shots if the live generation
// hasn't been run — those need a real cl-* / pv-* slug. The QA
// session that runs Phase 1 should set CL_SLUG / PV_SLUG and
// OWNER_COOKIE in the env to capture them.
// ============================================================

import { test } from '@playwright/test';
import path from 'path';

const OUT = (name: string, project: string) => path.join('test-results', 'screenshots', `${name}-${project.toLowerCase().replace(/\s+/g, '-')}.png`);

const OWNER = process.env.QA_OWNER_COOKIE ?? '';
const PV_SLUG = process.env.QA_PV_SLUG ?? '';
const CL_SLUG = process.env.QA_CL_SLUG ?? '';

test('mode-selector — World tab default', async ({ page }, info) => {
  await page.goto('/educator');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT('studio-mode-world', info.project.name), fullPage: true });
});

test('mode-selector — Classroom tab', async ({ page }, info) => {
  await page.goto('/educator');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('mode-tab-classroom').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT('studio-mode-classroom', info.project.name), fullPage: true });
});

test('mode-selector — Personalized tab (no photo upload visible)', async ({ page }, info) => {
  await page.goto('/educator');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('mode-tab-personalized').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT('studio-mode-personalized', info.project.name), fullPage: true });
});

test('coming-soon strip is anchored on the Studio page', async ({ page }, info) => {
  await page.goto('/educator');
  await page.waitForLoadState('networkidle');
  // Scroll the Coming Soon section into view so it's captured.
  await page.getByText(/Child photo upload/i).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT('studio-coming-soon', info.project.name), fullPage: true });
});

test('non-owner private 404 (curl-shaped sanity)', async ({ request }) => {
  // No cookie → 404 for any private slug shape.
  const res = await request.get('/api/books/pv-deadbeefdeadbeef');
  if (res.status() !== 404) {
    throw new Error(`expected 404, got ${res.status()}`);
  }
  // No screenshot — this is an API-level evidence row.
});

test.describe('Generated reader screenshots (only if QA env vars set)', () => {
  test.skip(!OWNER || !CL_SLUG, 'QA_OWNER_COOKIE + QA_CL_SLUG required for classroom reader screenshot');

  test('classroom reader (owner view)', async ({ page, context }, info) => {
    // Cookie scoped to the dev server's origin. Using `url:` instead
    // of domain so Playwright handles localhost/IPv6 correctly.
    await context.addCookies([{
      name: 'katha:owner',
      value: OWNER,
      url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5009',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }]);
    await page.goto(`/books/${CL_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: OUT('reader-classroom', info.project.name), fullPage: true });
  });
});

test.describe('Personalized reader screenshot (only if QA env vars set)', () => {
  test.skip(!OWNER || !PV_SLUG, 'QA_OWNER_COOKIE + QA_PV_SLUG required for personalized reader screenshot');

  test('personalized reader (owner view, with delete button visible)', async ({ page, context }, info) => {
    // Cookie scoped to the dev server's origin. Using `url:` instead
    // of domain so Playwright handles localhost/IPv6 correctly.
    await context.addCookies([{
      name: 'katha:owner',
      value: OWNER,
      url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5009',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }]);
    await page.goto(`/books/${PV_SLUG}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: OUT('reader-personalized', info.project.name), fullPage: true });
  });
});
