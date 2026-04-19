import {
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  AmbientLight,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Engine, createToonMaterial } from '../engine';

async function start(): Promise<void> {
  const canvas = document.getElementById('demo-canvas') as HTMLCanvasElement;
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not available — try Chrome 113+ or enable chrome://flags/#enable-unsafe-webgpu');
  }
  const engine = new Engine({
    canvas,
    pixelSize: 4,
    depthEdgeStrength: 1.0,
    normalEdgeStrength: 1.0,
    lineHighlight: 0.2,
    lineShadow: 0.55,
    backgroundColor: 0x6b8cff,
  });

  await engine.ready();

  const ground = new Mesh(new PlaneGeometry(30, 30), createToonMaterial(0x7cbf4a, 3));
  ground.rotation.x = -Math.PI / 2;
  engine.scene.add(ground);

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

  const sun = new DirectionalLight(0xffffff, 2.0);
  sun.position.set(4, 8, 5);
  engine.scene.add(sun);
  engine.scene.add(new AmbientLight(0xffffff, 0.3));

  engine.camera.position.set(5, 4.5, 6);
  const controls = new OrbitControls(engine.camera, canvas);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  engine.onUpdate(() => {
    sphere.position.y = 0.9 + Math.sin(performance.now() * 0.002) * 0.3;
    cubeA.rotation.y += 0.005;
    cubeB.rotation.y -= 0.003;
    controls.update();
  });

  engine.start();

  // Simple runtime tweak hooks so we can A/B the look from devtools.
  (window as any).engine = engine;
}

start().catch((err) => {
  console.error(err);
  const overlay = document.getElementById('error-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.textContent = `Failed to start: ${err.message ?? err}`;
  }
});
