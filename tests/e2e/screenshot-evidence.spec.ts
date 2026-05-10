// Captures one screenshot per key page in both desktop and mobile
// viewports as evidence for the verification report. Outputs land in
// test-results/screenshots/. Skipped on CI by default; run locally:
//   npx playwright test screenshot-evidence.spec.ts --project=chromium
//   npx playwright test screenshot-evidence.spec.ts --project="Mobile Safari"

import { test } from '@playwright/test';
import path from 'path';

const PAGES: { name: string; path: string }[] = [
  { name: 'landing',         path: '/' },
  { name: 'studio',          path: '/educator' },
  { name: 'library',         path: '/books' },
  { name: 'reader-ramayana', path: '/books/ramayana' },
  { name: 'movie-ramayana',  path: '/books/ramayana/movie' },
];

for (const { name, path: route } of PAGES) {
  test(`screenshot: ${name}`, async ({ page }, testInfo) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    // Give framer-motion a moment so animated entries are settled.
    await page.waitForTimeout(800);
    const projectSlug = testInfo.project.name.toLowerCase().replace(/\s+/g, '-');
    const file = path.join('test-results', 'screenshots', `${name}-${projectSlug}.png`);
    await page.screenshot({ path: file, fullPage: true });
  });
}
