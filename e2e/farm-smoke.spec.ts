import { test, expect } from '@playwright/test';
import { createGameState } from '../src/farm/engine';
import { SAVE_VERSION } from '../src/farm/types';

test('Farm smoke — opens, tills a tile, plants a seed, and renders without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');

  const startBtn = page.locator('#farm-btn');
  await expect(startBtn).toBeVisible();
  await startBtn.click();

  const screen = page.locator('#farm-screen');
  await expect(screen).toBeVisible();

  // Toolbar has 4 tabs: farm, seeds, defense, shop
  const tabs = page.locator('#fg-tabs .fg-tab');
  await expect(tabs).toHaveCount(4);

  // Default tab = 'farm', at least one tool button visible
  const tools = page.locator('#fg-buttons .fg-tool');
  await expect(tools.first()).toBeVisible();

  // Grid has tiles
  const tiles = page.locator('#fg-grid .fg-tile');
  const tileCount = await tiles.count();
  expect(tileCount).toBeGreaterThan(50);

  // Player emoji is rendered
  await expect(page.locator('.fg-player')).toBeVisible();
  await expect(page.locator('#fg-night-overlay')).toBeAttached();
  await expect(page.locator('#fg-celestial-sun')).toBeVisible();
  await expect(page.locator('.fg-night-fairy')).toHaveCount(4);

  // Till tool is selected by default — find a tile in the arable zone
  // (default: row 4, col 6) and tap it.
  const targetTile = page.locator('#fg-grid .fg-tile[data-row="4"][data-col="6"]');
  await expect(targetTile).toBeVisible();
  const box = await targetTile.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(80);

  const bgAfterTill = await targetTile.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfterTill, `after till, bg=${bgAfterTill}`).not.toBe('rgb(98, 168, 61)');

  // Water it
  await page.locator('#fg-buttons .fg-tool').nth(1).click(); // Water
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(80);
  const bgAfterWater = await targetTile.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfterWater, `after water, bg=${bgAfterWater}`).toBe('rgb(74, 50, 26)'); // #4a321a wet_tilled

  // Switch to seeds tab, pick carrot, plant on same tile
  await page.locator('.fg-tab').nth(1).click(); // Seeds tab
  await page.locator('#fg-buttons .fg-tool').nth(0).click(); // Carrot
  await page.waitForTimeout(50);
  const activeToolLabel = await page.locator('#fg-buttons .fg-tool.fg-tool-active .fg-tool-label').textContent();
  expect(activeToolLabel, 'active tool after selecting carrot').toBe('Carrot');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);

  // Crop element should appear inside that tile
  const cropInside = targetTile.locator('.fg-crop');
  await expect(cropInside).toHaveCount(1);

  // Menu: Save to slot 1, Reset, Load from slot 1 should restore the crop.
  // A fresh state spawns wild sunflowers on non-arable tiles, so crop count
  // after reset is > 0 (sunflowers), and after load is strictly higher (sunflowers + carrot).
  const cropCountBeforeSave = await page.locator('#fg-grid .fg-crop').count();
  await page.locator('#fg-menu-btn').click();
  await expect(page.locator('#fg-menu')).toBeVisible();
  // Save slot 1
  await page.locator('#fg-menu-save-rows button').nth(0).click();
  // Reset — wipes carrot, respawns fresh wild sunflowers
  await page.locator('#fg-menu-reset').click();
  await page.waitForTimeout(120);
  const cropCountAfterReset = await page.locator('#fg-grid .fg-crop').count();
  expect(cropCountAfterReset).toBeGreaterThan(0); // wild sunflowers
  expect(cropCountAfterReset).toBeLessThan(cropCountBeforeSave); // carrot is gone
  // Load slot 1 — carrot should come back alongside the sunflowers on the saved map
  await page.locator('#fg-menu-btn').click();
  await page.locator('#fg-menu-load-rows button').nth(0).click();
  await page.waitForTimeout(120);
  expect(await page.locator('#fg-grid .fg-crop').count()).toBeGreaterThanOrEqual(cropCountBeforeSave);

  // Season HUD pill is rendered
  await expect(page.locator('#fg-hud-season')).toBeVisible();

  expect(errors).toEqual([]);
});

test('Farm save/load — preserves money, player, crops, and movement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    for (let i = 1; i <= 3; i++) localStorage.removeItem(`funsounds-farm-slot-${i}`);
  });

  await page.locator('#farm-btn').click();
  await expect(page.locator('#farm-screen')).toBeVisible();

  const targetTile = page.locator('#fg-grid .fg-tile[data-row="4"][data-col="6"]');
  const box = await targetTile.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;

  await page.mouse.click(cx, cy);
  await page.locator('#fg-buttons [data-tool-id="water"]').click();
  await page.mouse.click(cx, cy);
  await page.locator('.fg-tab').nth(1).click(); // Seeds
  await page.locator('#fg-buttons [data-tool-id="seed-carrot"]').click();
  await page.mouse.click(cx, cy);
  await expect(page.locator('#fg-hud-money')).toContainText('$1');
  await expect(targetTile.locator('.fg-crop')).toHaveCount(1);

  const player = page.locator('.fg-player');
  const playerBeforeMove = await player.boundingBox();
  expect(playerBeforeMove).not.toBeNull();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(80);
  const playerAfterMove = await player.boundingBox();
  expect(playerAfterMove).not.toBeNull();
  expect(playerAfterMove!.x).toBeGreaterThan(playerBeforeMove!.x + 5);

  await page.locator('#fg-menu-btn').click();
  await page.locator('#fg-menu-save-rows button').nth(0).click();
  const savedState = await page.evaluate(() => JSON.parse(localStorage.getItem('funsounds-farm-slot-1')!).state);
  expect(savedState.money).toBe(1);
  expect(savedState.paused).toBe(false);
  expect(savedState.tiles.some((tile: any) => tile.crop?.kind === 'carrot')).toBe(true);
  expect(savedState.player.x).toBeGreaterThan(6.5);

  await page.locator('#fg-menu-reset').click();
  await page.waitForTimeout(120);
  await expect(page.locator('#fg-hud-money')).toContainText('$3');

  await page.locator('#fg-menu-btn').click();
  await page.locator('#fg-menu-load-rows button').nth(0).click();
  await page.waitForTimeout(120);
  await expect(page.locator('#fg-hud-money')).toContainText('$1');
  await expect(page.locator('.fg-player')).toBeVisible();
  await expect(targetTile.locator('.fg-crop')).toHaveCount(1);

  const playerBeforeLoadedMove = await player.boundingBox();
  expect(playerBeforeLoadedMove).not.toBeNull();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(80);
  const playerAfterLoadedMove = await player.boundingBox();
  expect(playerAfterLoadedMove).not.toBeNull();
  expect(playerAfterLoadedMove!.x).toBeGreaterThan(playerBeforeLoadedMove!.x + 5);

  expect(errors).toEqual([]);
});

test('Farm apple tree — disabled when unaffordable, then plants on prepared soil', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');

  const fundedState = createGameState();
  fundedState.money = 100;
  fundedState.nextPestAt = 1e9;
  fundedState.nextRainAt = 1e9;
  await page.evaluate((payload) => {
    localStorage.setItem('funsounds-farm-slot-1', JSON.stringify(payload));
  }, {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    state: fundedState,
  });

  await page.locator('#farm-btn').click();
  await expect(page.locator('#farm-screen')).toBeVisible();

  await page.locator('.fg-tab').nth(1).click(); // Seeds
  const appleSeed = page.locator('#fg-buttons [data-tool-id="seed-apple"]');
  await expect(appleSeed).toBeDisabled();

  await page.locator('#fg-menu-btn').click();
  await page.locator('#fg-menu-load-rows button').nth(0).click();
  await page.waitForTimeout(120);

  const targetTile = page.locator('#fg-grid .fg-tile[data-row="4"][data-col="6"]');
  const box = await targetTile.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;

  await page.locator('.fg-tab').nth(0).click(); // Farm
  await page.locator('#fg-buttons [data-tool-id="till"]').click();
  await page.mouse.click(cx, cy);
  await page.locator('#fg-buttons [data-tool-id="water"]').click();
  await page.mouse.click(cx, cy);

  await page.locator('.fg-tab').nth(1).click(); // Seeds
  await expect(appleSeed).toBeEnabled();
  await appleSeed.click();
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(120);

  await expect(targetTile.locator('.fg-tree')).toHaveCount(1);
  await expect(targetTile.locator('.fg-crop')).toContainText('🍎');
  const bgAfterApple = await targetTile.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfterApple).toBe('rgb(47, 111, 42)');

  expect(errors).toEqual([]);
});

test('Farm cat placement — consumes pending cat and returns toolbar to farm tools', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');

  const fundedState = createGameState();
  fundedState.money = 150;
  fundedState.nextPestAt = 1e9;
  fundedState.nextRainAt = 1e9;
  fundedState.nextWildSunflowerAt = 1e9;
  await page.evaluate((payload) => {
    localStorage.setItem('funsounds-farm-slot-1', JSON.stringify(payload));
  }, {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    state: fundedState,
  });

  await page.locator('#farm-btn').click();
  await expect(page.locator('#farm-screen')).toBeVisible();
  await page.locator('#fg-menu-btn').click();
  await page.locator('#fg-menu-load-rows button').nth(0).click();
  await page.waitForTimeout(120);

  await page.locator('.fg-tab').nth(3).click(); // Shop
  await page.locator('#fg-buttons [data-tool-id="buy-cat"]').click();
  await expect(page.locator('#fg-buttons [data-tool-id="place-cat"]')).toHaveClass(/fg-tool-active/);

  const firstTile = page.locator('#fg-grid .fg-tile[data-row="4"][data-col="5"]');
  const firstBox = await firstTile.boundingBox();
  expect(firstBox).not.toBeNull();
  await page.mouse.click(firstBox!.x + firstBox!.width / 2, firstBox!.y + firstBox!.height / 2);
  await expect(page.locator('#fg-defense-layer .fg-cat')).toHaveCount(1);

  await expect(page.locator('#fg-buttons [data-tool-id="till"]')).toBeVisible();
  await expect(page.locator('#fg-buttons [data-tool-id="till"]')).toHaveClass(/fg-tool-active/);

  await page.locator('.fg-tab').nth(3).click(); // Shop
  await page.locator('#fg-buttons [data-tool-id="buy-cat"]').click();
  const secondTile = page.locator('#fg-grid .fg-tile[data-row="4"][data-col="7"]');
  const secondBox = await secondTile.boundingBox();
  expect(secondBox).not.toBeNull();
  await page.mouse.click(secondBox!.x + secondBox!.width / 2, secondBox!.y + secondBox!.height / 2);
  await expect(page.locator('#fg-defense-layer .fg-cat')).toHaveCount(2);

  expect(errors).toEqual([]);
});
