import { test, expect } from '@playwright/test';

test('Barrel Hop smoke test — modes start, render and score without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/');
  await page.waitForLoadState('networkidle');

  // Launch "Jump Over" (easy) mode.
  const easyBtn = page.locator('[data-jp-mode="easy"]');
  await expect(easyBtn).toBeVisible();
  await easyBtn.click();

  const screen = page.locator('#jumper-screen');
  await expect(screen).toBeVisible();
  const launchUrl = new URL(page.url());
  expect(launchUrl.searchParams.get('game')).toBe('jumper');
  expect(launchUrl.searchParams.get('mode')).toBe('easy');

  // Canvas should be sized to the viewport.
  const size = await page.locator('#jp-canvas').evaluate((c: HTMLCanvasElement) => ({
    w: c.width,
    h: c.height,
  }));
  expect(size.w).toBeGreaterThan(0);
  expect(size.h).toBeGreaterThan(0);

  // Run right and make several big (held) jumps to clear barrels.
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 16; i++) {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(260);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(220);
  }
  await page.keyboard.up('ArrowRight');

  await page.screenshot({ path: '/tmp/jumper-easy.png' });

  const score = Number(await page.locator('#jp-score').textContent());
  expect(score).toBeGreaterThanOrEqual(1);

  // Switch to "Jump On" (hard) via number key, play briefly.
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(300);
  await expect(page.locator('#jp-mode')).toContainText('Jump On');
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(220);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(200);
  }
  await page.keyboard.up('ArrowRight');
  await page.screenshot({ path: '/tmp/jumper-hard.png' });

  // Switch to Practice (no fail).
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(300);
  await expect(page.locator('#jp-mode')).toContainText('Practice');
  await expect(page.locator('#jp-hearts')).toHaveText('∞');
  await page.screenshot({ path: '/tmp/jumper-practice.png' });

  // Switch to Buddy mode and play briefly (exercises trail recording + buddy
  // rendering without errors).
  await page.keyboard.press('Digit4');
  await page.waitForTimeout(300);
  await expect(page.locator('#jp-mode')).toContainText('Buddies');
  await expect(page.locator('#jp-buddies-pill')).toBeVisible();
  await expect(page.locator('#jp-buddies')).toHaveText('0/5');
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(220);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(200);
  }
  await page.keyboard.up('ArrowRight');

  expect(errors).toEqual([]);
});

test('Barrel Hop deep links open Buddy and Wedding modes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/Funsounds/?game=buddy');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#jumper-screen')).toBeVisible();
  await expect(page.locator('#start-screen')).toBeHidden();
  await expect(page.locator('#jp-mode')).toContainText('Buddies');
  await expect(page.locator('#jp-buddies-pill')).toBeVisible();
  await expect(page.locator('#jp-buddies')).toHaveText('0/5');

  await page.goto('/Funsounds/?game=wedding');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#jumper-screen')).toBeVisible();
  await expect(page.locator('#start-screen')).toBeHidden();
  await expect(page.locator('#jp-mode')).toContainText('Wedding');
  await expect(page.locator('#jp-buddies-pill')).toBeVisible();
  await expect(page.locator('#jp-buddies-label')).toHaveText('Mini buddies');

  expect(errors).toEqual([]);
});
