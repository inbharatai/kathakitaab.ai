// ============================================================
// Logging-scrubber unit tests, run inside Playwright so we get
// the same Node + tsconfig context as the rest of the suite. The
// scrubber doesn't need a browser; we use page.evaluate(() => {})
// only as a transport. Asserts are made on the test side.
// ============================================================

import { test, expect } from '@playwright/test';
import { scrub, scrubError, redactString } from '../../lib/safety/scrub';

test.describe('redactString — pattern-based PII removal', () => {
  test('redacts email addresses', () => {
    const out = redactString('error contacting parent@example.com today');
    expect(out).not.toContain('parent@example.com');
    expect(out).toContain('[redacted]');
  });

  test('redacts Indian-shape phone numbers', () => {
    const out = redactString('contacted user at 9876543210 yesterday');
    expect(out).not.toContain('9876543210');
    expect(out).toContain('[redacted]');
  });

  test('redacts private slug shapes (cl- / pv- / pp-)', () => {
    const out = redactString('failed for slug cl-9bc311e8a4c846f1 and pv-5f4f07019e7e46a0');
    expect(out).not.toContain('cl-9bc311e8a4c846f1');
    expect(out).not.toContain('pv-5f4f07019e7e46a0');
    expect(out.match(/\[redacted\]/g)?.length).toBe(2);
  });

  test('redacts UUID owner-cookie shapes', () => {
    const out = redactString('owner aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee tried to read');
    expect(out).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  test('leaves ordinary text alone', () => {
    const out = redactString('the moon rose over the river');
    expect(out).toBe('the moon rose over the river');
  });
});

test.describe('scrub — recursive object cleanup', () => {
  test('redacts sensitive top-level keys (childName, ownerId, prompt, etc.)', () => {
    const out = scrub({
      childName: 'Asha',
      age: 7,
      ownerId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      prompt: 'helps a moon rabbit',
      title: 'A Story',
    });
    expect(out).toEqual({
      childName: '[redacted]',
      age: 7,
      ownerId: '[redacted]',
      prompt: '[redacted]',
      title: 'A Story',
    });
  });

  test('redacts nested sensitive keys', () => {
    const out = scrub({
      mode: 'personalized_text',
      payload: {
        childName: 'Asha',
        age: 7,
        interests: 'animals, space',
      },
    });
    const payload = (out as { payload: { childName: string; age: number; interests: string } }).payload;
    expect(payload.childName).toBe('[redacted]');
    expect(payload.age).toBe(7);
    expect(payload.interests).toBe('[redacted]');
  });

  test('redacts photo-related keys (V3-ready)', () => {
    const out = scrub({
      photoPath: 'private/asha.jpg',
      photoUrl: 'https://supabase.example/private/asha.jpg',
      uploadKey: 'kk-upload-abc123',
    }) as Record<string, string>;
    expect(out.photoPath).toBe('[redacted]');
    expect(out.photoUrl).toBe('[redacted]');
    expect(out.uploadKey).toBe('[redacted]');
  });

  test('redacts auth/cookie/api-key fields', () => {
    const out = scrub({
      cookie: 'katha:owner=…',
      authorization: 'Bearer sk-…',
      apiKey: 'sk-proj-…',
    }) as Record<string, string>;
    expect(out.cookie).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
  });

  test('also redacts sensitive patterns inside string VALUES', () => {
    // Even when the field name isn't in our blocklist, an email or
    // slug landing in a free-form string gets replaced.
    const out = scrub({
      message: 'contact parent@example.com about cl-9bc311e8a4c846f1',
    }) as { message: string };
    expect(out.message).not.toContain('parent@example.com');
    expect(out.message).not.toContain('cl-9bc311e8a4c846f1');
  });

  test('handles arrays and is cycle-safe', () => {
    type Cycle = { x: { childName: string; loop?: Cycle['x'] } };
    const cycle: Cycle = { x: { childName: 'Asha' } };
    cycle.x.loop = cycle.x;
    const out = scrub(cycle) as Cycle;
    expect(out.x.childName).toBe('[redacted]');
    // The cycle is broken with [redacted], not infinitely deep.
    expect(out.x.loop).toBe('[redacted]');
  });

  test('preserves null, undefined, primitives', () => {
    expect(scrub(null)).toBeNull();
    expect(scrub(undefined)).toBeUndefined();
    expect(scrub(42)).toBe(42);
    expect(scrub(true)).toBe(true);
  });
});

test.describe('scrubError — extract a safe { name, message } shape', () => {
  test('Error instances → name + redacted message', () => {
    const err = new Error('failed for child Asha at slug cl-9bc311e8a4c846f1');
    const out = scrubError(err);
    expect(out.name).toBe('Error');
    expect(out.message).not.toContain('cl-9bc311e8a4c846f1');
    expect(out.message).toContain('[redacted]');
  });

  test('thrown strings are wrapped + redacted', () => {
    const out = scrubError('stack trace at parent@example.com');
    expect(out.name).toBe('Error');
    expect(out.message).not.toContain('parent@example.com');
  });

  test('non-error thrown values yield a generic shape', () => {
    const out = scrubError({ secret: 'do not log this' });
    expect(out.name).toBe('NonError');
    expect(out.message).toBe('[redacted]');
  });
});
