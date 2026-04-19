import {
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  AmbientLight,
  Group,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Engine, Physics, Vehicle, createToonMaterial } from '../engine';

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

  if (spawnCubes) {
    const cubeA = new Mesh(new BoxGeometry(1.5, 1.5, 1.5), createToonMaterial(0xe8564a, 3));
    cubeA.position.set(-2, 0.75, 0);
    engine.scene.add(cubeA);

    const cubeB = new Mesh(new BoxGeometry(1, 2, 1), createToonMaterial(0xffd24a, 3));
    cubeB.position.set(1.5, 1, -1);
    engine.scene.add(cubeB);

    const sphere = new Mesh(new SphereGeometry(0.8, 24, 16), createToonMaterial(0x9a66ff, 3));
    sphere.position.set(0, 0.8, 2);
    engine.scene.add(sphere);

    const barrel = new Mesh(new CylinderGeometry(0.5, 0.5, 1.2, 16), createToonMaterial(0xc07a3a, 3));
    barrel.position.set(2.5, 0.6, 1.5);
    engine.scene.add(barrel);

    engine.onUpdate(() => {
      sphere.position.y = 0.9 + Math.sin(performance.now() * 0.002) * 0.3;
      cubeA.rotation.y += 0.005;
      cubeB.rotation.y -= 0.003;
    });
  }

  // ── Truck ─────────────────────────────────────────────────────────────────
  const truckGroup = buildTruckMesh();
  engine.scene.add(truckGroup);
  // Spawn slightly in front of the cube cluster, facing -Z.
  const truck = Vehicle.create(physics, { pos: { x: 0, y: 1.2, z: 6 } });
  truck.chassis.setMesh(truckGroup);

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

  const cab = new Mesh(new BoxGeometry(1.8, 0.7, 1.8), createToonMaterial(0xa03020, 3));
  cab.position.set(0, 0.45, -0.6);
  g.add(cab);

  // Windshield darker strip on the cab front.
  const windshield = new Mesh(new BoxGeometry(1.7, 0.35, 0.08), createToonMaterial(0x2a3040, 3));
  windshield.position.set(0, 0.55, -1.45);
  g.add(windshield);

  // Bed: 3 short walls (left, right, back) forming an open truck bed.
  const bedColor = 0xa03020;
  const wallL = new Mesh(new BoxGeometry(0.12, 0.35, 1.9), createToonMaterial(bedColor, 3));
  wallL.position.set(-0.89, 0.25, 1.3);
  g.add(wallL);
  const wallR = new Mesh(new BoxGeometry(0.12, 0.35, 1.9), createToonMaterial(bedColor, 3));
  wallR.position.set(0.89, 0.25, 1.3);
  g.add(wallR);
  const wallB = new Mesh(new BoxGeometry(1.78, 0.35, 0.12), createToonMaterial(bedColor, 3));
  wallB.position.set(0, 0.25, 2.2);
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
