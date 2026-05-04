import { test, expect } from '@playwright/test';

test.describe('Kathakitab.ai MVP - Ramayana LiveBook', () => {
  
  test('Home page loads and CTA works', async ({ page }) => {
    // 1. Open home page
    await page.goto('/');
    
    // Verify hero text
    await expect(page.getByText('Kathakitab.ai', { exact: false })).toBeVisible();
    await expect(page.getByText('Books that come alive', { exact: false })).toBeVisible();
    
    // 2. Click "Start Ramayana LiveBook"
    const startBtn = page.locator('#start-ramayana-btn');
    await expect(startBtn).toBeVisible();
    
    // Verify href
    await expect(startBtn).toHaveAttribute('href', '/books/ramayana');
    
    // Click it and wait for navigation
    await startBtn.click();
    await page.waitForURL('**/books/ramayana');
    
    // Check that we are on the book page and scene loaded
    await expect(page.getByText('The Princes of Ayodhya')).toBeVisible();
  });

  test('Scene viewer has clickable hotspots and character drawer works', async ({ page }) => {
    // Go directly to the first scene
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    
    // 3. Verify scene title appears
    await expect(page.getByRole('heading', { name: 'The Princes of Ayodhya' })).toBeVisible();
    
    // Wait for hotspots to render
    await page.waitForSelector('.hotspot-marker');

    // 4. Click Rama hotspot
    const ramaHotspot = page.locator('#hotspot-rama');
    await expect(ramaHotspot).toBeVisible();
    await ramaHotspot.click();

    // 5. Verify Rama character drawer opens
    const drawer = page.locator('.drawer-panel');
    await expect(drawer).toBeVisible();
    
    // Check character name in drawer
    await expect(drawer.getByRole('heading', { name: 'Rama', exact: true })).toBeVisible();
    
    // Check traits exist
    await expect(drawer.getByText('truthful')).toBeVisible();
    await expect(drawer.getByText('compassionate')).toBeVisible();
  });

  test('Ask character panel works', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    
    // Open drawer
    await page.locator('#hotspot-rama').click();
    
    // 6. Ask: "Why did you accept exile?"
    const input = page.getByPlaceholder('Ask Rama something...').first();
    await expect(input).toBeVisible();
    await input.fill('Why did you accept exile?');
    
    const askButton = page.getByRole('button', { name: 'Ask' }).first();
    await askButton.click();
    
    // 7. Verify thinking state appears
    await expect(page.getByText('Rama is thinking...')).toBeVisible();
    
    // Wait for response or fallback
    // Since API key might not be present, we expect fallback response
    await page.waitForTimeout(2000); // Wait for mock/real response
    
    // 8. Verify answer area appears and label badge is shown
    // It should have some label like EXPLANATION or CANON
    const fallbackText = page.getByText('API key is not configured', { exact: false });
    const realResponseLabel = page.locator('.label-badge');
    
    // Either fallback shows up or a real response label shows up
    if (await fallbackText.isVisible()) {
      await expect(fallbackText).toBeVisible();
    } else {
      await expect(realResponseLabel).toBeVisible();
    }
  });

  test('Scene navigation works', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    
    // 9. Navigate to next scene
    const nextButton = page.locator('button:has-text("Next Scene")').first();
    await expect(nextButton).toBeVisible();
    await nextButton.click();
    
    // 10. Verify next scene title changes
    await expect(page.getByRole('heading', { name: 'Sita and the Bow of Shiva' })).toBeVisible();
    
    // Verify URL updated
    expect(page.url()).toContain('scene=mithila_bow');
  });

  test('Quiz mode works', async ({ page }) => {
    await page.goto('/books/ramayana?scene=ayodhya_intro');
    
    // Switch to quiz mode
    const quizTab = page.getByRole('button', { name: /Quiz/i });
    await quizTab.click();
    
    // Check quiz question
    await expect(page.getByText('Who was the king of Ayodhya?')).toBeVisible();
    
    // Select correct answer
    await page.getByRole('button', { name: 'Dasharatha' }).click();
    
    // Check correct feedback
    await expect(page.getByText('Correct!')).toBeVisible();
    await expect(page.getByText('King Dasharatha was the ruler of Ayodhya and father of Rama.')).toBeVisible();
  });
});
