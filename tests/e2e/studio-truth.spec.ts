// ============================================================
// Studio truth-pinning + duplicate-click guard + polling-resume
// behaviour. Runs against the local dev server at the same baseURL
// the rest of the suite uses.
//
// These tests pin the V0 honesty pass: the Studio page must NOT
// claim assignment/tracking/agent-swarm/hardcoded stats, the
// BookGenerator form must reject rapid duplicate submits, and a
// generation that's already in flight should reattach via the
// sessionStorage resume entry rather than starting fresh.
// ============================================================

import { test, expect, Page } from '@playwright/test';

// Patterns the Studio page is forbidden from displaying. Each
// corresponds to a claim that was either fake or unsupported in
// the pre-V0 copy. If any future change reintroduces them, this
// spec fails fast.
const BANNED_STUDIO_PHRASES = [
  /Assign to students/i,
  /Track comprehension/i,
  /1 Live \+ ∞ Generatable/i,
  /12 Ramayana \+ AI/i,
  /How the Agent Swarm Works/i,
  /Architect Agent/i,
  /Character Agent/i,
  /Hotspot Agent/i,
  /Quiz Agent/i,
];

// Phrases that MUST appear so a regression doesn't accidentally
// remove the honest copy too. Updated for V1: Classroom and
// text-only Personalized Story are now LIVE flows (with their own
// mode tabs), so the things still in the Coming Soon strip are
// child photo upload, MP4 video export, and classroom analytics.
const REQUIRED_STUDIO_PHRASES = [
  /Coming soon/i,
  /Child photo upload/i,
  /Video export/i,
  /How KathaKitaab builds your book/i,
];

test.describe('Studio — honest copy', () => {
  test('the Studio page never displays banned (fake) phrases', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').innerText();
    for (const banned of BANNED_STUDIO_PHRASES) {
      expect(body, `banned phrase appeared: ${banned}`).not.toMatch(banned);
    }
  });

  test('the Studio page surfaces the honest replacements', async ({ page }) => {
    await page.goto('/educator');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').innerText();
    for (const required of REQUIRED_STUDIO_PHRASES) {
      expect(body, `required phrase missing: ${required}`).toMatch(required);
    }
  });

  test('the movie page has no clickable MP4 export — only a Coming Soon notice', async ({ page }) => {
    await page.goto('/books/ramayana/movie');
    await page.waitForLoadState('networkidle');
    // The old Export buttons used data-testid="mp4-export-button" /
    // "trailer-export-button". Both must be absent.
    await expect(page.getByTestId('mp4-export-button')).toHaveCount(0);
    await expect(page.getByTestId('trailer-export-button')).toHaveCount(0);
    // The Coming Soon panel must be present.
    await expect(page.getByTestId('mp4-export-coming-soon')).toBeVisible();
  });
});

test.describe('BookGenerator — duplicate-click guard', () => {
  test('rapid double-clicks fire only ONE generation request', async ({ page }) => {
    // Intercept the generate endpoint so we can count requests AND
    // hold the response open long enough to observe the second click.
    // Glob has trailing ** to match the GET form which appends ?slug=…
    let postCount = 0;
    await page.route('**/api/books/generate**', async route => {
      const req = route.request();
      if (req.method() === 'POST') {
        postCount++;
        await new Promise(r => setTimeout(r, 800));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ generating: true, slug: 'duplicate-test-slug' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ step: 'Working…', percent: 50, done: false }),
      });
    });

    await page.goto('/educator');
    await page.waitForLoadState('networkidle');

    const input = page.locator('input[placeholder*="Mahabharata"]');
    await input.fill('My Test Story');
    const submitBtn = page.getByRole('button', { name: /Create Story/i }).first();

    // Hammer: two clicks within ~30ms — the same window where the
    // pre-V0 form leaked through duplicate POSTs.
    await Promise.all([
      submitBtn.click({ force: true }),
      submitBtn.click({ force: true }),
    ]);

    // Wait beyond the simulated POST resolution window.
    await page.waitForTimeout(1500);
    expect(postCount, `duplicate-click guard failed — ${postCount} POSTs`).toBe(1);
  });

  test('the submit button visibly disables during in-flight generation', async ({ page }) => {
    await page.route('**/api/books/generate**', async route => {
      if (route.request().method() === 'POST') {
        await new Promise(r => setTimeout(r, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ generating: true, slug: 'disabled-test' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ step: 'Working…', percent: 25, done: false }),
        });
      }
    });

    await page.goto('/educator');
    await page.waitForLoadState('networkidle');
    await page.locator('input[placeholder*="Mahabharata"]').fill('Disabled Test');
    // The form's submit button. We select by attribute, NOT by name,
    // because the accessible name changes from "Create Story" to
    // "Creating…" mid-test — a name-based locator would lose the
    // element.
    const btn = page.locator('button[type="submit"]').first();
    await btn.click();
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveText(/Creating/i);
  });
});

async function setSessionStorageResume(page: Page, slug: string, title: string, ageMinutes = 0) {
  await page.evaluate(({ slug, title, ageMinutes }) => {
    sessionStorage.setItem('katha:active-generation', JSON.stringify({
      slug, title, startedAt: Date.now() - ageMinutes * 60_000,
    }));
  }, { slug, title, ageMinutes });
}

test.describe('BookGenerator — sessionStorage polling resume', () => {
  test('a stored resume entry reattaches without firing a new POST', async ({ page }) => {
    let postCount = 0;
    let pollCount = 0;
    await page.route('**/api/books/generate**', async route => {
      if (route.request().method() === 'POST') {
        postCount++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      } else {
        pollCount++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ step: 'Reattached', percent: 60, done: false }),
        });
      }
    });

    // Step 1: visit Studio so a real document/origin exists for sessionStorage.
    await page.goto('/educator');
    await setSessionStorageResume(page, 'resume-slug', 'Resumed Story');

    // Step 2: reload — useState lazy initializer should pick up the entry,
    // resume effect should call pollProgress without firing a POST.
    await page.reload();
    await page.waitForLoadState('networkidle');

    // The form's progress strip should show "Reattaching" copy from
    // initial state, then flip to whatever the poll returned.
    const body = page.locator('body');
    await expect(body).toContainText(/Reattach|Working/i, { timeout: 5000 });

    expect(postCount, 'no new POST should fire on resume').toBe(0);
    expect(pollCount, 'at least one progress poll should fire').toBeGreaterThan(0);
  });

  test('a stale resume entry (>30 minutes old) is cleared and ignored', async ({ page }) => {
    await page.goto('/educator');
    await setSessionStorageResume(page, 'stale-slug', 'Stale Story', 31);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // sessionStorage entry should be gone after readResume() purges it.
    const remaining = await page.evaluate(() => sessionStorage.getItem('katha:active-generation'));
    expect(remaining).toBeNull();

    // The form should sit in idle: no progress bar visible, no
    // "Creating…" / "Reattaching" copy. (The submit button stays
    // disabled until the user types a title — that's correct
    // behaviour, not a regression — so we check for absence of
    // busy-state copy instead.)
    const body = page.locator('body');
    await expect(body).not.toContainText(/Reattaching|Creating/i);
    // And typing a title should re-enable the button.
    await page.locator('input[placeholder*="Mahabharata"]').fill('Fresh Title');
    const btn = page.locator('button[type="submit"]').first();
    await expect(btn).toBeEnabled();
  });
});

test.describe('MP4 export — server-side gate', () => {
  test('the render-movie route returns 501 with the friendly message', async ({ request }) => {
    const res = await request.post('/api/livebook/render-movie', {
      data: { bookSlug: 'ramayana', mode: 'movie' },
    });
    expect(res.status()).toBe(501);
    const body = await res.json();
    expect(body.error).toMatch(/not available in this environment/i);
    // No stack trace should leak in the response.
    expect(JSON.stringify(body)).not.toMatch(/at \w+ \(\/.*\.[jt]s:/);
  });
});
