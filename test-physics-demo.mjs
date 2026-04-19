import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const profileDir = mkdtempSync(join(tmpdir(), 'claude-physicsdemo-'));

const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1200, height: 800 },
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--window-size=1220,870',
  ],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`));
page.on('requestfailed', (req) => logs.push(`[reqfailed] ${req.failure()?.errorText} ${req.url()}`));
page.on('requestfinished', async (req) => {
  try {
    const r = await req.response();
    if (r && r.status() >= 400) logs.push(`[http ${r.status()}] ${req.method()} ${req.url()}`);
  } catch {}
});

const url = process.argv[2] ?? 'http://localhost:5173/Funsounds/physics-demo.html';
try {
  await page.goto(url, { waitUntil: 'networkidle' });

  // Let the wasm module load and boxes settle for a bit before snapshot.
  await page.waitForTimeout(4000);

  const before = await page.evaluate(() => {
    const physics = window.physics;
    const bodies = window.dynamicBodies ?? [];
    let minY = Infinity, maxY = -Infinity;
    for (const b of bodies) {
      const p = b.getPosition();
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      bodyCount: physics?.bodyCount ?? -1,
      activeCount: physics?.activeCount ?? -1,
      dynamicCount: bodies.length,
      minY, maxY,
    };
  });

  // Real mouse click on the canvas centre. The demo's pointerdown handler
  // runs the raycast; OrbitControls — listening on the same canvas — gets a
  // proper pointer id so its setPointerCapture call stays happy.
  const cb = await page.locator('#demo-canvas').boundingBox();
  if (cb) {
    await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  }

  // Sample twice — right after the click (box still flying up) and then
  // again a beat later. A successful yeet should show a clear apex peak in
  // peakMaxY that's well above the pre-click stack height.
  let peakMaxY = -Infinity;
  let peakActive = -1;
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => {
      const physics = window.physics;
      const bodies = window.dynamicBodies ?? [];
      let mY = -Infinity;
      for (const b of bodies) {
        const p = b.getPosition();
        if (p.y > mY) mY = p.y;
      }
      return { activeCount: physics?.activeCount ?? -1, maxY: mY };
    });
    if (s.maxY > peakMaxY) { peakMaxY = s.maxY; peakActive = s.activeCount; }
    await page.waitForTimeout(80);
  }

  const after = { activeCount: peakActive, maxY: peakMaxY };

  await page.screenshot({ path: '/tmp/physics-demo-screenshot.png' });

  const diag = await page.evaluate(() => {
    const c = document.getElementById('demo-canvas');
    const w = window;
    return {
      canvasSize: c ? [c.clientWidth, c.clientHeight, c.width, c.height] : null,
      hasGPU: 'gpu' in navigator,
      engineBackend: w.engine?.renderer?.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      sceneChildren: w.engine?.scene?.children?.length ?? -1,
      batchPath: w.physics?.batchPathActive ?? null,
    };
  });

  console.log('=== CONSOLE ===');
  for (const l of logs) console.log(l);
  console.log('=== DIAG ===');
  console.log(JSON.stringify(diag, null, 2));
  console.log('=== BEFORE CLICK ===');
  console.log(JSON.stringify(before, null, 2));
  console.log('=== AFTER CLICK ===');
  console.log(JSON.stringify(after, null, 2));
  console.log('=== END ===');
} catch (e) {
  console.error('failed:', e);
} finally {
  await ctx.close();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
