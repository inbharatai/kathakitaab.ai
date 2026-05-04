import { defineConfig, devices } from '@playwright/test';

// When PLAYWRIGHT_BASE_URL is set (e.g. to the Vercel production URL),
// skip the local dev server and run tests against the deployed site.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5009';
const useDevServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  ...(useDevServer && {
    webServer: {
      command: 'npm run dev',
      url: 'http://localhost:5009',
      reuseExistingServer: !process.env.CI,
    },
  }),
});
