import { expect, test } from '@playwright/test';

test('Buddy world map pauses play and revisits every layer without resetting snacks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  await page.addInitScript(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify([
      'surface', 'candy', 'upperAtmosphere', 'moonBase', 'dinosaurJungle', 'volcano', 'sunkenCastle', 'cave', 'underwater', 'deepSea',
    ]));
  });

  await page.goto('/Funsounds/?game=buddy');
  await page.waitForLoadState('networkidle');

  const mapButton = page.locator('#jp-world-map-button');
  const map = page.locator('#jp-world-map');
  await expect(mapButton).toBeVisible();

  // Eat the nearby surface snack so map travel can prove per-run progress is preserved.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(450);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('Space');
  await expect(page.locator('#jp-snacks')).toHaveText('1');

  await mapButton.click();
  await expect(map).toBeVisible();
  await expect(map.locator('[data-jp-world]')).toHaveCount(10);
  await expect(map.locator('[data-jp-world="surface"]')).toHaveClass(/current/);
  await expect(mapButton).toHaveAttribute('aria-expanded', 'true');
  await map.screenshot({ path: '/tmp/jumper-world-map.png' });

  await map.locator('[data-jp-world="upperAtmosphere"]').click();
  await expect(map).toBeHidden();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'upperAtmosphere');
  await expect(page.locator('#jp-status')).toContainText('croissants');
  await expect(page.locator('#jp-snacks')).toHaveText('1');

  await page.keyboard.press('KeyM');
  await expect(map).toBeVisible();
  await expect(map.locator('[data-jp-world="upperAtmosphere"]')).toHaveClass(/current/);
  await map.locator('[data-jp-world="cave"]').click();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'cave');

  await page.keyboard.press('KeyM');
  await expect(map).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(map).toBeHidden();

  await page.keyboard.press('Digit2');
  await expect(page.locator('#jp-mode')).toContainText('Jump Over');
  await expect(mapButton).toBeHidden();
  expect(errors).toEqual([]);
});

test('unexplored worlds stay locked until Buddy discovers them', async ({ page }) => {
  await page.goto('/Funsounds/?game=buddy');
  const map = page.locator('#jp-world-map');
  await page.locator('#jp-world-map-button').click();

  await expect(map.locator('[data-jp-world="surface"]')).toBeEnabled();
  await expect(map.locator('[data-jp-world="surface"]')).toHaveClass(/current/);
  await expect(map.locator('[data-jp-world]:disabled')).toHaveCount(9);
  await expect(map.locator('[data-jp-world="cave"]')).toHaveClass(/locked/);
  await map.screenshot({ path: '/tmp/jumper-world-map-locked.png' });

  // Return to play and run into the first pit: that naturally discovers the cave.
  await page.keyboard.press('Escape');
  await page.keyboard.down('ArrowRight');
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'cave', { timeout: 5000 });
  await page.keyboard.up('ArrowRight');

  await page.locator('#jp-world-map-button').click();
  await expect(map.locator('[data-jp-world="cave"]')).toBeEnabled();

  // Discoveries survive a new run/page load.
  await page.reload();
  await page.locator('#jp-world-map-button').click();
  await expect(map.locator('[data-jp-world="cave"]')).toBeEnabled();
  await expect(map.locator('[data-jp-world="upperAtmosphere"]')).toBeDisabled();
});

test('world map route fits on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/Funsounds/?game=wedding');
  await page.locator('#jp-world-map-button').click();

  const panel = await page.locator('.jp-world-map-panel').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(844);
});
