import {
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  AmbientLight,
  Group,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Engine, Physics, RigidBody, Vehicle, createToonMaterial } from '../engine';
import { TruckAudio } from './audio';
import { preloadSkeleton, spawnRagdoll, RagdollTemplate, SpawnedRagdoll } from './ragdoll';

const CUBE_COLORS = [
  0xe8564a, 0xffd24a, 0x9a66ff, 0x7cbf4a, 0x4ac4e8, 0xff8a3d, 0xfde14a, 0xff6ba0,
];

async function start(): Promise<void> {
  const canvas = document.getElementById('demo-canvas') as HTMLCanvasElement;
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not available — try Chrome 113+ or enable chrome://flags/#enable-unsafe-webgpu');
  }

  // ?noCubes=1 skips the decorative block spawn — cleaner baseline for driving
  // tests where we want an empty plane.
  const params = new URLSearchParams(window.location.search);
  const spawnCubes = !params.has('noCubes');

  const engine = new Engine({
    canvas,
    pixelSize: 4,
    depthEdgeStrength: 1.0,
    normalEdgeStrength: 1.0,
    lineHighlight: 0.2,
    lineShadow: 0.55,
    backgroundColor: 0x6b8cff,
  });

  const physics = await Physics.create({ gravity: { x: 0, y: -9.81, z: 0 } });
  engine.setPhysics(physics);

  await engine.ready();

  const ground = new Mesh(new PlaneGeometry(60, 60), createToonMaterial(0x7cbf4a, 3));
  ground.rotation.x = -Math.PI / 2;
  engine.scene.add(ground);
  physics.createStaticPlane({ pos: { x: 0, y: 0, z: 0 } });

  // Audio is lazy-constructed on first user gesture (browsers block
  // AudioContext until then). Engine rumble + bonk-on-collision both live
  // inside TruckAudio.
  const audio = new TruckAudio();
  const kickAudio = (): void => {
    audio.start();
    audio.resume();
  };
  window.addEventListener('keydown', kickAudio);
  window.addEventListener('pointerdown', kickAudio);

  // Cubes we track for collision bonks. A sudden linear-velocity delta from
  // one frame to the next is our impact proxy — avoids adding a PhysX contact
  // listener to the engine for what the demo needs.
  interface TrackedCube {
    body: RigidBody;
    lastVx: number; lastVy: number; lastVz: number;
    primed: boolean;     // skip the first delta; initial lv may reflect a
                         // just-applied impulse (e.g. lobbed cube).
    lastBonk: number;    // performance.now() of the most recent bonk; used
                         // for per-body cooldown so a cube rattling on the
                         // floor doesn't chatter.
  }
  const tracked: TrackedCube[] = [];
  const trackCube = (body: RigidBody): void => {
    tracked.push({ body, lastVx: 0, lastVy: 0, lastVz: 0, primed: false, lastBonk: 0 });
  };

  if (spawnCubes) {
    // Drivable cube pile centered at the origin. The truck spawns offset on
    // +Z and faces -Z so it's pointed straight at the pile.
    const half = 0.5;
    const spacing = 1.4;
    const cols = 6;
    const rows = 4;
    const layers = 3;
    for (let y = 0; y < layers; y++) {
      for (let x = 0; x < cols; x++) {
        for (let z = 0; z < rows; z++) {
          const px = (x - (cols - 1) / 2) * spacing;
          const pz = (z - (rows - 1) / 2) * spacing;
          const py = half + 0.02 + y * (half * 2 + 0.05);
          const color = CUBE_COLORS[(x + y + z) % CUBE_COLORS.length];
          const mesh = new Mesh(
            new BoxGeometry(half * 2, half * 2, half * 2),
            createToonMaterial(color, 3),
          );
          engine.scene.add(mesh);
          const body = physics.createDynamicBox(
            { x: half, y: half, z: half },
            { pos: { x: px, y: py, z: pz } },
            1,
          );
          body.setMesh(mesh);
          trackCube(body);
        }
      }
    }
  }

  // ── Truck ─────────────────────────────────────────────────────────────────
  const truckGroup = buildTruckMesh();
  engine.scene.add(truckGroup);
  // Spawn at +Z facing -Z so the truck points straight at the cube pile.
  // quat (0, 1, 0, 0) is a 180° rotation about the Y axis.
  const truck = Vehicle.create(physics, {
    pos: { x: 0, y: 1.2, z: 6 },
    quat: { x: 0, y: 1, z: 0, w: 0 },
  });
  truck.chassis.setMesh(truckGroup);

  if (spawnCubes) {
    // Drop a few light cubes into the truck bed. Truck faces -Z in world,
    // bed walls extend from y≈1.7 to y≈2.2 (world), so spawn above that.
    // Keep z > 7 so they land away from the cab mesh.
    const bedHalf = 0.2;
    const bedCubes = [
      { x: -0.4, y: 3.0, z: 7.3 },
      { x: 0.4, y: 3.0, z: 7.6 },
      { x: 0.0, y: 3.5, z: 7.9 },
    ];
    for (let i = 0; i < bedCubes.length; i++) {
      const p = bedCubes[i];
      const mesh = new Mesh(
        new BoxGeometry(bedHalf * 2, bedHalf * 2, bedHalf * 2),
        createToonMaterial(CUBE_COLORS[(i + 2) % CUBE_COLORS.length], 3),
      );
      engine.scene.add(mesh);
      const body = physics.createDynamicBox(
        { x: bedHalf, y: bedHalf, z: bedHalf },
        { pos: p },
        0.5,
      );
      body.setMesh(mesh);
      trackCube(body);
    }
  }

  // Bind the 4 wheel meshes to vehicle wheel local poses each frame. Wheels
  // are children of truckGroup, so their local transform is exactly the
  // wheel's pose relative to the chassis.
  const wheelMeshes = [
    truckGroup.getObjectByName('wheel-fl') as Mesh,
    truckGroup.getObjectByName('wheel-fr') as Mesh,
    truckGroup.getObjectByName('wheel-rl') as Mesh,
    truckGroup.getObjectByName('wheel-rr') as Mesh,
  ];

  // Keyboard input: track which arrows are held.
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    keys.add(e.key);
    // Prevent page scroll on arrow keys once the canvas is focused.
    if (e.key.startsWith('Arrow')) e.preventDefault();
  }, { passive: false });
  window.addEventListener('keyup', (e) => keys.delete(e.key));

  engine.onUpdate(() => {
    const up = keys.has('ArrowUp');
    const down = keys.has('ArrowDown');
    const left = keys.has('ArrowLeft');
    const right = keys.has('ArrowRight');

    // ArrowUp = forward throttle. ArrowDown = brake if moving forward, else
    // drive in reverse. Steer from left/right.
    const fwd = truck.forwardSpeed;
    if (down && fwd > 1.5) {
      truck.setThrottle(0);
      truck.setBrake(1);
      truck.setReverse(false);
    } else if (down) {
      truck.setThrottle(1);
      truck.setBrake(0);
      truck.setReverse(true);
    } else if (up) {
      truck.setThrottle(1);
      truck.setBrake(0);
      truck.setReverse(false);
    } else {
      truck.setThrottle(0);
      truck.setBrake(0);
    }
    truck.setSteer((left ? -1 : 0) + (right ? 1 : 0));

    for (let i = 0; i < 4; i++) {
      const p = truck.wheelLocalPoses[i];
      wheelMeshes[i].position.set(p.pos.x, p.pos.y, p.pos.z);
      wheelMeshes[i].quaternion.set(p.quat!.x, p.quat!.y, p.quat!.z, p.quat!.w);
    }

    audio.updateEngine(truck.engineRpm, up || down);

    // Collision detection via per-cube velocity deltas. Threshold rejects the
    // ~0.16 m/s frame-to-frame drift from gravity-only fall; genuine impacts
    // (cube landing, truck plowing through pile) easily exceed several m/s.
    const now = performance.now();
    const BONK_DV = 2.2;
    const BONK_COOLDOWN_MS = 80;
    for (const tc of tracked) {
      const lv = tc.body.actor.getLinearVelocity();
      if (tc.primed) {
        const dvx = lv.x - tc.lastVx;
        const dvy = lv.y - tc.lastVy;
        const dvz = lv.z - tc.lastVz;
        const dv = Math.hypot(dvx, dvy, dvz);
        if (dv > BONK_DV && now - tc.lastBonk > BONK_COOLDOWN_MS) {
          audio.bonk(dv);
          tc.lastBonk = now;
        }
      }
      tc.lastVx = lv.x; tc.lastVy = lv.y; tc.lastVz = lv.z;
      tc.primed = true;
    }
  });

  const sun = new DirectionalLight(0xffffff, 2.0);
  sun.position.set(4, 8, 5);
  engine.scene.add(sun);
  engine.scene.add(new AmbientLight(0xffffff, 0.3));

  engine.camera.position.set(8, 6, 10);
  const controls = new OrbitControls(engine.camera, canvas);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 25;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  engine.onUpdate(() => controls.update());

  // Tap-to-spawn: short click (no drag) spawns whatever the toolbar has
  // selected just in front of the camera and lobs it forward. Drags are
  // reserved for orbiting.
  type SpawnKind = 'cube' | 'sphere' | 'skeleton';
  let spawnKind: SpawnKind = 'cube';
  const toolbarButtons = document.querySelectorAll<HTMLButtonElement>('#toolbar button');
  toolbarButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      spawnKind = btn.dataset.spawn as SpawnKind;
      toolbarButtons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  // Skeleton asset is lazy-loaded the first time the user spawns one so we
  // don't block initial frame. Cached for subsequent spawns.
  let skeletonPromise: Promise<RagdollTemplate> | null = null;
  function getSkeleton(): Promise<RagdollTemplate> {
    if (!skeletonPromise) {
      const base = (import.meta as any).env?.BASE_URL ?? '/';
      skeletonPromise = preloadSkeleton(`${base}skeletons/owl/mesh.glb`);
    }
    return skeletonPromise;
  }

  // Each spawned skinned ragdoll owns a per-frame drive() that maps physics
  // bodies back onto its bones. They're all called once per render frame.
  const activeRagdolls: SpawnedRagdoll[] = [];
  engine.onUpdate(() => {
    for (const r of activeRagdolls) r.drive();
  });

  let downX = 0, downY = 0, downTime = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    downTime = performance.now();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    const dt = performance.now() - downTime;
    if (dx * dx + dy * dy > 25 || dt > 400) return; // dragged or held → orbit
    lobSelected();
  });

  const lobDir = new Vector3();
  const lobSpawn = new Vector3();
  function computeLobSpawn(): void {
    engine.camera.getWorldDirection(lobDir);
    lobSpawn.copy(engine.camera.position)
      .addScaledVector(lobDir, 1.2)
      .addScaledVector(engine.camera.up, -0.5);
  }
  function lobSelected(): void {
    computeLobSpawn();
    if (spawnKind === 'cube') lobCube();
    else if (spawnKind === 'sphere') lobSphere();
    else if (spawnKind === 'skeleton') lobSkeleton();
  }

  const cubeMass = 1.5;
  function lobCube(): void {
    const half = 0.2;
    const color = CUBE_COLORS[Math.floor(Math.random() * CUBE_COLORS.length)];
    const mesh = new Mesh(
      new BoxGeometry(half * 2, half * 2, half * 2),
      createToonMaterial(color, 3),
    );
    engine.scene.add(mesh);
    const body = physics.createDynamicBox(
      { x: half, y: half, z: half },
      { pos: { x: lobSpawn.x, y: lobSpawn.y, z: lobSpawn.z } },
      cubeMass,
    );
    body.setMesh(mesh);
    applyLobImpulse(body, cubeMass);
    trackCube(body);
  }

  function lobSphere(): void {
    const r = 0.25;
    const color = CUBE_COLORS[Math.floor(Math.random() * CUBE_COLORS.length)];
    const mesh = new Mesh(
      new SphereGeometry(r, 16, 12),
      createToonMaterial(color, 3),
    );
    engine.scene.add(mesh);
    const mass = 1.0;
    const body = physics.createDynamicSphere(
      r,
      { pos: { x: lobSpawn.x, y: lobSpawn.y, z: lobSpawn.z } },
      mass,
    );
    body.setMesh(mesh);
    applyLobImpulse(body, mass);
    trackCube(body);
  }

  async function lobSkeleton(): Promise<void> {
    const skel = await getSkeleton();
    const origin = new Vector3(lobSpawn.x, lobSpawn.y + 1.8, lobSpawn.z);
    const result = spawnRagdoll(physics, engine.scene, skel, origin);
    activeRagdolls.push(result);
    for (const b of result.bodies) trackCube(b);
  }

  function applyLobImpulse(body: RigidBody, mass: number): void {
    const speed = 9;
    const arc = 3;
    physics.addImpulse(body, {
      x: lobDir.x * speed * mass,
      y: (lobDir.y * speed + arc) * mass,
      z: lobDir.z * speed * mass,
    });
  }

  engine.start();

  // Runtime hooks so we can A/B the look from devtools and drive from tests.
  (window as any).engine = engine;
  (window as any).physics = physics;
  (window as any).truck = truck;
}

// Build a boxy pickup: lower chassis + cab + 3-sided bed walls + 4 wheels.
function buildTruckMesh(): Group {
  const g = new Group();

  const body = new Mesh(new BoxGeometry(1.9, 0.5, 4.6), createToonMaterial(0xc0392b, 3));
  body.position.y = -0.15;
  g.add(body);

  // Front wheels (the ones that steer) are at +Z, so cab + windshield go on
  // the +Z side and the bed trails behind at -Z.
  const cab = new Mesh(new BoxGeometry(1.8, 0.7, 1.8), createToonMaterial(0xa03020, 3));
  cab.position.set(0, 0.45, 0.6);
  g.add(cab);

  // Windshield darker strip on the cab front (facing +Z, the driving direction).
  const windshield = new Mesh(new BoxGeometry(1.7, 0.35, 0.08), createToonMaterial(0x2a3040, 3));
  windshield.position.set(0, 0.55, 1.45);
  g.add(windshield);

  // Bed walls — positions must match Vehicle._attachBodyColliders so the
  // visible mesh lines up with the physics collider. chassisDims=(1.9,1,4.6)
  // → side walls at x=±0.87, y=0.75, z=-1.38, tail at z=-2.3, 0.5m tall.
  const bedColor = 0xa03020;
  const wallL = new Mesh(new BoxGeometry(0.16, 0.5, 1.84), createToonMaterial(bedColor, 3));
  wallL.position.set(-0.87, 0.75, -1.38);
  g.add(wallL);
  const wallR = new Mesh(new BoxGeometry(0.16, 0.5, 1.84), createToonMaterial(bedColor, 3));
  wallR.position.set(0.87, 0.75, -1.38);
  g.add(wallR);
  const wallB = new Mesh(new BoxGeometry(1.9, 0.5, 0.16), createToonMaterial(bedColor, 3));
  wallB.position.set(0, 0.75, -2.3);
  g.add(wallB);

  // 4 wheels. CylinderGeometry's axis defaults to +Y. We bake a 90°-about-Z
  // rotation into the vertices so the cylinder axis becomes the lateral X axis
  // permanently — the per-frame quaternion from the vehicle will overwrite
  // wheel.quaternion, so a mesh-level rotation wouldn't survive.
  const wheelGeom = new CylinderGeometry(0.45, 0.45, 0.35, 16);
  wheelGeom.rotateZ(Math.PI / 2);
  const wheelMat = createToonMaterial(0x202020, 3);
  const placeWheel = (name: string, x: number, z: number): Mesh => {
    const w = new Mesh(wheelGeom, wheelMat);
    w.name = name;
    w.position.set(x, -0.4, z);
    g.add(w);
    return w;
  };
  placeWheel('wheel-fl', 0.85, 1.55);
  placeWheel('wheel-fr', -0.85, 1.55);
  placeWheel('wheel-rl', 0.85, -1.55);
  placeWheel('wheel-rr', -0.85, -1.55);

  return g;
}

start().catch((err) => {
  console.error(err);
  const overlay = document.getElementById('error-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.textContent = `Failed to start: ${err.message ?? err}`;
  }
});
