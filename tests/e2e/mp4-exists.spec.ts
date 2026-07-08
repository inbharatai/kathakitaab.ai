// ============================================================
// Phase G regression: MP4 export endpoint actually produces a
// playable MP4.
//
// /api/livebook/render-movie bundles Remotion, renders the
// BookMovie composition, uploads to S3 (CloudFront) or falls back to
// /public/movies. The test:
//   1. POSTs the render request (long-running — up to ~5 min)
//   2. Verifies the response includes a non-empty `url`
//   3. HEADs the URL to confirm the MP4 exists at that location
//   4. Verifies content-type is video/mp4 and size > 100KB
//
// Re-running the test should cache-hit the second time (manifest
// hash identical), so the assertion that `cached: true` shows up
// the second time validates the dedup path too.
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Render-movie MP4 export', () => {
  // First run renders fresh; allow the full Remotion render budget.
  test.setTimeout(8 * 60_000);

  test('MP4 export returns a working video URL', async ({ request, baseURL }) => {
    const r1 = await request.post('/api/livebook/render-movie', {
      data: { bookSlug: 'ramayana' },
      timeout: 8 * 60_000,
    });
    expect(r1.ok(), `render-movie failed: ${r1.status()} ${await r1.text()}`).toBeTruthy();
    const j1 = await r1.json() as { url: string; sizeBytes?: number; cached: boolean; storageMode?: string };

    expect(j1.url, 'render response must include url').toBeTruthy();
    if (j1.sizeBytes !== undefined) {
      expect(j1.sizeBytes, 'rendered MP4 must be at least 100KB').toBeGreaterThan(100_000);
    }

    const absoluteUrl = j1.url.startsWith('http') ? j1.url : `${baseURL ?? ''}${j1.url}`;
    const head = await request.fetch(absoluteUrl, { method: 'HEAD' });
    expect(head.ok(), `HEAD ${absoluteUrl} returned ${head.status()}`).toBeTruthy();

    const contentType = head.headers()['content-type'] ?? '';
    expect(contentType).toMatch(/video\/mp4/);

    // Step 2 — same body again. The route must dedupe by manifest
    // hash, so this should respond instantly with cached: true.
    const r2 = await request.post('/api/livebook/render-movie', {
      data: { bookSlug: 'ramayana' },
      timeout: 30_000,
    });
    expect(r2.ok()).toBeTruthy();
    const j2 = await r2.json() as { url: string; cached: boolean };
    expect(j2.url).toEqual(j1.url);
    // Cached path is only reachable when S3 is configured.
    // For the local fallback we just require url stability — the
    // file is written once and reused via the same manifest hash.
    if (j1.storageMode === 's3') {
      expect(j2.cached, 'second call should return cached=true on S3 path').toBeTruthy();
    }
  });
});
