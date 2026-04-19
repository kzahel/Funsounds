import {
  BoxGeometry,
  DirectionalLight,
  AmbientLight,
  Mesh,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
  MathUtils,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Engine, Physics, createToonMaterial, type RigidBody } from '../engine';

const BOX_COLORS = [
  0xe8564a, 0xffd24a, 0x9a66ff, 0x7cbf4a, 0x4ac4e8,
  0xff8a3d, 0xfde14a, 0xc07a3a, 0x5a8fff, 0xff6ba0,
];

async function start(): Promise<void> {
  const canvas = document.getElementById('demo-canvas') as HTMLCanvasElement;
  const statsEl = document.getElementById('stats');
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not available — try Chrome 113+ or enable chrome://flags/#enable-unsafe-webgpu');
  }

  const engine = new Engine({
    canvas,
    pixelSize: 3,
    depthEdgeStrength: 1.0,
    normalEdgeStrength: 1.0,
    lineHighlight: 0.18,
    lineShadow: 0.55,
    backgroundColor: 0x4a6bcc,
  });

  const physics = await Physics.create({ gravity: { x: 0, y: -18, z: 0 } });
  engine.setPhysics(physics);

  await engine.ready();

  // Ground: visible plane mesh + matching static PhysX plane at y=0.
  const groundMesh = new Mesh(new PlaneGeometry(120, 120), createToonMaterial(0x7cbf4a, 3));
  groundMesh.rotation.x = -Math.PI / 2;
  engine.scene.add(groundMesh);
  physics.createStaticPlane({ pos: { x: 0, y: 0, z: 0 } });

  // ~200 dynamic boxes stacked in a grid above the ground.
  const dynamicBodies: RigidBody[] = [];
  const spacing = 1.6;
  const cols = 6;
  const rows = 6;
  const layers = 6;
  const boxSize = 0.55; // half-extent
  for (let y = 0; y < layers; y++) {
    for (let x = 0; x < cols; x++) {
      for (let z = 0; z < rows; z++) {
        const px = (x - (cols - 1) / 2) * spacing + (Math.random() - 0.5) * 0.2;
        const pz = (z - (rows - 1) / 2) * spacing + (Math.random() - 0.5) * 0.2;
        const py = 2 + y * (boxSize * 2 + 0.4);
        const color = BOX_COLORS[(x + y + z) % BOX_COLORS.length];
        const mesh = new Mesh(
          new BoxGeometry(boxSize * 2, boxSize * 2, boxSize * 2),
          createToonMaterial(color, 3),
        );
        engine.scene.add(mesh);
        const body = physics.createDynamicBox(
          { x: boxSize, y: boxSize, z: boxSize },
          { pos: { x: px, y: py, z: pz } },
          1,
        );
        body.setMesh(mesh);
        dynamicBodies.push(body);
      }
    }
  }

  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(6, 10, 4);
  engine.scene.add(sun);
  engine.scene.add(new AmbientLight(0xffffff, 0.35));

  engine.camera.position.set(9, 7, 12);
  const controls = new OrbitControls(engine.camera, canvas);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  // Click → raycast → yeet the box skyward.
  const raycaster = new Raycaster();
  const pointerNdc = new Vector2();
  const origin = new Vector3();
  const direction = new Vector3();
  canvas.addEventListener('pointerdown', (e) => {
    // Ignore if a drag started — OrbitControls will handle camera pan on
    // pointermove; we only fire on synthetic click-with-no-drag here.
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, engine.camera);
    origin.copy(raycaster.ray.origin);
    direction.copy(raycaster.ray.direction);
    const hit = physics.raycast(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
      100,
    );
    if (hit && hit.body.isDynamic) {
      const upward = MathUtils.randFloat(14, 22);
      const lateral = MathUtils.randFloatSpread(6);
      physics.addImpulse(hit.body, { x: lateral, y: upward, z: lateral * 0.5 });
    }
  });

  let frameCount = 0;
  let lastStatsTime = performance.now();
  let fps = 0;
  engine.onUpdate(() => {
    controls.update();
    frameCount++;
    const now = performance.now();
    if (now - lastStatsTime > 500) {
      fps = Math.round((frameCount * 1000) / (now - lastStatsTime));
      frameCount = 0;
      lastStatsTime = now;
      if (statsEl) {
        statsEl.innerHTML =
          `bodies: ${physics.bodyCount}<br/>active: ${physics.activeCount}<br/>fps: ${fps}`;
      }
    }
  });

  engine.start();

  (window as any).engine = engine;
  (window as any).physics = physics;
  (window as any).dynamicBodies = dynamicBodies;
}

start().catch((err) => {
  console.error(err);
  const overlay = document.getElementById('error-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.textContent = `Failed to start: ${err.message ?? err}`;
  }
});
