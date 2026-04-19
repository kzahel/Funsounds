import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const profileDir = mkdtempSync(join(tmpdir(), 'lob-'));
const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1000, height: 700 },
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => console.log('pageerr:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await page.goto('http://localhost:5173/Funsounds/3d-demo.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.truck, null, { timeout: 10_000 });
await page.waitForTimeout(1500);

// Spawn a cube programmatically with known velocity aimed at the pile.
await page.evaluate(() => {
  const p = window.physics;
  // Directly spawn a test cube at (0, 4, 5) heading -Z at 12 m/s.
  const body = p.createDynamicBox({ x: 0.2, y: 0.2, z: 0.2 }, { pos: { x: 0, y: 1.5, z: 3 } }, 1.5);
  p.addImpulse(body, { x: 0, y: 0, z: -12 * 1.5 }); // 15 m/s towards pile
  window._testCube = body;
});

// Poll the test cube's position over 3 seconds.
const samples = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500);
  const pos = await page.evaluate(() => {
    const b = window._testCube;
    const wp = b.actor.getGlobalPose();
    const lv = b.actor.getLinearVelocity();
    return { x: wp.p.x, y: wp.p.y, z: wp.p.z, vx: lv.x, vy: lv.y, vz: lv.z };
  });
  samples.push(pos);
  console.log(`t=${((i+1)*0.5).toFixed(1)}s  pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})  vel=(${pos.vx.toFixed(2)}, ${pos.vy.toFixed(2)}, ${pos.vz.toFixed(2)})`);
}

// Check if any pile cube moved (position != rest). Pile cubes spawn at origin.
const pileMoved = await page.evaluate(() => {
  // Get the body count before vs after would be better, but we can inspect
  // cube positions. The pile is known to start around (x from -3.5 to 3.5,
  // y from 0.5 to 3.1, z from -2.1 to 2.1).
  // Hack: find actors via the physics._bodies map if exposed. Otherwise skip.
  const p = window.physics;
  if (!p._bodies) return 'no _bodies map';
  let max = { dx: 0, dy: 0, dz: 0 };
  for (const rb of p._bodies.values()) {
    const pose = rb.actor.getGlobalPose();
    if (rb === window._testCube) continue;
    // Restless pile cubes have low motion; look for any cube that moved a lot.
    const lv = rb.actor.getLinearVelocity ? rb.actor.getLinearVelocity() : { x: 0, y: 0, z: 0 };
    const spd = Math.hypot(lv.x, lv.y, lv.z);
    if (spd > max.dx) max = { dx: spd, dy: pose.p.y, dz: pose.p.z };
  }
  return max;
});
console.log('max moving non-test body speed:', pileMoved);

await page.screenshot({ path: '/tmp/lob-end.png' });
await ctx.close();
try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
