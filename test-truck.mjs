// Integration smoke test for the 3D demo truck. Boots the demo with
// ?noCubes=1, dispatches real arrow-key events, and asserts drive, steer, brake.
//
// Run: `npx vite --port 5173` in another terminal, then `node test-truck.mjs`.
// Headed chromium + WebGPU flags because the demo requires WebGPU.
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const profileDir = mkdtempSync(join(tmpdir(), 'claude-truck-'));

const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1000, height: 700 },
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--window-size=1020,770',
  ],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`));

const url = process.argv[2] ?? 'http://localhost:5173/Funsounds/3d-demo.html?noCubes=1';

let fail = false;
function assert(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); }
  else { console.log(`  FAIL ${msg}`); fail = true; }
}

const pose = async () => page.evaluate(() => {
  const a = window.truck.chassis.actor;
  const wp = a.getGlobalPose();
  return {
    x: wp.p.x, y: wp.p.y, z: wp.p.z,
    qx: wp.q.x, qy: wp.q.y, qz: wp.q.z, qw: wp.q.w,
    spd: window.truck.forwardSpeed, rpm: window.truck.engineRpm,
  };
});
const yawOf = (p) => Math.atan2(2 * (p.qw * p.qy + p.qx * p.qz), 1 - 2 * (p.qy * p.qy + p.qx * p.qx));

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!(window.truck && window.physics && window.engine), null, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/truck-01-rest.png' });

  const rest = await pose();
  console.log('rest:', rest);
  assert(rest.y > 0.5 && rest.y < 2.0, `chassis settled near ground (y=${rest.y.toFixed(2)})`);
  assert(Math.abs(rest.spd) < 0.3, `at rest before test (|spd|<0.3, got ${rest.spd.toFixed(2)})`);

  console.log('\n== drive forward 2s ==');
  await page.evaluate(() => window.focus());
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/truck-02-driving.png' });
  const afterFwd = await pose();
  const dist = Math.hypot(afterFwd.x - rest.x, afterFwd.z - rest.z);
  console.log('after fwd:', afterFwd);
  assert(dist > 1.5, `chassis translated > 1.5m (dist=${dist.toFixed(2)})`);
  assert(Math.abs(afterFwd.spd) > 1.0, `forward speed magnitude > 1 (|spd|=${Math.abs(afterFwd.spd).toFixed(2)})`);
  assert(afterFwd.rpm > 500, `engine spinning (rpm=${afterFwd.rpm.toFixed(0)})`);

  console.log('\n== steer right while driving 1s ==');
  const yawBefore = yawOf(afterFwd);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/truck-03-turning.png' });
  await page.keyboard.up('ArrowRight');
  const afterTurn = await pose();
  const yawAfter = yawOf(afterTurn);
  const dYaw = Math.abs(((yawAfter - yawBefore + Math.PI) % (2 * Math.PI)) - Math.PI);
  console.log(`yaw ${yawBefore.toFixed(3)} -> ${yawAfter.toFixed(3)}  |dYaw|=${dYaw.toFixed(3)}`);
  assert(dYaw > 0.2, `yaw changed > 0.2 rad while steering`);

  console.log('\n== brake ==');
  await page.keyboard.up('ArrowUp');
  const spdBeforeBrake = afterTurn.spd;
  await page.keyboard.down('ArrowDown');
  // Short brake window — long windows let the truck stop and then accelerate
  // backward since ArrowDown becomes reverse once forward speed drops below
  // 1.5. We just want to see the brake bite.
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowDown');
  const afterBrake = await pose();
  console.log('after brake:', afterBrake);
  assert(afterBrake.spd < spdBeforeBrake - 2, `brake decelerated (spd dropped by >2 from ${spdBeforeBrake.toFixed(2)}, now ${afterBrake.spd.toFixed(2)})`);

  const pageErrs = logs.filter((l) => l.startsWith('[pageerror]'));
  for (const l of pageErrs) console.log(l);
  if (pageErrs.length) fail = true;
} catch (e) {
  console.error('test threw:', e);
  fail = true;
} finally {
  await ctx.close();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}

if (fail) { console.log('\nFAIL'); process.exit(1); }
console.log('\nPASS');
