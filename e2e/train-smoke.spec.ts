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

  // Place a pigeon (last button on the animals tab) and verify it flies on its own
  const animalTools = page.locator('#tg-buttons .tg-tool');
  await animalTools.last().click();
  const pigeonTile = await tiles.nth(40).boundingBox();
  await page.mouse.click(pigeonTile!.x + pigeonTile!.width / 2, pigeonTile!.y + pigeonTile!.height / 2);
  await page.waitForTimeout(50);
  const pigeonEl = page.locator('.tg-animal').last();
  const before = await pigeonEl.boundingBox();
  await page.waitForTimeout(700);
  const after = await pigeonEl.boundingBox();
  const moved = Math.hypot((after!.x - before!.x), (after!.y - before!.y));
  expect(moved).toBeGreaterThan(2); // pigeon should drift

  // Switch to Tools tab and pick the drag tool, then drag the pigeon to a new spot
  await page.locator('.tg-tab').nth(4).click();
  const toolButtons = page.locator('#tg-buttons .tg-tool');
  await toolButtons.first().click(); // Grab
  const dragTarget = await tiles.nth(80).boundingBox();
  const startBox = await pigeonEl.boundingBox();
  await page.mouse.move(startBox!.x + startBox!.width / 2, startBox!.y + startBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragTarget!.x + 20, dragTarget!.y + 20, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  // Pigeon should now be perched and have the perched class
  await expect(pigeonEl).toHaveClass(/tg-perched/);
  // And should not move on subsequent ticks
  const perchedAt = await pigeonEl.boundingBox();
  await page.waitForTimeout(500);
  const stillThere = await pigeonEl.boundingBox();
  expect(Math.hypot(stillThere!.x - perchedAt!.x, stillThere!.y - perchedAt!.y)).toBeLessThan(2);

  // Tap (no drag) on the perched pigeon to release it
  await page.mouse.move(stillThere!.x + stillThere!.width / 2, stillThere!.y + stillThere!.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(50);
  await expect(pigeonEl).not.toHaveClass(/tg-perched/);

  // Clear should reset everything
  await page.locator('#tg-clear-btn').click();
  await page.waitForTimeout(100);
  expect(await page.locator('.tg-animal').count()).toBe(0);

  expect(errors).toEqual([]);
});
