import { expect, test } from '@playwright/test';

test('upper-atmosphere canvas art renders poofy platforms, UFO, stars and croissants', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });

  await page.goto('/Funsounds/');
  await page.evaluate(async () => {
    const [{ render }, { themeForLevel }] = await Promise.all([
      import('/Funsounds/src/jumper/render.ts'),
      import('/Funsounds/src/jumper/themes.ts'),
    ]);
    const canvas = document.getElementById('jp-canvas') as HTMLCanvasElement;
    const screen = document.getElementById('jumper-screen') as HTMLElement;
    screen.style.display = 'block';
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext('2d')!;
    const level = {
      width: 1500,
      startX: 70,
      startY: 418,
      goalX: 1380,
      leftGoalX: 90,
      platforms: [
        { x: 0, y: 470, w: 380, h: 70, kind: 'ground' as const },
        { x: 475, y: 405, w: 170, h: 22, kind: 'float' as const },
        { x: 735, y: 345, w: 155, h: 22, kind: 'float' as const },
        { x: 990, y: 410, w: 510, h: 70, kind: 'ground' as const },
      ],
      barrels: [
        { id: 1, x: 432, y: 390, w: 48, h: 80 },
        { id: 2, x: 680, y: 330, w: 48, h: 140 },
      ],
      checkpoints: [],
      killY: 610,
    };
    render({
      ctx: context,
      dpr: 1,
      cssW: 800,
      cssH: 600,
      scale: 600 / 540,
      cameraX: 0,
      viewW: 720,
      time: 1.4,
    }, {
      level,
      theme: themeForLevel(1),
      px: 120,
      py: 418,
      vx: 0,
      vy: 0,
      grounded: true,
      facing: 1,
      invuln: false,
      flagDown: 0,
      buddies: [],
      worldBuddies: [],
      world: 'upperAtmosphere',
      skyRideT: 0,
      atmosphereLiftT: 0,
      undergroundLiftT: 0,
      underwaterLiftT: 0,
      consumables: [
        { id: 'upper-0', x: 238, y: 444, w: 40, h: 26, kind: 'croissant' },
        { id: 'upper-1', x: 535, y: 379, w: 40, h: 26, kind: 'croissant' },
      ],
      ufo: { x: 305, platformY: 470, t: 1.4, active: false },
      gateways: [{ x: 535, platformY: 405, kind: 'rocket', locked: false, active: false, t: 1.4 }],
      tarantulas: [],
      particles: [],
    });
  });

  await expect(page.locator('#jp-canvas')).toBeVisible();
  await page.locator('#jp-canvas').screenshot({ path: '/tmp/jumper-upper-atmosphere.png' });
  expect(errors).toEqual([]);
});

test('Moon Base renders low-gravity world art and moon cheese', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('barrelhop.worlds.explored', JSON.stringify([
      'surface', 'candy', 'upperAtmosphere', 'moonBase',
    ]));
  });
  await page.goto('/Funsounds/?game=buddy');
  await page.locator('#jp-world-map-button').click();
  await page.locator('[data-jp-world="moonBase"]').click();
  await expect(page.locator('#jumper-screen')).toHaveAttribute('data-world', 'moonBase');
  await expect(page.locator('#jp-status')).toContainText('moon cheese');
  await page.locator('#jp-canvas').screenshot({ path: '/tmp/jumper-moon-base.png' });
  expect(errors).toEqual([]);
});
