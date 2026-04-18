import { test, expect } from '@playwright/test';

test('Train Builder smoke — opens, places track, and renders without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');

  const startBtn = page.locator('#train-btn');
  await expect(startBtn).toBeVisible();
  await startBtn.click();

  const screen = page.locator('#train-screen');
  await expect(screen).toBeVisible();

  // Toolbar should render with all 5 tabs
  const tabs = page.locator('#tg-tabs .tg-tab');
  await expect(tabs).toHaveCount(5);

  // Default tab is "tracks", and at least one tool button should appear
  const tools = page.locator('#tg-buttons .tg-tool');
  await expect(tools.first()).toBeVisible();

  // Grid container should have a grid div with tiles
  const tiles = page.locator('#tg-grid .tg-tile');
  const tileCount = await tiles.count();
  expect(tileCount).toBeGreaterThan(20);

  // Tap a tile to place a track
  const tileBox = await tiles.nth(20).boundingBox();
  expect(tileBox).not.toBeNull();
  await page.mouse.click(tileBox!.x + tileBox!.width / 2, tileBox!.y + tileBox!.height / 2);
  await page.waitForTimeout(100);

  // The tapped tile should now contain an SVG <path> element (the track)
  const trackPaths = page.locator('#tg-grid .tg-tile svg path');
  expect(await trackPaths.count()).toBeGreaterThan(0);

  // Switch to the animals tab and place an animal
  await page.locator('.tg-tab').nth(3).click();
  await expect(page.locator('#tg-buttons .tg-tool').first()).toBeVisible();
  await page.locator('#tg-buttons .tg-tool').first().click();
  const tileBox2 = await tiles.nth(5).boundingBox();
  await page.mouse.click(tileBox2!.x + tileBox2!.width / 2, tileBox2!.y + tileBox2!.height / 2);
  await page.waitForTimeout(100);

  const animals = page.locator('.tg-animal');
  expect(await animals.count()).toBeGreaterThanOrEqual(1);

  // Clear should reset everything
  await page.locator('#tg-clear-btn').click();
  await page.waitForTimeout(100);
  expect(await page.locator('.tg-animal').count()).toBe(0);

  expect(errors).toEqual([]);
});
