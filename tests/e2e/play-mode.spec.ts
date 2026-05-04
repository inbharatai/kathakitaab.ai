import { test, expect, type Page } from '@playwright/test';

async function readPlaySession(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('kathakitaab_play_session:ramayana');
    return raw ? JSON.parse(raw) : null;
  });
}

test.describe('Play Mode - Ramayana', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    await page.route('**/api/livebook/agent', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            label: 'EXPLANATION',
            answer: 'Playwright stub response.',
            source_note: 'Playwright stub.',
            next_options: ['Continue the story', 'Explore another detail', 'Ask another question'],
            safety_note: 'Playwright stub.',
          },
          cached: false,
          cacheKey: 'playwright-livebook-agent-stub',
        }),
      });
    });
  });

  test('deterministic actions update session state and reset cleanly', async ({ page }) => {
    await page.goto('/play/ramayana');

    await page.getByRole('button', { name: /The Hero/i }).click();
    await page.getByRole('button', { name: /Enter as The Hero/i }).click();

    await expect(page.getByRole('button', { name: 'Change Character' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Princes of Ayodhya' })).toBeVisible();

    await page.getByRole('button', { name: /Examine Scene/i }).click();

    await expect.poll(async () => {
      const session = await readPlaySession(page);
      const quest = session?.questState?.activeQuests?.find(
        (item: { id: string }) => item.id === 'quest-main-ayodhya_intro'
      );

      return {
        unlockedTools: session?.unlockedTools ?? [],
        exploreComplete: quest?.objectives?.find(
          (objective: { id: string; completed: boolean }) => objective.id === 'obj-explore-ayodhya_intro'
        )?.completed ?? false,
      };
    }).toEqual({
      unlockedTools: expect.arrayContaining(['talking-conch', 'world-compass', 'wisdom-scroll']),
      exploreComplete: true,
    });

    await page.getByRole('button', { name: /Talk to Rama/i }).click();
    await page.getByRole('textbox', { name: 'What do you want to say?' }).fill(
      'Rama, how do you stay steady when duty hurts?'
    );
    await page.getByRole('button', { name: /^Send$/ }).click();

    await expect.poll(async () => {
      const session = await readPlaySession(page);
      const quest = session?.questState?.activeQuests?.find(
        (item: { id: string }) => item.id === 'quest-main-ayodhya_intro'
      );

      return quest?.objectives?.find(
        (objective: { id: string; completed: boolean }) => objective.id === 'obj-interact-ayodhya_intro'
      )?.completed ?? false;
    }).toBe(true);

    await page.getByRole('button', { name: /Create/i }).click();
    await page.getByRole('textbox', { name: 'What do you want to do?' }).fill(
      'I create a promise stone to remember that truth matters more than comfort.'
    );
    await page.getByRole('button', { name: /^Send$/ }).click();

    await expect(page.getByText('New mission complete: Chapter Quest: The Princes of Ayodhya.', { exact: false })).toBeVisible();

    await expect.poll(async () => {
      const session = await readPlaySession(page);
      return {
        unlockedTools: session?.unlockedTools ?? [],
        completedQuestIds: session?.questState?.completedQuestIds ?? [],
        totalQuestsCompleted: session?.questState?.totalQuestsCompleted ?? 0,
        storyCardIds: (session?.questState?.storyCards ?? []).map(
          (card: { id: string }) => card.id
        ),
      };
    }).toEqual({
      unlockedTools: expect.arrayContaining(['talking-conch', 'world-compass', 'wisdom-scroll', 'comic-forge']),
      completedQuestIds: expect.arrayContaining(['quest-main-ayodhya_intro']),
      totalQuestsCompleted: 1,
      storyCardIds: expect.arrayContaining(['card-ayodhya_intro']),
    });

    await page.getByRole('button', { name: 'Change Character' }).click();
    await expect(page.getByRole('heading', { name: 'Choose Your Character' })).toBeVisible();

    await expect.poll(async () => page.evaluate(() => Object.keys(window.localStorage))).toEqual([]);
  });
});