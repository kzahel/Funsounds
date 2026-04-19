#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const profileDir = mkdtempSync(join(tmpdir(), 'claude-physx-bench-'));
const BASE = process.env.BENCH_URL ?? 'http://localhost:5173/Funsounds/physics-bench.html';
const RESULT_PATH = process.env.BENCH_OUT ?? '/tmp/physx-bench-results.md';
const SAMPLES_PATH = process.env.BENCH_SAMPLES ?? '/tmp/physx-bench-samples.json';
const TIMEOUT_PER_RUN_MS = Number(process.env.BENCH_TIMEOUT_MS ?? 90_000);

// Sweep configs: (n, layers, totalBodies). Kept moderate so we can finish in reasonable time.
const SWEEP = [
  { n: 10,  layers: 5,  label: '500'   },
  { n: 15,  layers: 5,  label: '1125'  },
  { n: 20,  layers: 5,  label: '2000'  },
  { n: 25,  layers: 5,  label: '3125'  },
  { n: 30,  layers: 5,  label: '4500'  },
  { n: 35,  layers: 5,  label: '6125'  },
  { n: 40,  layers: 5,  label: '8000'  },
  { n: 45,  layers: 5,  label: '10125' },
];

const MODES = (process.env.BENCH_MODES ?? 'stock,batch').split(',').map(s => s.trim()).filter(Boolean);

const FRAMES = process.env.BENCH_FRAMES ?? '180';
const WARMUP = process.env.BENCH_WARMUP ?? '30';

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

page.on('pageerror', (err) => console.error('[pageerror]', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[${msg.type()}]`, msg.text());
  }
});

const results = [];

async function runOne({ n, layers, mode }) {
  const url = `${BASE}?n=${n}&layers=${layers}&mode=${mode}&frames=${FRAMES}&warmup=${WARMUP}`;
  console.log(`\n→ ${url}`);

  await page.goto(url, { waitUntil: 'load' });
  // Poll __bench.done = true or error.
  const start = Date.now();
  /** @type {any} */
  let state = null;
  while (Date.now() - start < TIMEOUT_PER_RUN_MS) {
    state = await page.evaluate(() => {
      const b = window.__bench;
      if (!b) return null;
      return {
        running: b.running,
        done: b.done,
        error: b.error,
        summary: b.summary ?? null,
        sampleCount: b.samples?.length ?? 0,
      };
    });
    if (state && (state.done || state.error)) break;
    await page.waitForTimeout(500);
  }
  if (!state || !state.done) {
    throw new Error(`timeout after ${TIMEOUT_PER_RUN_MS}ms — state=${JSON.stringify(state)}`);
  }
  if (state.error) {
    throw new Error(`bench error: ${state.error}`);
  }
  console.log(`  ✓ ${mode} n=${n} layers=${layers}  ` +
    `sync mean=${state.summary.meanSyncMs.toFixed(3)}ms p95=${state.summary.p95SyncMs.toFixed(3)}ms  ` +
    `frame mean=${state.summary.meanTotalMs.toFixed(3)}ms  fps=${state.summary.fps.toFixed(1)}  ` +
    `peakActive=${state.summary.peakActiveCount}`);
  results.push({ n, layers, mode, summary: state.summary });
}

function fmt(n, digits = 3) {
  return Number(n).toFixed(digits);
}

function tabulate(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const pad = (s, w) => String(s).padStart(w);
  const line = (arr) => '| ' + arr.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

function writeReport() {
  const byMode = { stock: [], batch: [] };
  for (const r of results) byMode[r.mode]?.push(r);

  const rowsFor = (list) => list.map(r => [
    r.summary.totalBodies,
    fmt(r.summary.meanSyncMs),
    fmt(r.summary.p95SyncMs),
    fmt(r.summary.peakSyncMs ?? NaN),
    fmt(r.summary.meanPhysicsMs),
    fmt(r.summary.meanTotalMs),
    fmt(r.summary.peakTotalMs ?? NaN),
    fmt(r.summary.fps, 1),
    r.summary.peakActiveCount,
    Math.round(r.summary.meanActiveCount ?? 0),
  ]);

  const headers = ['bodies', 'syncMean', 'syncP95', 'syncPeak', 'physMean', 'frameMean', 'framePeak', 'fps', 'peakAct', 'meanAct'];

  const delta = byMode.stock.map(s => {
    const b = byMode.batch.find(x => x.summary.totalBodies === s.summary.totalBodies);
    if (!b) return null;
    const peakStock = s.summary.peakSyncMs ?? s.summary.meanSyncMs;
    const peakBatch = b.summary.peakSyncMs ?? b.summary.meanSyncMs;
    const speedup = peakStock / Math.max(1e-6, peakBatch);
    const frameDelta = (s.summary.peakTotalMs ?? s.summary.meanTotalMs) - (b.summary.peakTotalMs ?? b.summary.meanTotalMs);
    return [
      s.summary.totalBodies,
      fmt(peakStock),
      fmt(peakBatch),
      fmt(speedup, 2) + 'x',
      fmt(frameDelta) + ' ms',
      fmt(s.summary.fps, 1),
      fmt(b.summary.fps, 1),
    ];
  }).filter(Boolean);

  const ts = new Date().toISOString();
  const lines = [
    `# PhysX batch-readback benchmark`,
    ``,
    `Captured ${ts}`,
    ``,
    `Harness: \`physics-bench.html\` (fixed 60Hz, InstancedMesh, eENABLE_ACTIVE_ACTORS).`,
    ``,
    `## Stock (per-actor getGlobalPose())`,
    ``,
    byMode.stock.length ? tabulate(rowsFor(byMode.stock), headers) : '_no data_',
    ``,
    `## Batch (PxScene_writeActiveTransforms)`,
    ``,
    byMode.batch.length ? tabulate(rowsFor(byMode.batch), headers) : '_no data_',
    ``,
    `## Delta (same bodies: stock → batch)`,
    ``,
    delta.length ? tabulate(delta, ['bodies', 'syncStockPeak(ms)', 'syncBatchPeak(ms)', 'speedup', 'framePeakΔ(ms)', 'fpsStock', 'fpsBatch']) : '_no matching rows_',
    ``,
  ];
  writeFileSync(RESULT_PATH, lines.join('\n'));
  writeFileSync(SAMPLES_PATH, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${RESULT_PATH} and ${SAMPLES_PATH}`);
}

try {
  for (const mode of MODES) {
    for (const cfg of SWEEP) {
      try {
        await runOne({ n: cfg.n, layers: cfg.layers, mode });
      } catch (e) {
        console.error(`  ✗ ${mode} n=${cfg.n} layers=${cfg.layers}:`, e.message ?? e);
        results.push({ n: cfg.n, layers: cfg.layers, mode, summary: { totalBodies: cfg.n * cfg.n * cfg.layers, meanSyncMs: NaN, p95SyncMs: NaN, meanPhysicsMs: NaN, meanTotalMs: NaN, p95TotalMs: NaN, fps: NaN, peakActiveCount: 0 }, error: String(e.message ?? e) });
      }
    }
  }
} finally {
  writeReport();
  await ctx.close();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
