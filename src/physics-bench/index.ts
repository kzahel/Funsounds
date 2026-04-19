import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import PhysX from 'physx-js-webidl';

type Mode = 'stock' | 'batch';

interface Params {
  n: number;
  layers: number;
  mode: Mode;
  frames: number;
  warmup: number;
  gap: number;
  autoStart: boolean;
}

interface FrameSample {
  physicsMs: number;
  syncMs: number;
  renderMs: number;
  totalMs: number;
  activeCount: number;
}

interface Summary {
  mode: Mode;
  n: number;
  layers: number;
  totalBodies: number;
  framesRecorded: number;
  meanSyncMs: number;
  p95SyncMs: number;
  meanPhysicsMs: number;
  p95PhysicsMs: number;
  meanTotalMs: number;
  p95TotalMs: number;
  fps: number;
  peakActiveCount: number;
  meanActiveCount: number;
  peakSyncMs: number;
  peakPhysicsMs: number;
  peakTotalMs: number;
}

declare global {
  interface Window {
    __bench?: {
      params: Params;
      running: boolean;
      done: boolean;
      error?: string;
      samples: FrameSample[];
      summary?: Summary;
      start?: () => void;
    };
  }
}

function parseParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const n = Math.max(1, Number(q.get('n') ?? '20'));
  const layers = Math.max(1, Number(q.get('layers') ?? '5'));
  const mode = (q.get('mode') === 'batch' ? 'batch' : 'stock') as Mode;
  const frames = Math.max(10, Number(q.get('frames') ?? '180'));
  const warmup = Math.max(0, Number(q.get('warmup') ?? '30'));
  const gap = Math.max(0.1, Number(q.get('gap') ?? '1.4'));
  const autoStart = q.get('autoStart') !== '0';
  return { n, layers, mode, frames, warmup, gap, autoStart };
}

function setHud(text: string): void {
  const el = document.getElementById('hud');
  if (el) el.textContent = text;
}

function setBanner(text: string): void {
  const el = document.getElementById('banner');
  if (el) el.textContent = text;
}

function showError(err: unknown): void {
  const el = document.getElementById('error-overlay');
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  if (el) {
    el.style.display = 'flex';
    el.textContent = `Bench failed: ${msg}`;
  }
  if (window.__bench) {
    window.__bench.error = msg;
    window.__bench.running = false;
    window.__bench.done = true;
  }
  console.error(err);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

async function main(): Promise<void> {
  const params = parseParams();
  const totalBodies = params.n * params.n * params.layers;

  window.__bench = {
    params,
    running: false,
    done: false,
    samples: [],
  };

  setBanner(`mode=${params.mode}  n=${params.n}  layers=${params.layers}  bodies=${totalBodies}`);
  setHud('loading PhysX wasm…');

  const Px: any = await PhysX();

  const version: number = Px.PHYSICS_VERSION;
  const allocator = new Px.PxDefaultAllocator();
  const errorCb = new Px.PxDefaultErrorCallback();
  const foundation = Px.CreateFoundation(version, allocator, errorCb);
  const scale = new Px.PxTolerancesScale();
  const physics = Px.CreatePhysics(version, foundation, scale);

  const sceneDesc = new Px.PxSceneDesc(scale);
  sceneDesc.gravity = new Px.PxVec3(0, -9.81, 0);
  sceneDesc.cpuDispatcher = Px.DefaultCpuDispatcherCreate(0);
  sceneDesc.filterShader = Px.DefaultFilterShader();
  sceneDesc.flags.raise(Px.PxSceneFlagEnum.eENABLE_ACTIVE_ACTORS);

  const scene = physics.createScene(sceneDesc);

  const material = physics.createMaterial(0.5, 0.5, 0.4);

  // Default filter shader requires (fd0.word0 & fd1.word1) != 0. Give everything the same mask.
  const filterData = new Px.PxFilterData(1, 1, 0, 0);

  const groundPlane = Px.CreatePlane(physics, new Px.PxPlane(0, 1, 0, 0), material);
  const groundShape = Px.SupportFunctions.prototype.PxActor_getShape(groundPlane, 0);
  groundShape.setSimulationFilterData(filterData);
  scene.addActor(groundPlane);

  const identityQuat = new Px.PxQuat(Px.PxIDENTITYEnum.PxIdentity);
  const pose = new Px.PxTransform(Px.PxIDENTITYEnum.PxIdentity);
  const boxSize = 0.5;
  const boxGeom = new Px.PxBoxGeometry(boxSize, boxSize, boxSize);
  // Non-exclusive: we attach this shape to every dynamic box so PhysX refcounts it across actors.
  const shape = physics.createShape(boxGeom, material, false);
  shape.setSimulationFilterData(filterData);

  const bodies: Array<{ ptr: number; rigid: any }> = new Array(totalBodies);
  const ptrToIndex = new Map<number, number>();
  const tmpVec = new Px.PxVec3(0, 0, 0);

  const halfN = (params.n - 1) / 2;
  for (let layer = 0; layer < params.layers; layer++) {
    for (let ix = 0; ix < params.n; ix++) {
      for (let iz = 0; iz < params.n; iz++) {
        const i = layer * params.n * params.n + ix * params.n + iz;
        const x = (ix - halfN) * params.gap + (Math.random() - 0.5) * 0.05;
        const z = (iz - halfN) * params.gap + (Math.random() - 0.5) * 0.05;
        const y = 2 + layer * (boxSize * 2 + 0.1) + boxSize;
        tmpVec.x = x; tmpVec.y = y; tmpVec.z = z;
        pose.p = tmpVec;
        pose.q = identityQuat;
        const rd = physics.createRigidDynamic(pose);
        rd.attachShape(shape);
        scene.addActor(rd);
        bodies[i] = { ptr: rd.ptr, rigid: rd };
        ptrToIndex.set(rd.ptr, i);
      }
    }
  }

  const canvas = document.getElementById('bench-canvas') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  const resize = () => renderer.setSize(window.innerWidth, window.innerHeight, false);
  resize();
  window.addEventListener('resize', resize);

  const threeScene = new Scene();
  threeScene.background = new Color(0x101418);

  const groundMesh = new Mesh(
    new PlaneGeometry(params.n * params.gap * 4, params.n * params.gap * 4),
    new MeshBasicMaterial({ color: 0x21303a }),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  threeScene.add(groundMesh);

  const boxGeomThree = new BoxGeometry(boxSize * 2, boxSize * 2, boxSize * 2);
  const boxMat = new MeshLambertMaterial({ color: 0xff9a3a });
  const instanced = new InstancedMesh(boxGeomThree, boxMat, totalBodies);
  threeScene.add(instanced);

  threeScene.add(new AmbientLight(0xffffff, 0.35));
  const sun = new DirectionalLight(0xffffff, 1.0);
  sun.position.set(4, 10, 5);
  threeScene.add(sun);

  const cam = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
  const radius = Math.max(10, params.n * params.gap * 1.1);
  cam.position.set(radius, radius * 0.7, radius);
  cam.lookAt(0, 0, 0);
  window.addEventListener('resize', () => {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
  });

  const dummyMat = new Matrix4();
  const dummyPos = new Vector3();
  const dummyQuat = new Quaternion();
  const dummyScale = new Vector3(1, 1, 1);

  const stride = 8;
  const scratchBytes = totalBodies * stride * 4;
  const scratchPtr = Px._malloc(scratchBytes);

  const hasBatchApi = typeof Px.SupportFunctions?.prototype?.PxScene_writeActiveTransforms === 'function';
  if (params.mode === 'batch' && !hasBatchApi) {
    throw new Error('mode=batch requested but PxScene_writeActiveTransforms is not in this wasm build. Apply the patch and rebuild.');
  }

  const PxRigidActor = Px.PxRigidActor;

  function stockReadback(): { syncMs: number; activeCount: number } {
    const t0 = performance.now();
    const activeArr = Px.SupportFunctions.prototype.PxScene_getActiveActors(scene);
    const count = activeArr.size();
    for (let i = 0; i < count; i++) {
      const actor = activeArr.get(i);
      const idx = ptrToIndex.get(actor.ptr);
      if (idx === undefined) continue;
      const rd = Px.castObject(actor, PxRigidActor);
      const tx = rd.getGlobalPose();
      const p = tx.p;
      const q = tx.q;
      dummyPos.set(p.x, p.y, p.z);
      dummyQuat.set(q.x, q.y, q.z, q.w);
      dummyMat.compose(dummyPos, dummyQuat, dummyScale);
      instanced.setMatrixAt(idx, dummyMat);
    }
    instanced.instanceMatrix.needsUpdate = true;
    return { syncMs: performance.now() - t0, activeCount: count };
  }

  function batchReadback(): { syncMs: number; activeCount: number } {
    const t0 = performance.now();
    const count = Px.SupportFunctions.prototype.PxScene_writeActiveTransforms(scene, scratchPtr, totalBodies);
    const f32 = Px.HEAPF32;
    const u32 = Px.HEAPU32;
    const base0 = scratchPtr >>> 2;
    for (let i = 0; i < count; i++) {
      const base = base0 + i * 8;
      const ptrInt = u32[base + 0]!;
      const idx = ptrToIndex.get(ptrInt);
      if (idx === undefined) continue;
      dummyPos.set(f32[base + 1]!, f32[base + 2]!, f32[base + 3]!);
      dummyQuat.set(f32[base + 4]!, f32[base + 5]!, f32[base + 6]!, f32[base + 7]!);
      dummyMat.compose(dummyPos, dummyQuat, dummyScale);
      instanced.setMatrixAt(idx, dummyMat);
    }
    instanced.instanceMatrix.needsUpdate = true;
    return { syncMs: performance.now() - t0, activeCount: count };
  }

  // Prime instance matrices so first frame renders at spawn positions.
  {
    const initMat = new Matrix4();
    for (let layer = 0; layer < params.layers; layer++) {
      for (let ix = 0; ix < params.n; ix++) {
        for (let iz = 0; iz < params.n; iz++) {
          const i = layer * params.n * params.n + ix * params.n + iz;
          const x = (ix - halfN) * params.gap;
          const z = (iz - halfN) * params.gap;
          const y = 2 + layer * (boxSize * 2 + 0.1) + boxSize;
          initMat.makeTranslation(x, y, z);
          instanced.setMatrixAt(i, initMat);
        }
      }
    }
    instanced.instanceMatrix.needsUpdate = true;
  }

  const fixedDt = 1 / 60;

  const samples: FrameSample[] = [];
  let frameIndex = 0;
  let running = true;
  window.__bench.running = true;

  function finalize(): void {
    running = false;
    window.__bench!.running = false;

    const sortedBy = (key: keyof FrameSample) => samples.map(s => s[key] as number).sort((a, b) => a - b);
    const syncs = sortedBy('syncMs');
    const phys = sortedBy('physicsMs');
    const total = sortedBy('totalMs');

    let peak = 0;
    let actSum = 0;
    for (const s of samples) {
      if (s.activeCount > peak) peak = s.activeCount;
      actSum += s.activeCount;
    }
    const meanActive = samples.length ? actSum / samples.length : 0;

    // Peak-activity metrics: restrict to frames where active >= 80% of peak.
    const peakCut = peak * 0.8;
    const peakFrames = samples.filter(s => s.activeCount >= peakCut);
    const peakSync = peakFrames.map(s => s.syncMs).sort((a, b) => a - b);
    const peakPhys = peakFrames.map(s => s.physicsMs).sort((a, b) => a - b);
    const peakTot = peakFrames.map(s => s.totalMs).sort((a, b) => a - b);

    const summary: Summary = {
      mode: params.mode,
      n: params.n,
      layers: params.layers,
      totalBodies,
      framesRecorded: samples.length,
      meanSyncMs: mean(syncs),
      p95SyncMs: quantile(syncs, 0.95),
      meanPhysicsMs: mean(phys),
      p95PhysicsMs: quantile(phys, 0.95),
      meanTotalMs: mean(total),
      p95TotalMs: quantile(total, 0.95),
      fps: 1000 / Math.max(0.001, mean(total)),
      peakActiveCount: peak,
      meanActiveCount: meanActive,
      peakSyncMs: mean(peakSync),
      peakPhysicsMs: mean(peakPhys),
      peakTotalMs: mean(peakTot),
    };
    window.__bench!.summary = summary;
    window.__bench!.done = true;
    setHud(
      `DONE\n` +
      `mode: ${summary.mode}\n` +
      `bodies: ${summary.totalBodies} (peak active ${summary.peakActiveCount})\n` +
      `sync  mean ${summary.meanSyncMs.toFixed(3)}ms  p95 ${summary.p95SyncMs.toFixed(3)}ms\n` +
      `phys  mean ${summary.meanPhysicsMs.toFixed(3)}ms  p95 ${summary.p95PhysicsMs.toFixed(3)}ms\n` +
      `frame mean ${summary.meanTotalMs.toFixed(3)}ms  p95 ${summary.p95TotalMs.toFixed(3)}ms\n` +
      `fps ≈ ${summary.fps.toFixed(1)}`
    );
  }

  function tick(_now: number): void {
    if (!running) return;
    const tFrameStart = performance.now();

    const tPhysStart = performance.now();
    scene.simulate(fixedDt);
    scene.fetchResults(true);
    const physicsMs = performance.now() - tPhysStart;

    const sync = params.mode === 'batch' ? batchReadback() : stockReadback();

    const tRenderStart = performance.now();
    renderer.render(threeScene, cam);
    const renderMs = performance.now() - tRenderStart;

    const totalMs = performance.now() - tFrameStart;

    if (frameIndex >= params.warmup) {
      samples.push({ physicsMs, syncMs: sync.syncMs, renderMs, totalMs, activeCount: sync.activeCount });
    }

    if (frameIndex % 15 === 0) {
      setHud(
        `mode: ${params.mode}   frame: ${frameIndex}/${params.warmup + params.frames}\n` +
        `bodies: ${totalBodies}   active: ${sync.activeCount}\n` +
        `phys: ${physicsMs.toFixed(3)}ms   sync: ${sync.syncMs.toFixed(3)}ms\n` +
        `render: ${renderMs.toFixed(3)}ms   frame: ${totalMs.toFixed(3)}ms`
      );
    }

    frameIndex++;
    if (samples.length >= params.frames) {
      finalize();
      return;
    }
    requestAnimationFrame(tick);
  }

  if (params.autoStart) {
    requestAnimationFrame(tick);
  }

  (window as any).__physx = Px;
  window.__bench.start = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
}

main().catch(showError);
