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

  // Force the freshly un-perched pigeon to drop a poop on its next tick.
  await page.evaluate(() => {
    const w = window as unknown as { __trainState?: { animals: Array<{ kind: string; nextPoopAt: number }> } };
    const s = w.__trainState;
    if (!s) return;
    for (const a of s.animals) {
      if (a.kind === 'pigeon') a.nextPoopAt = 1;
    }
  });
  await page.waitForTimeout(900); // > POOP_FALL_MS so it lands

  const landedPoop = page.locator('.tg-poop.tg-landed');
  expect(await landedPoop.count()).toBeGreaterThanOrEqual(1);

  // Erase tool (last button on Tools tab) cleans the poop without removing other state
  await page.locator('#tg-buttons .tg-tool').last().click();
  const poopBox = await landedPoop.first().boundingBox();
  await page.mouse.click(poopBox!.x + poopBox!.width / 2, poopBox!.y + poopBox!.height / 2);
  await page.waitForTimeout(100);
  expect(await page.locator('.tg-poop.tg-landed').count()).toBe(0);

  // Clear should reset everything
  await page.locator('#tg-clear-btn').click();
  await page.waitForTimeout(100);
  expect(await page.locator('.tg-animal').count()).toBe(0);
  expect(await page.locator('.tg-poop').count()).toBe(0);

  expect(errors).toEqual([]);
});

test('Train Builder collision — train runs over a chicken and renders blood', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');
  await page.locator('#train-btn').click();

  const screen = page.locator('#train-screen');
  await expect(screen).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __trainState?: { paused: boolean } };
    if (w.__trainState) w.__trainState.paused = true;
  });

  const tiles = page.locator('#tg-grid .tg-tile');
  const cols = await page.evaluate(() => {
    const w = window as unknown as { __trainState?: { size: { cols: number } } };
    return w.__trainState?.size.cols ?? 18;
  });
  const clickTile = async (row: number, col: number) => {
    const box = await tiles.nth(row * cols + col).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  };

  for (let col = 0; col < 5; col++) {
    await clickTile(1, col);
  }

  await page.locator('.tg-tab').nth(2).click();
  await page.locator('#tg-buttons .tg-tool').first().click();
  await clickTile(1, 0);

  await page.locator('.tg-tab').nth(3).click();
  await page.locator('#tg-buttons .tg-tool').nth(4).click();
  await clickTile(1, 1);
  await expect(page.locator('.tg-animal')).toHaveCount(1);

  await page.evaluate(() => {
    const w = window as unknown as {
      __trainState?: {
        paused: boolean;
        animals: Array<{ kind: string; moving: boolean; speed: number; nextDecisionAt: number }>;
      };
    };
    const s = w.__trainState;
    if (!s) return;
    for (const animal of s.animals) {
      if (animal.kind === 'chicken') {
        animal.moving = false;
        animal.speed = 0;
        animal.nextDecisionAt = Number.POSITIVE_INFINITY;
      }
    }
    s.paused = false;
  });

  await page.waitForFunction(() => {
    const w = window as unknown as { __trainState?: { bloodPuddles: unknown[] } };
    return (w.__trainState?.bloodPuddles.length ?? 0) > 0;
  }, { timeout: 3000 });

  await expect(page.locator('.tg-animal')).toHaveCount(0);
  await expect(page.locator('.tg-blood-puddle')).toHaveCount(1);
  await expect(page.locator('.tg-blood-puddle')).toBeVisible();

  expect(errors).toEqual([]);
});

test('Train Builder collision — train gets dirty after running over poop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');
  await page.locator('#train-btn').click();
  await expect(page.locator('#train-screen')).toBeVisible();

  await page.evaluate(() => {
    const w = window as unknown as { __trainState?: { paused: boolean } };
    if (w.__trainState) w.__trainState.paused = true;
  });

  const tiles = page.locator('#tg-grid .tg-tile');
  const cols = await page.evaluate(() => {
    const w = window as unknown as { __trainState?: { size: { cols: number } } };
    return w.__trainState?.size.cols ?? 18;
  });
  const clickTile = async (row: number, col: number) => {
    const box = await tiles.nth(row * cols + col).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  };

  for (let col = 0; col < 5; col++) {
    await clickTile(1, col);
  }

  await page.locator('.tg-tab').nth(2).click();
  await page.locator('#tg-buttons .tg-tool').first().click();
  await clickTile(1, 0);
  await expect(page.locator('.tg-train-car')).toHaveCount(3);

  await page.evaluate(() => {
    const w = window as unknown as {
      __trainState?: {
        nextId: number;
        paused: boolean;
        poops: Array<{ id: number; x: number; y: number; fallStart: number; startTime: number; duration: number; landed: boolean }>;
      };
    };
    const s = w.__trainState;
    if (!s) return;
    s.poops.push({ id: s.nextId++, x: 1.5, y: 1.5, fallStart: 0, startTime: 0, duration: 0, landed: true });
    s.paused = false;
  });

  await page.waitForFunction(() => {
    const w = window as unknown as { __trainState?: { trains: Array<{ dirty: boolean }> } };
    return w.__trainState?.trains.some((train) => train.dirty) ?? false;
  }, { timeout: 3000 });

  await expect(page.locator('.tg-train-car.tg-train-dirty')).toHaveCount(3);
  await expect(page.locator('.tg-train-dirt').first()).toHaveCSS('opacity', '1');

  expect(errors).toEqual([]);
});
