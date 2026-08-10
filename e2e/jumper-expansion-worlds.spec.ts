import { expect, test } from '@playwright/test';

test('Dinosaur Jungle is a revisitable banana world', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify([
      'surface', 'dinosaurJungle',
    ]));
  });
  await page.goto('/Funsounds/?game=buddy');
  await page.locator('#jp-world-map-button').click();
  await page.locator('[data-jp-world="dinosaurJungle"]').click();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'dinosaurJungle');
  await expect(page.locator('#jp-status')).toContainText('bananas');
  await page.locator('#jp-canvas').screenshot({ path: '/tmp/jumper-dinosaur-jungle.png' });
  expect(errors).toEqual([]);
});
