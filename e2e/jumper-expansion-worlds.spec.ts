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

test('Volcano World has marshmallows, obsidian ledges, and a sleepy dragon', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify(['surface', 'volcano']));
  });
  await page.goto('/Funsounds/?game=buddy');
  await page.locator('#jp-world-map-button').click();
  await page.locator('[data-jp-world="volcano"]').click();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'volcano');
  await expect(page.locator('#jp-status')).toContainText('toasted marshmallows');
  await page.locator('#jp-canvas').screenshot({ path: '/tmp/jumper-volcano-world.png' });
  expect(errors).toEqual([]);
});

test('Sunken Castle preserves swimming and renders pearl-candy castle art', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify(['surface', 'sunkenCastle']));
  });
  await page.goto('/Funsounds/?game=wedding');
  await page.locator('#jp-world-map-button').click();
  await page.locator('[data-jp-world="sunkenCastle"]').click();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'sunkenCastle');
  await expect(page.locator('#jp-status')).toContainText('pearl candy');
  await page.keyboard.press('ArrowUp');
  await page.locator('#jp-canvas').screenshot({ path: '/tmp/jumper-sunken-castle.png' });
  expect(errors).toEqual([]);
});

test('Rainbow Dreamland is bouncy and full of cookies, rainbows, and unicorns', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify(['surface', 'rainbowDreamland']));
  });
  await page.goto('/Funsounds/?game=buddy');
  await page.locator('#jp-world-map-button').click();
  await page.locator('[data-jp-world="rainbowDreamland"]').click();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'rainbowDreamland');
  await expect(page.locator('#jp-status')).toContainText('sprinkle cookies');
  await page.locator('#jp-canvas').screenshot({ path: '/tmp/jumper-rainbow-dreamland.png' });
  expect(errors).toEqual([]);
});

test('the Rainbow gate requires every other world to be explored', async ({ page }) => {
  await page.goto('/Funsounds/?game=buddy');
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-rainbow-gate-locked', 'true');

  await page.evaluate(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify([
      'surface', 'candy', 'upperAtmosphere', 'moonBase', 'dinosaurJungle',
      'volcano', 'sunkenCastle', 'cave', 'underwater', 'deepSea',
    ]));
  });
  await page.reload();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-rainbow-gate-locked', 'false');
});
