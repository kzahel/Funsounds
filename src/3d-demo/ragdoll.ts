import {
  Bone,
  Matrix4,
  Object3D,
  Quaternion,
  Scene,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeletonAware } from 'three/addons/utils/SkeletonUtils.js';
import { Physics, RigidBody } from '../engine';

// A preloaded ragdoll template: the GLTF scene (cloned per spawn) plus bone
// metadata extracted from its bind pose. Use `preloadSkeleton(url)` once per
// asset, then `spawnRagdoll(physics, scene, template, origin)` per spawn.
export interface RagdollTemplate {
  sceneTemplate: Object3D;
  bonesMeta: BoneMeta[];
  rootIndices: number[];
  suggestedScale: number;
}

interface BoneMeta {
  index: number;
  name: string;
  parent: number;               // -1 if root
  bindWorldPos: Vector3;        // bind-pose world position (pre-spawn origin)
  bindWorldQuat: Quaternion;    // bind-pose world rotation
}

export async function preloadSkeleton(url: string): Promise<RagdollTemplate> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);

  // Materialize the scene graph so we can read bone world transforms.
  gltf.scene.updateMatrixWorld(true);

  let skinned: SkinnedMesh | null = null;
  gltf.scene.traverse((o) => {
    if (!skinned && (o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
  });
  if (!skinned) throw new Error(`No SkinnedMesh found in ${url}`);
  const sm = skinned as SkinnedMesh;

  const bones = sm.skeleton.bones;
  const indexOf = new Map<Bone, number>();
  bones.forEach((b, i) => indexOf.set(b, i));

  const bonesMeta: BoneMeta[] = bones.map((bone, i) => {
    const wp = new Vector3();
    const wq = new Quaternion();
    const _s = new Vector3();
    bone.matrixWorld.decompose(wp, wq, _s);
    let parent = -1;
    if (bone.parent && (bone.parent as Bone).isBone) {
      parent = indexOf.get(bone.parent as Bone) ?? -1;
    }
    return { index: i, name: bone.name, parent, bindWorldPos: wp, bindWorldQuat: wq };
  });

  const rootIndices: number[] = [];
  for (let i = 0; i < bonesMeta.length; i++) {
    if (bonesMeta[i].parent < 0) rootIndices.push(i);
  }

  // Auto-scale: bind pose Y-span → suggested 1.5× the span as a nice visible size.
  let minY = Infinity, maxY = -Infinity;
  for (const m of bonesMeta) {
    if (m.bindWorldPos.y < minY) minY = m.bindWorldPos.y;
    if (m.bindWorldPos.y > maxY) maxY = m.bindWorldPos.y;
  }
  const span = maxY - minY;
  const suggestedScale = span > 1e-4 ? 1.2 / span : 1.0;

  return { sceneTemplate: gltf.scene, bonesMeta, rootIndices, suggestedScale };
}

export interface SpawnedRagdoll {
  bodies: RigidBody[];
  root: Object3D;      // the cloned scene root added to the scene
  drive: () => void;   // call each frame (in engine.onUpdate) to sync bones
}

// One entry per bone connecting its bone object to the physics body that
// drives it. `anchorLocal` is the offset from body-origin to bone-world in
// body-local space (zero for root spheres, (halfLen,0,0) for capsule limbs).
// `offsetQuat` is applied on top of body rotation to recover the bind-pose
// bone orientation.
interface BoneDriver {
  bone: Bone;
  poseProxy: Object3D;          // receives physics.interpolate() output
  anchorLocal: Vector3;
  offsetQuat: Quaternion;
}

export function spawnRagdoll(
  physics: Physics,
  scene: Scene,
  tpl: RagdollTemplate,
  origin: Vector3,
  scale?: number,
): SpawnedRagdoll {
  const s = scale ?? tpl.suggestedScale;

  // Clone the GLTF scene (deep clone that duplicates the skeleton so each
  // spawn has an independent rig — the plain Object3D.clone shares bones).
  const root = cloneSkeletonAware(tpl.sceneTemplate);
  scene.add(root);

  // Drive the whole model to the spawn origin + scale via the root, then bake
  // it into world matrices so we can read spawn-world bone positions.
  // After this we'll flip the bones to manual matrixWorld control.
  root.position.copy(origin);
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);

  // Pull the cloned SkinnedMesh + fresh bones (bones array order matches the
  // template's — same skeleton topology).
  let skinned: SkinnedMesh | null = null;
  root.traverse((o: Object3D) => {
    if (!skinned && (o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
  });
  if (!skinned) throw new Error('spawnRagdoll: cloned scene has no SkinnedMesh');
  const sm = skinned as SkinnedMesh;
  const bones = sm.skeleton.bones;

  // Spawn-world positions for every bone (bind pose × scale + origin).
  const spawnPos = tpl.bonesMeta.map((m) =>
    new Vector3().copy(m.bindWorldPos).multiplyScalar(s).add(origin),
  );

  const capsuleRadius = Math.max(0.04, 0.07 * s);
  const bodies: (RigidBody | null)[] = new Array(tpl.bonesMeta.length).fill(null);
  const drivers: BoneDriver[] = [];

  const _xAxis = new Vector3(1, 0, 0);
  const _dir = new Vector3();
  const _mid = new Vector3();
  const _bodyQuat = new Quaternion();
  const _bodyQuatInv = new Quaternion();
  const _offsetQuat = new Quaternion();

  for (let i = 0; i < tpl.bonesMeta.length; i++) {
    const meta = tpl.bonesMeta[i];
    const bone = bones[i];

    // Freeze Three.js off this bone — our driver owns matrixWorld now.
    bone.matrixAutoUpdate = false;
    bone.matrixWorldAutoUpdate = false;

    const poseProxy = new Object3D();

    if (meta.parent < 0) {
      // Root: little sphere at the bone, keeping bind rotation so offsetQuat
      // is identity and the SkinnedMesh is at rest on the first frame.
      const body = physics.createDynamicSphere(
        capsuleRadius * 1.3,
        {
          pos: { x: spawnPos[i].x, y: spawnPos[i].y, z: spawnPos[i].z },
          quat: { x: meta.bindWorldQuat.x, y: meta.bindWorldQuat.y, z: meta.bindWorldQuat.z, w: meta.bindWorldQuat.w },
        },
        0.8,
        true,
      );
      body.setMesh(poseProxy);
      bodies[i] = body;
      drivers.push({
        bone,
        poseProxy,
        anchorLocal: new Vector3(0, 0, 0),
        offsetQuat: new Quaternion(0, 0, 0, 1),
      });
      continue;
    }

    const p = spawnPos[meta.parent];
    const c = spawnPos[i];
    _dir.subVectors(c, p);
    const length = _dir.length();
    if (length < 1e-4) {
      // Zero-length degenerate bone: fall back to sphere at bone position.
      const body = physics.createDynamicSphere(
        capsuleRadius,
        {
          pos: { x: c.x, y: c.y, z: c.z },
          quat: { x: meta.bindWorldQuat.x, y: meta.bindWorldQuat.y, z: meta.bindWorldQuat.z, w: meta.bindWorldQuat.w },
        },
        0.2,
        true,
      );
      body.setMesh(poseProxy);
      bodies[i] = body;
      drivers.push({
        bone,
        poseProxy,
        anchorLocal: new Vector3(0, 0, 0),
        offsetQuat: new Quaternion(0, 0, 0, 1),
      });
      continue;
    }
    _dir.divideScalar(length);

    // Body rotation aligns +X with parent→child direction so the capsule
    // spans the limb naturally. Body position is the midpoint.
    _bodyQuat.setFromUnitVectors(_xAxis, _dir);
    _mid.addVectors(p, c).multiplyScalar(0.5);

    // offsetQuat: applied as (body × offsetQuat) = bind_bone_quat.
    // Equivalently offsetQuat = body.inverse() * bind_bone_quat.
    _bodyQuatInv.copy(_bodyQuat).invert();
    _offsetQuat.multiplyQuaternions(_bodyQuatInv, meta.bindWorldQuat);

    // PxCapsuleGeometry halfHeight is cylinder-only (caps add `radius` on
    // each side). Our `length` is end-to-end, so subtract 2r and clamp.
    const halfHeight = Math.max(0, (length - 2 * capsuleRadius) * 0.5);
    const body = physics.createDynamicCapsule(
      capsuleRadius,
      halfHeight,
      {
        pos: { x: _mid.x, y: _mid.y, z: _mid.z },
        quat: { x: _bodyQuat.x, y: _bodyQuat.y, z: _bodyQuat.z, w: _bodyQuat.w },
      },
      0.6,
      true,
    );
    body.setMesh(poseProxy);
    bodies[i] = body;

    drivers.push({
      bone,
      poseProxy,
      anchorLocal: new Vector3(length * 0.5, 0, 0),
      offsetQuat: _offsetQuat.clone(),
    });
  }

  const SWING = (5 * Math.PI) / 180;
  for (let i = 0; i < tpl.bonesMeta.length; i++) {
    const meta = tpl.bonesMeta[i];
    if (meta.parent < 0) continue;
    const a = bodies[i];
    const b = bodies[meta.parent];
    if (!a || !b) continue;
    const anchor = spawnPos[meta.parent];
    physics.createD6Joint(
      a, b,
      { x: anchor.x, y: anchor.y, z: anchor.z },
      SWING, SWING,
    );
  }

  // Stitch additional disjoint roots to the first root with the same rigid D6.
  if (tpl.rootIndices.length > 1) {
    const anchorIdx = tpl.rootIndices[0];
    const anchorBody = bodies[anchorIdx];
    if (anchorBody) {
      for (let k = 1; k < tpl.rootIndices.length; k++) {
        const extraIdx = tpl.rootIndices[k];
        const extraBody = bodies[extraIdx];
        if (!extraBody) continue;
        const midX = (spawnPos[anchorIdx].x + spawnPos[extraIdx].x) * 0.5;
        const midY = (spawnPos[anchorIdx].y + spawnPos[extraIdx].y) * 0.5;
        const midZ = (spawnPos[anchorIdx].z + spawnPos[extraIdx].z) * 0.5;
        physics.createSphericalJoint(anchorBody, extraBody, { x: midX, y: midY, z: midZ }, SWING, SWING);
      }
    }
  }

  // Drive closure: convert each body's interpolated pose to the bone's
  // world-space matrix. Called once per render frame.
  const _bm = new Matrix4();
  const _bonePos = new Vector3();
  const _boneQuat = new Quaternion();
  const _one = new Vector3(1, 1, 1);
  const _anchorWorld = new Vector3();

  function drive(): void {
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i];
      // poseProxy.position / .quaternion were just written by physics.interpolate.
      _anchorWorld.copy(d.anchorLocal).applyQuaternion(d.poseProxy.quaternion);
      _bonePos.addVectors(d.poseProxy.position, _anchorWorld);
      _boneQuat.multiplyQuaternions(d.poseProxy.quaternion, d.offsetQuat);
      _bm.compose(_bonePos, _boneQuat, _one);
      d.bone.matrixWorld.copy(_bm);
    }
  }

  return {
    bodies: bodies.filter((b): b is RigidBody => b != null),
    root,
    drive,
  };
}
