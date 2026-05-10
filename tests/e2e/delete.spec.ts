// ============================================================
// Delete-affordance tests.
//
// The DeleteBookButton self-hides on public/seed books and shows
// only on private books the cookie owner owns. The DELETE route
// 403s for seed/public, 404s for non-owners on private.
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Delete button — self-hides for public/seed books', () => {
  test('the Ramayana reader does NOT show the delete button', async ({ page }) => {
    await page.goto('/books/ramayana');
    await page.waitForLoadState('networkidle');
    // The button should never render for a seed book — anyone
    // could tab to it and accidentally delete (it'd 403, but the
    // button shouldn't even exist). The component fetches the
    // book metadata and stays hidden when visibility != 'private'.
    await expect(page.getByTestId('delete-book-button')).toHaveCount(0);
  });
});

test.describe('Delete route — server-side rules', () => {
  test('DELETE /api/books/ramayana → 403 (seed books are immutable)', async ({ request }) => {
    const res = await request.delete('/api/books/ramayana');
    expect(res.status()).toBe(403);
  });

  test('DELETE /api/books/<bogus> → 404 with no detail', async ({ request }) => {
    const res = await request.delete('/api/books/nope-this-does-not-exist');
    expect(res.status()).toBe(404);
    const body = await res.json();
    // Generic "not found" — never echoes the slug or visibility.
    expect(body.error).toBe('Book not found');
  });
});
