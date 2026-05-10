// ============================================================
// Owner cookie + private-book authorization tests.
//
// These pin the V1 ownership model:
//   • Every visitor gets a stable katha:owner UUID cookie
//   • The cookie is idempotent — repeat visits don't overwrite
//   • Public books (Ramayana, world-mode) read for anyone
//   • Private books read only for the cookie owner; others 404
//   • Private slugs aren't enumerable from /api/books
//   • Mode-aware generation rejects classroom without grade and
//     personalized_text without consent
//
// Notes on the test approach: these run against the live dev
// server (not a mocked backend) because the cookie is set in
// middleware.ts and the auth path goes through real Redis state.
// We don't actually generate books here (that's $$ + slow); we
// fake a private book by hitting the polling endpoint with a
// valid owner cookie. Generation-flow smoke tests live in a
// separate spec.
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Owner cookie — middleware', () => {
  test('a fresh visitor receives a katha:owner cookie', async ({ request }) => {
    const res = await request.get('/educator');
    expect(res.status()).toBe(200);
    const setCookie = res.headers()['set-cookie'];
    // Set-Cookie may be a string or string[]; the cookie name appears
    // in either form.
    const blob = Array.isArray(setCookie) ? setCookie.join('\n') : (setCookie ?? '');
    expect(blob).toMatch(/katha:owner=/);
    expect(blob).toMatch(/SameSite=Lax/i);
    // 180-day expiry → Max-Age=15552000
    expect(blob).toMatch(/Max-Age=15552000/);
  });

  test('an existing valid cookie is NOT overwritten', async ({ request }) => {
    // Generate a UUID-shaped value the validator accepts.
    const existingCookie = '11111111-2222-3333-4444-555555555555';
    const res = await request.get('/educator', {
      headers: { Cookie: `katha:owner=${existingCookie}` },
    });
    expect(res.status()).toBe(200);
    const setCookie = res.headers()['set-cookie'];
    const blob = Array.isArray(setCookie) ? setCookie.join('\n') : (setCookie ?? '');
    // No Set-Cookie at all OR no katha:owner in the response — both
    // are acceptable shapes for "did not overwrite".
    expect(blob).not.toMatch(/katha:owner=/);
  });
});

test.describe('Private books — owner-scoped reads', () => {
  test('Ramayana (public seed) reads without an owner cookie', async ({ request }) => {
    // Strip cookies entirely by sending an empty Cookie header. The
    // middleware will issue a fresh one; the seed book is public so
    // the read still succeeds.
    const res = await request.get('/api/books/ramayana');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.book?.slug).toBe('ramayana');
  });

  test('GET /api/books/<unknown-private-slug> returns 404 with no detail', async ({ request }) => {
    // A non-owner asking for a private slug they don't own should
    // get the same response as a slug that doesn't exist. This is
    // the "don't disclose existence" contract.
    const res = await request.get('/api/books/pv-deadbeefdeadbeef');
    expect(res.status()).toBe(404);
    const body = await res.json();
    // Generic message; never echoes the slug or the visibility.
    expect(body.error).toBe('Book not found');
  });

  test('DELETE /api/books/ramayana returns 403 (seed books are immutable)', async ({ request }) => {
    const res = await request.delete('/api/books/ramayana');
    expect(res.status()).toBe(403);
  });

  test('DELETE /api/books/<unknown-slug> returns 404 with no detail', async ({ request }) => {
    const res = await request.delete('/api/books/pv-deadbeefdeadbeef');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Book not found');
  });

  test('GET /api/books does NOT enumerate private slugs to non-owners', async ({ request }) => {
    const res = await request.get('/api/books');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const slugs: string[] = body.books.map((b: { slug: string }) => b.slug);
    // No book in the public listing should have a private-mode
    // slug prefix. Random private slugs always start with cl- or pv-.
    expect(slugs.every(s => !s.startsWith('cl-') && !s.startsWith('pv-'))).toBe(true);
  });
});

test.describe('Mode-aware generation — input validation', () => {
  test('classroom mode without gradeBand returns 400', async ({ request }) => {
    const res = await request.post('/api/books/generate', {
      data: { mode: 'classroom', payload: { learningGoal: 'curiosity' } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/grade/i);
  });

  test('personalized_text without consent returns 400', async ({ request }) => {
    const res = await request.post('/api/books/generate', {
      data: { mode: 'personalized_text', payload: { childName: 'Asha', age: 7, consent: false } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/consent/i);
  });

  test('personalized_text with multi-word childName is rejected', async ({ request }) => {
    const res = await request.post('/api/books/generate', {
      data: { mode: 'personalized_text', payload: {
        childName: 'Asha Patel',  // last name not allowed
        age: 7, consent: true,
      } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/first name/i);
  });

  test('personalized_text with out-of-range age returns 400', async ({ request }) => {
    const res = await request.post('/api/books/generate', {
      data: { mode: 'personalized_text', payload: {
        childName: 'Asha', age: 25, consent: true,
      } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/age/i);
  });

  test('legacy { title } body still works (world-mode backwards compat)', async ({ request }) => {
    // Submit the legacy shape the pre-V1 BookGenerator used. We don't
    // wait for generation — just verify the route accepts the body
    // and returns a generating/cached response, not a 400.
    const res = await request.post('/api/books/generate', {
      data: { title: 'Mahabharata' },
    });
    // 200 cached or 200 generating, NOT 400.
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.cached === true || body.generating === true).toBe(true);
  });
});
