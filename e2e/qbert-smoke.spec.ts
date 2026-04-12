import { test, expect } from '@playwright/test';

test('Q*bert smoke test — game starts and renders without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');

  // Start screen should be visible with the Q*bert button
  const qbertBtn = page.locator('#qbert-btn');
  await expect(qbertBtn).toBeVisible();

  // Click Q*bert button to start the game
  await qbertBtn.click();

  // The qbert screen should now be visible
  const screen = page.locator('#qbert-screen');
  await expect(screen).toBeVisible();

  // Wait a moment for the renderer to initialize
  await page.waitForTimeout(500);

  // The pyramid container should have cube elements
  const cubes = page.locator('#qb-pyramid-container .qb-cube');
  await expect(cubes.first()).toBeVisible();
  const cubeCount = await cubes.count();
  expect(cubeCount).toBe(28);

  // Player should be visible
  const player = page.locator('.qb-player');
  await expect(player).toBeVisible();

  // HUD should show initial values
  await expect(page.locator('#qb-score')).toHaveText('0');
  await expect(page.locator('#qb-level')).toHaveText('1');
  await expect(page.locator('#qb-lives')).toHaveText('3');

  // Press an arrow key to move and verify no crash
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);

  // Player should still be visible (moved to a new position)
  await expect(player).toBeVisible();

  // Score should have changed (landing on a cube gives 25 points)
  const score = await page.locator('#qb-score').textContent();
  expect(Number(score)).toBeGreaterThanOrEqual(25);

  // No JS errors should have occurred
  expect(errors).toEqual([]);
});
