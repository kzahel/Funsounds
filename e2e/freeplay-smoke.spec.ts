import { test, expect } from '@playwright/test';

const modes = ['objects', 'alphabet', 'colors', 'numbers', 'sounds'] as const;

test('Free Play opens a populated grid for every mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  for (const mode of modes) {
    await page.goto('/Funsounds/');
    await page.waitForLoadState('networkidle');

    await page.locator(`.mode-btn[data-mode="${mode}"]`).click();
    await page.locator('#start-btn').click();

    const grid = page.locator('#touch-grid');
    await expect(grid).toBeVisible();
    await expect(page.locator('#play-area')).toBeHidden();

    const buttons = grid.locator('.touch-btn');
    await expect(buttons).toHaveCount(6);

    if (mode === 'colors') {
      await expect(grid.locator('.color-swatch')).toHaveCount(6);
    } else {
      await expect(grid.locator('.emoji')).toHaveCount(6);
    }

    if (mode === 'alphabet' || mode === 'numbers') {
      await expect(grid.locator('.text-choice')).toHaveCount(6);
    }

    await buttons.first().click();
    await expect(grid).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test('Free Play ignores Mac browser shortcut keys', async ({ page }) => {
  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');

  const startAllowed = await page.evaluate(() => {
    const metaAllowed = document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true, cancelable: true }),
    );
    const refreshAllowed = document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true, cancelable: true }),
    );
    return { metaAllowed, refreshAllowed };
  });

  expect(startAllowed).toEqual({ metaAllowed: true, refreshAllowed: true });
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#touch-grid')).toBeHidden();

  await page.locator('#start-btn').click();
  await expect(page.locator('#touch-grid')).toBeVisible();

  const activeAllowed = await page.evaluate(() => document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true, cancelable: true }),
  ));
  expect(activeAllowed).toBe(true);
  await expect(page.locator('#touch-grid')).toBeVisible();
});
