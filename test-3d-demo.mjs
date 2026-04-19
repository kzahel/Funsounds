import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const profileDir = mkdtempSync(join(tmpdir(), 'claude-3ddemo-'));

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

const url = process.argv[2] ?? 'http://localhost:5173/Funsounds/3d-demo.html';
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/3d-demo-screenshot.png' });

  const diag = await page.evaluate(() => {
    const c = document.getElementById('demo-canvas');
    const w = window;
    return {
      canvasSize: c ? [c.clientWidth, c.clientHeight, c.width, c.height] : null,
      hasGPU: 'gpu' in navigator,
      engineBackend: w.engine?.renderer?.backend?.isWebGPUBackend ? 'webgpu' : 'other',
      sceneChildren: w.engine?.scene?.children?.length ?? -1,
      rendererInfo: w.engine?.renderer?.info ? {
        calls: w.engine.renderer.info.render?.calls,
        triangles: w.engine.renderer.info.render?.triangles,
      } : null,
    };
  });

  console.log('=== CONSOLE ===');
  for (const l of logs) console.log(l);
  console.log('=== DIAG ===');
  console.log(JSON.stringify(diag, null, 2));
  console.log('=== END ===');
} catch (e) {
  console.error('failed:', e);
} finally {
  await ctx.close();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
