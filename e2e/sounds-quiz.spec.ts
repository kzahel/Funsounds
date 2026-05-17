import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    (window as unknown as { __soundQuizPlayCount: number }).__soundQuizPlayCount = 0;
    HTMLMediaElement.prototype.play = function patchedPlay() {
      (window as unknown as { __soundQuizPlayCount: number }).__soundQuizPlayCount++;
      setTimeout(() => this.dispatchEvent(new Event('ended')), 0);
      return Promise.resolve();
    };
    (window as unknown as { __restoreSoundQuizPlay?: () => void }).__restoreSoundQuizPlay = () => {
      HTMLMediaElement.prototype.play = originalPlay;
    };
  });
});

test('Sounds quiz uses pictures on Easy and words on Hard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const setDifficulty = async (value: string) => {
    await page.locator('#difficulty-slider').evaluate((el, nextValue) => {
      const slider = el as HTMLInputElement;
      slider.value = nextValue;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  };

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');
  await page.locator('.mode-btn[data-mode="sounds"]').click();
  await setDifficulty('1');
  await page.locator('#quiz-btn').click();

  await expect(page.locator('#quiz-grid .quiz-btn')).toHaveCount(2);
  await expect(page.locator('#quiz-grid .emoji')).toHaveCount(2);
  await expect(page.locator('#quiz-grid .text-choice')).toHaveCount(0);
  await page.waitForFunction(() => (window as unknown as { __soundQuizPlayCount: number }).__soundQuizPlayCount > 0);
  expect(await page.evaluate(() => (window as unknown as { __soundQuizPlayCount: number }).__soundQuizPlayCount))
    .toBeGreaterThan(0);

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');
  await page.locator('.mode-btn[data-mode="sounds"]').click();
  await setDifficulty('3');
  await page.locator('#quiz-btn').click();

  await expect(page.locator('#quiz-grid .quiz-btn')).toHaveCount(6);
  await expect(page.locator('#quiz-grid .text-choice')).toHaveCount(6);

  const labels = await page.locator('#quiz-grid .text-choice').allTextContents();
  expect(labels.length).toBe(6);
  for (const label of labels) {
    expect(label).toBe(label.toUpperCase());
    expect(label).toMatch(/^[A-Z]+$/);
  }

  expect(errors).toEqual([]);
});
