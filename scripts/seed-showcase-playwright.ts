// scripts/seed-showcase-playwright.ts
//
// Automates the admin panel to seed missing showcase books.
// Run after `npm run dev` is already started.
//
// Usage: npx tsx scripts/seed-showcase-playwright.ts

import { chromium } from 'playwright';

async function main() {
  console.log('[pw-seed] launching browser…');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // 1. Open admin page
  console.log('[pw-seed] navigating to /admin …');
  await page.goto('http://localhost:5009/admin', { waitUntil: 'networkidle' });

  // 2. Wait for the page to render (it checks auth but should load
  //    immediately now that dev-bypass is in place)
  await page.waitForTimeout(1000);

  // 3. Click "Seed Missing Showcase Books"
  const seedBtn = page.locator('button:has-text("Seed Missing Showcase Books")');
  const count = await seedBtn.count();
  if (count === 0) {
    console.error('[pw-seed] "Seed Missing Showcase Books" button not found');
    await browser.close();
    process.exit(1);
  }

  console.log('[pw-seed] clicking "Seed Missing Showcase Books"…');
  await seedBtn.click();

  // 4. Wait for the green success banner
  console.log('[pw-seed] waiting for success confirmation…');
  const successBanner = page.locator('div:has-text("Seeding"):has-text("showcase")');
  try {
    await successBanner.waitFor({ timeout: 10000 });
    const text = await successBanner.textContent();
    console.log('[pw-seed] server response:', text?.trim());
  } catch {
    console.warn('[pw-seed] no green banner appeared — may still be processing.');
  }

  // 5. Wait a bit for after() to kick in on the server
  console.log('[pw-seed] waiting 5s for background generation to start…');
  await page.waitForTimeout(5000);

  // 6. Navigate to /books to verify Ramayana still shows
  console.log('[pw-seed] navigating to /books to verify library…');
  await page.goto('http://localhost:5009/books', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 7. Take a screenshot for the user
  const screenshotPath = 'seed-showcase-result.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`[pw-seed] screenshot saved to ${screenshotPath}`);

  // 8. Check if any showcase cards appeared
  const cards = page.locator('.story-card');
  const cardCount = await cards.count();
  console.log(`[pw-seed] found ${cardCount} story card(s) on /books`);

  // 9. Read card titles
  for (let i = 0; i < Math.min(cardCount, 6); i++) {
    const title = await cards.nth(i).locator('.story-card-title').textContent().catch(() => null);
    if (title) console.log(`[pw-seed]   card ${i + 1}: ${title.trim()}`);
  }

  await browser.close();
  console.log('[pw-seed] done — generation is running in the server background.');
  console.log('[pw-seed] check back on /books in ~10 minutes for restored showcase books.');
}

main().catch(err => {
  console.error('[pw-seed] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
