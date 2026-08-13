import { expect, test } from '@playwright/test';

test('Buddy hints explain the Rainbow lock and secret world routes', async ({ page }) => {
  await page.goto('/Funsounds/?game=buddy');

  const button = page.locator('#jp-hint-button');
  const sheet = page.locator('#jp-hint-sheet');
  await expect(button).toBeVisible();

  await button.click();
  await expect(sheet).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#jp-hint-rainbow')).toContainText('There is no key to collect');
  await expect(page.locator('#jp-hint-rainbow')).toContainText('10 worlds to go');
  await expect(page.locator('#jp-hint-next')).toContainText('flying bird');
  await expect(sheet).toContainText('Giant vine');
  await expect(sheet).toContainText('dragon door');
  await sheet.screenshot({ path: '/tmp/jumper-buddy-hints.png' });

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('KeyH');
  await expect(sheet).toBeVisible();
});

test('tapping a locked map world reveals its discovery route', async ({ page }) => {
  await page.goto('/Funsounds/?game=buddy');
  await page.locator('#jp-world-map-button').click();

  const mapHint = page.locator('#jp-world-map-hint');
  await page.locator('[data-jp-world="volcano"]').click();
  await expect(page.locator('#jp-world-map')).toBeVisible();
  await expect(mapHint).toContainText('Volcano World');
  await expect(mapHint).toContainText('dragon door');
  await page.locator('#jp-world-map').screenshot({ path: '/tmp/jumper-locked-world-hint.png' });

  await page.locator('[data-jp-world="rainbowDreamland"]').click();
  await expect(mapHint).toContainText('Rainbow Dreamland');
  await expect(mapHint).toContainText('There is no key to collect');
});

test('Buddy hints recognize when the Rainbow gate is unlocked', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify([
      'surface', 'candy', 'upperAtmosphere', 'moonBase', 'dinosaurJungle',
      'volcano', 'sunkenCastle', 'toyRoom', 'cave', 'underwater', 'deepSea',
    ]));
  });
  await page.goto('/Funsounds/?game=buddy');
  await page.locator('#jp-hint-button').click();

  await expect(page.locator('#jp-hint-rainbow')).toContainText('gate is unlocked');
  await expect(page.locator('#jp-hint-next')).toContainText('Rainbow gate is ready');
});

test('Buddy hint sheet fits on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/Funsounds/?game=buddy');
  await page.locator('#jp-hint-button').click();

  const panel = await page.locator('.jp-hint-panel').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(844);
});
