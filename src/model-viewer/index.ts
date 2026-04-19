import {
  AmbientLight,
  AxesHelper,
  Box3,
  Box3Helper,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  SkinnedMesh,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement;
const infoEl = document.getElementById('info') as HTMLDivElement;

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

const scene = new Scene();
scene.background = new Color(0x15151d);

const camera = new PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.01, 100);
camera.position.set(2, 1.5, 2);
camera.lookAt(0, 0.5, 0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(3, 5, 2);
scene.add(sun);

const grid = new GridHelper(4, 20, 0x444455, 0x2a2a35);
scene.add(grid);

const axes = new AxesHelper(0.5);
axes.visible = false;
scene.add(axes);

window.addEventListener('resize', () => {
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
});

// Currently-shown model gets swapped out whenever the picker changes. We keep
// the helpers as siblings so the visibility toggles survive model switches.
let modelRoot: Object3D | null = null;
let skeletonHelper: SkeletonHelper | null = null;
let bboxHelper: Box3Helper | null = null;

const loader = new GLTFLoader();
async function loadModel(name: string): Promise<void> {
  if (modelRoot) {
    scene.remove(modelRoot);
    modelRoot = null;
  }
  if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper = null; }
  if (bboxHelper) { scene.remove(bboxHelper); bboxHelper = null; }

  const base = (import.meta as any).env?.BASE_URL ?? '/';
  const url = `${base}skeletons/${name}/mesh.glb`;
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;

  // Frame the model to a reasonable view by measuring its bounding box and
  // translating it so its base sits at y=0, re-aiming the orbit target and
  // camera at its center.
  root.updateMatrixWorld(true);
  const bbox = new Box3().setFromObject(root);
  const size = bbox.getSize(new Vector3());
  const center = bbox.getCenter(new Vector3());
  // Raise model so bbox.min.y = 0 (stands on the grid)
  root.position.y -= bbox.min.y;
  scene.add(root);

  // Bone helper hangs off a SkinnedMesh's skeleton root if present.
  let skinned: SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!skinned && (o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
  });
  if (skinned) {
    skeletonHelper = new SkeletonHelper(root);
    (skeletonHelper.material as any).linewidth = 2;
    skeletonHelper.visible = (document.getElementById('toggle-skeleton') as HTMLInputElement).checked;
    scene.add(skeletonHelper);
  }

  bboxHelper = new Box3Helper(new Box3().setFromObject(root), 0x44aaff);
  bboxHelper.visible = (document.getElementById('toggle-bbox') as HTMLInputElement).checked;
  scene.add(bboxHelper);

  // Re-aim the camera at the model's world-space center with a distance
  // proportional to its largest extent so small and large models both frame.
  const maxDim = Math.max(size.x, size.y, size.z);
  const targetY = center.y - bbox.min.y; // after we translated root up
  const dist = Math.max(1, maxDim * 2.2);
  controls.target.set(0, targetY, 0);
  camera.position.set(dist * 0.9, targetY + dist * 0.5, dist * 0.9);
  controls.update();

  modelRoot = root;
  applyWireframe((document.getElementById('toggle-wire') as HTMLInputElement).checked);

  // Info HUD: dump the raw dimensions and mesh stats for sanity.
  const meshes: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  const lines: string[] = [];
  lines.push(`model: ${name}`);
  lines.push(`bbox: (${size.x.toFixed(3)}, ${size.y.toFixed(3)}, ${size.z.toFixed(3)}) m`);
  lines.push(`meshes: ${meshes.length}`);
  if (skinned) {
    const s = skinned as SkinnedMesh;
    lines.push(`skinned: yes, bones=${s.skeleton.bones.length}`);
    const geomAttr = s.geometry.getAttribute('position');
    lines.push(`verts: ${geomAttr?.count ?? '?'}`);
    const matName = Array.isArray(s.material) ? s.material.map((m) => m.type).join(',') : s.material.type;
    lines.push(`material: ${matName}`);
  } else {
    lines.push('skinned: no');
  }
  infoEl.textContent = lines.join('\n');
}

function applyWireframe(enabled: boolean): void {
  if (!modelRoot) return;
  modelRoot.traverse((o) => {
    const m = (o as Mesh).material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach((mm) => ((mm as any).wireframe = enabled));
    else (m as any).wireframe = enabled;
  });
}

// Wire UI controls.
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
modelSelect.addEventListener('change', () => loadModel(modelSelect.value));

(document.getElementById('toggle-skeleton') as HTMLInputElement).addEventListener('change', (e) => {
  if (skeletonHelper) skeletonHelper.visible = (e.target as HTMLInputElement).checked;
});
(document.getElementById('toggle-bbox') as HTMLInputElement).addEventListener('change', (e) => {
  if (bboxHelper) bboxHelper.visible = (e.target as HTMLInputElement).checked;
});
(document.getElementById('toggle-axes') as HTMLInputElement).addEventListener('change', (e) => {
  axes.visible = (e.target as HTMLInputElement).checked;
});
(document.getElementById('toggle-wire') as HTMLInputElement).addEventListener('change', (e) => {
  applyWireframe((e.target as HTMLInputElement).checked);
});

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

await loadModel(modelSelect.value);
