// ============================================================
// scripts/setup-upstash.ts
//
// Pulls the REST URL + Token for the first Redis DB in the user's
// Upstash console and writes them into .env.local.
//
// Run:  npx tsx scripts/setup-upstash.ts
//
// First run: a Chromium window opens. Log into Upstash there once.
// The script saves your auth state to .upstash-auth.json (gitignored)
// so subsequent runs skip the login step.
// ============================================================

import { chromium, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE_PATH = join(process.cwd(), '.upstash-auth.json');
const ENV_PATH = join(process.cwd(), '.env.local');
const DASHBOARD = 'https://console.upstash.com/redis';

// Skip the dashboard listing step when we already know which DB to use.
// Pass via UPSTASH_DB_ID env or as the first CLI arg. The DB id you
// shared earlier (`d364f4a4-...`) is wired in as the default so a no-arg
// run still works.
const KNOWN_DB_ID =
  process.argv[2]
  || process.env.UPSTASH_DB_ID
  || 'd364f4a4-d368-49b5-8f23-a40e75d72bc1';

async function waitForLogin(page: Page): Promise<void> {
  // Upstash's SPA keeps the URL at /redis even when unauthenticated and
  // just swaps the content to a login form. Their email input uses
  // id="email" and autocomplete="email" but no type="email" — match
  // on the more reliable autocomplete attribute.

  // Wait for React to actually paint *something* — either the login
  // form or the authenticated dashboard chrome — before deciding.
  // Without this, the early check fires on a blank skeleton and the
  // script falsely concludes the user is already logged in.
  await page.waitForFunction(
    () =>
      !!document.querySelector('input[autocomplete="email"]')
      || !!document.querySelector('#email')
      || !!document.querySelector('a[href^="/redis/"]')
      || !!document.querySelector('[data-testid*="database"], [class*="database"]')
      || (document.body.innerText || '').includes('Create Database'),
    null,
    { timeout: 30_000 },
  ).catch(() => { /* fall through; isLoginScreen will retry */ });

  if (!(await isLoginScreen(page))) return;

  console.log('[setup-upstash] -- LOGIN REQUIRED --');
  console.log('[setup-upstash] Sign in to Upstash in the Chromium window that just opened.');
  console.log('[setup-upstash] You have 5 minutes. The script continues once the dashboard renders.');

  await page.waitForFunction(
    () =>
      !document.querySelector('input[autocomplete="email"]')
      && !document.querySelector('#email')
      && !Array.from(document.querySelectorAll('button')).some(b =>
        /^log in$/i.test((b.textContent || '').trim())),
    null,
    { timeout: 5 * 60_000 },
  );
  console.log('[setup-upstash] ✓ Login complete — proceeding.');
  await page.waitForLoadState('networkidle').catch(() => { /* */ });
  await page.waitForTimeout(1_500);
}

async function isLoginScreen(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    !!document.querySelector('input[autocomplete="email"]')
    || !!document.querySelector('#email'),
  );
}

async function pickFirstRedisDb(page: Page): Promise<string> {
  // Try a few selectors the Upstash dashboard has used over time —
  // direct /redis/{id} links, full-URL anchors, table rows. If none
  // match (e.g. the dashboard is team-filtered or empty), fall back to
  // the KNOWN_DB_ID the caller supplied.
  const candidates = [
    'a[href*="/redis/"][href*="-"]',
    'a[href^="/redis/"]',
    'a[href^="https://console.upstash.com/redis/"]',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.count() === 0) continue;
    const href = await el.getAttribute('href').catch(() => null);
    if (!href) continue;
    const match = href.match(/\/redis\/([0-9a-f-]{8,})/i);
    if (match) {
      console.log(`[setup-upstash] Found Redis DB on dashboard: ${match[1]}`);
      return match[1];
    }
  }
  console.log(`[setup-upstash] Dashboard listing not visible — falling back to known DB id: ${KNOWN_DB_ID}`);
  return KNOWN_DB_ID;
}

async function readRestCredentials(page: Page, dbId: string): Promise<{ url: string; token: string }> {
  await page.goto(`https://console.upstash.com/redis/${dbId}`);
  await page.waitForLoadState('networkidle').catch(() => { /* */ });
  await page.waitForTimeout(2_000);

  // Try a few interaction patterns to surface the REST credentials.
  // Upstash's UI has moved between tab, accordion, and "Connect modal"
  // designs — best-effort click any of these and proceed.
  const tabNames: (string | RegExp)[] = [/^REST API$/i, /^REST$/i, /^Connect$/i, /Connect to your database/i];
  for (const name of tabNames) {
    const t = page.getByRole('tab', { name }).first();
    if (await t.count() > 0) {
      await t.click().catch(() => { /* */ });
      await page.waitForTimeout(800);
      break;
    }
    const b = page.getByRole('button', { name }).first();
    if (await b.count() > 0) {
      await b.click().catch(() => { /* */ });
      await page.waitForTimeout(800);
      break;
    }
  }

  // Reveal / show toggles (some versions hide tokens behind a button).
  const revealBtn = page.getByRole('button', { name: /show|reveal|view/i }).first();
  if (await revealBtn.count() > 0) {
    await revealBtn.click().catch(() => { /* */ });
    await page.waitForTimeout(500);
  }

  // Pull from the rendered DOM text — this catches tokens that live
  // in <input type="text"> values too. innerText drops hidden trees.
  const text = await page.evaluate(() => document.body.innerText);
  const inputValues = await page.$$eval('input', els => els.map(e => (e as HTMLInputElement).value).filter(Boolean));
  const haystack = text + '\n' + inputValues.join('\n');

  const url = matchFirst(haystack, /https:\/\/[a-zA-Z0-9-]+\.upstash\.io/);
  if (!url) {
    await dumpDebug(page, 'no-url');
    throw new Error('Could not find the REST URL on the page. Debug HTML/screenshot saved.');
  }

  // Token: long base64url string, often shown after the env-var name or
  // as the value of a labelled "Token" / "Password" input.
  let token = haystack.match(/UPSTASH_REDIS_REST_TOKEN[^\n]{0,80}?["= ]([A-Za-z0-9+/=_-]{32,})/)?.[1];
  if (!token) token = inputValues.find(v => /^[A-Za-z0-9+/=_-]{32,}$/.test(v));

  if (!token) {
    await dumpDebug(page, 'no-token');
    throw new Error('Could not read the REST Token. Debug HTML/screenshot saved.');
  }

  return { url, token };
}

async function dumpDebug(page: Page, tag: string): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const htmlPath = join(process.cwd(), `.upstash-debug-${tag}-${ts}.html`);
  const pngPath = join(process.cwd(), `.upstash-debug-${tag}-${ts}.png`);
  try {
    writeFileSync(htmlPath, await page.content(), 'utf8');
    await page.screenshot({ path: pngPath, fullPage: true });
    console.error(`[setup-upstash] debug saved: ${htmlPath} + ${pngPath}`);
  } catch { /* */ }
}

function matchFirst(haystack: string, re: RegExp): string | null {
  const m = haystack.match(re);
  return m ? m[0] : null;
}

function upsertEnvLocal(url: string, token: string): void {
  let body = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  body = upsertLine(body, 'UPSTASH_REDIS_REST_URL', url);
  body = upsertLine(body, 'UPSTASH_REDIS_REST_TOKEN', token);
  writeFileSync(ENV_PATH, body, 'utf8');
}

function upsertLine(body: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (re.test(body)) return body.replace(re, line);
  return (body && !body.endsWith('\n') ? body + '\n' : body) + line + '\n';
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: existsSync(STATE_PATH) ? STATE_PATH : undefined,
  });
  const page = await ctx.newPage();

  await page.goto(DASHBOARD);
  await waitForLogin(page);
  const dbId = await pickFirstRedisDb(page);
  const creds = await readRestCredentials(page, dbId);

  // Persist auth so the next run is one-click.
  await ctx.storageState({ path: STATE_PATH });
  upsertEnvLocal(creds.url, creds.token);

  console.log('[setup-upstash] ✓ Wrote UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to .env.local');
  console.log(`[setup-upstash]   URL:   ${creds.url}`);
  console.log(`[setup-upstash]   Token: ${creds.token.slice(0, 8)}…${creds.token.slice(-4)} (${creds.token.length} chars)`);

  await browser.close();
})().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[setup-upstash] FAILED:', msg);
  process.exit(1);
});
