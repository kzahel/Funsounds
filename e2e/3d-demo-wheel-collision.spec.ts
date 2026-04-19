import { test, expect } from '@playwright/test';

// Wheel-vs-cube collision check. Spawns a small cube directly under the
// chassis floor — too low for the body collider to reach, but at wheel
// height — then drives the truck forward. If the wheel sim flag is doing
// its job, the cube gets thrown out of the way; otherwise it passes through
// the wheel undisturbed.
test('truck wheels physically push cubes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  // ?noCubes=1 keeps the cube pile out of the picture so the only thing in
  // the truck's path is our hand-placed test cube.
  await page.goto('/Funsounds/3d-demo.html?noCubes=1');
  await page.waitForLoadState('networkidle');

  // Wait for the demo to expose its globals (set after engine.start()).
  await page.waitForFunction(() => (window as any).truck && (window as any).physics, undefined, {
    timeout: 15_000,
  });

  // Spawn a tiny cube directly in the front-right wheel's path. Track width
  // is 1.7m so wheels are at world x = ±0.85; place the cube at x=0.85 so the
  // wheel rolls over it. y=0.17 keeps it on the ground — chassis bottom sits
  // around y=0.79, so only the wheel can reach it.
  const initial = await page.evaluate(() => {
    const physics = (window as any).physics;
    const half = 0.15;
    const cube = physics.createDynamicBox(
      { x: half, y: half, z: half },
      { pos: { x: 0.85, y: half + 0.02, z: 0 } },
      0.3,
    );
    (window as any).__wheelTestCube = cube;
    const truckPose = (window as any).truck.chassis.actor.getGlobalPose();
    const p = cube.getPosition();
    return {
      cube: { x: p.x, y: p.y, z: p.z },
      truck: { x: truckPose.p.x, y: truckPose.p.y, z: truckPose.p.z },
    };
  });
  console.log('initial', JSON.stringify(initial));

  // Focus the canvas so keydown reaches the demo's window-level listeners.
  await page.locator('#demo-canvas').click({ position: { x: 50, y: 50 } });

  // Hold ArrowUp ~5 s — long enough for the truck to roll the ~6 m to the cube.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(5000);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(500);

  const final = await page.evaluate(() => {
    const cube = (window as any).__wheelTestCube;
    const truckPose = (window as any).truck.chassis.actor.getGlobalPose();
    const p = cube.getPosition();
    return {
      cube: { x: p.x, y: p.y, z: p.z },
      truck: { x: truckPose.p.x, y: truckPose.p.y, z: truckPose.p.z },
    };
  });
  console.log('final', JSON.stringify(final));

  // The truck should have advanced and the cube should have been displaced.
  const truckMoved = Math.hypot(
    final.truck.x - initial.truck.x,
    final.truck.z - initial.truck.z,
  );
  const cubeMoved = Math.hypot(
    final.cube.x - initial.cube.x,
    final.cube.y - initial.cube.y,
    final.cube.z - initial.cube.z,
  );
  console.log(`truckMoved=${truckMoved.toFixed(3)} cubeMoved=${cubeMoved.toFixed(3)}`);
  expect(truckMoved, 'truck should drive forward').toBeGreaterThan(2);
  expect(cubeMoved, 'wheels should physically displace the cube').toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});
