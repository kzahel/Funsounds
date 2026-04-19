import PhysXFactory from 'physx-js-webidl';

export interface Vec3Like { x: number; y: number; z: number }
export interface QuatLike { x: number; y: number; z: number; w: number }
export interface Pose { pos: Vec3Like; quat?: QuatLike }

export interface MeshLike {
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
}

export interface RaycastHit {
  body: RigidBody;
  distance: number;
  position: Vec3Like;
  normal: Vec3Like;
}

export interface PhysicsOptions {
  gravity?: Vec3Like;
  fixedDt?: number;
}

// physx-js-webidl ships both the .mjs factory and .wasm alongside it. Its
// emscripten shim resolves the wasm via `new URL('...', import.meta.url)`,
// which Vite rewrites correctly for both dev and build. No explicit
// locateFile override needed.

type PhysXModule = any;

let _modulePromise: Promise<PhysXModule> | null = null;
function loadPhysXModule(): Promise<PhysXModule> {
  if (!_modulePromise) _modulePromise = PhysXFactory();
  return _modulePromise;
}

// A thin wrapper around a PxRigidActor that keeps a two-slot pose ring for
// interpolation between fixed-timestep physics ticks. Games bind a Three.js
// mesh (or anything with .position/.quaternion) via setMesh() and the engine
// drives the rest via `Physics.interpolate(alpha)` once per render frame.
export class RigidBody {
  readonly actor: any;
  readonly ptr: number;
  readonly isDynamic: boolean;
  isActive = true;
  private _mesh: MeshLike | null = null;

  private ax = 0; private ay = 0; private az = 0;
  private aqx = 0; private aqy = 0; private aqz = 0; private aqw = 1;
  private bx = 0; private by = 0; private bz = 0;
  private bqx = 0; private bqy = 0; private bqz = 0; private bqw = 1;

  constructor(actor: any, isDynamic: boolean) {
    this.actor = actor;
    this.ptr = actor.ptr;
    this.isDynamic = isDynamic;
    // Seed both slots so the first interpolate before any step still works.
    const t = actor.getGlobalPose();
    this.bx = this.ax = t.p.x;
    this.by = this.ay = t.p.y;
    this.bz = this.az = t.p.z;
    this.bqx = this.aqx = t.q.x;
    this.bqy = this.aqy = t.q.y;
    this.bqz = this.aqz = t.q.z;
    this.bqw = this.aqw = t.q.w;
  }

  setMesh(mesh: MeshLike): void { this._mesh = mesh; }
  get mesh(): MeshLike | null { return this._mesh; }

  getPosition(): Vec3Like { return { x: this.bx, y: this.by, z: this.bz }; }

  _capturePose(): void {
    this.ax = this.bx; this.ay = this.by; this.az = this.bz;
    this.aqx = this.bqx; this.aqy = this.bqy; this.aqz = this.bqz; this.aqw = this.bqw;
    const t = this.actor.getGlobalPose();
    this.bx = t.p.x; this.by = t.p.y; this.bz = t.p.z;
    this.bqx = t.q.x; this.bqy = t.q.y; this.bqz = t.q.z; this.bqw = t.q.w;
  }

  // Same shift-the-ring logic as _capturePose, but pose data came from the
  // batch slab so we already have raw floats and skip the getGlobalPose()
  // embind call per body.
  _capturePoseFromSlab(
    px: number, py: number, pz: number,
    qx: number, qy: number, qz: number, qw: number,
  ): void {
    this.ax = this.bx; this.ay = this.by; this.az = this.bz;
    this.aqx = this.bqx; this.aqy = this.bqy; this.aqz = this.bqz; this.aqw = this.bqw;
    this.bx = px; this.by = py; this.bz = pz;
    this.bqx = qx; this.bqy = qy; this.bqz = qz; this.bqw = qw;
  }

  // When a body goes to rest, the active-actors list stops reporting it, so
  // poseA/poseB get frozen with the last-captured tick. Snap the mesh to the
  // final pose once so it stops mid-interpolation between two stale slots.
  _snapMeshToLatest(): void {
    if (!this._mesh) return;
    this._mesh.position.set(this.bx, this.by, this.bz);
    this._mesh.quaternion.set(this.bqx, this.bqy, this.bqz, this.bqw);
  }

  _applyInterp(alpha: number): void {
    if (!this._mesh) return;
    const px = this.ax + (this.bx - this.ax) * alpha;
    const py = this.ay + (this.by - this.ay) * alpha;
    const pz = this.az + (this.bz - this.az) * alpha;
    let qx = this.aqx + (this.bqx - this.aqx) * alpha;
    let qy = this.aqy + (this.bqy - this.aqy) * alpha;
    let qz = this.aqz + (this.bqz - this.aqz) * alpha;
    let qw = this.aqw + (this.bqw - this.aqw) * alpha;
    // Normalize (cheap lerp → renormalize; fine for small per-tick deltas).
    const len = Math.hypot(qx, qy, qz, qw);
    if (len > 0) { qx /= len; qy /= len; qz /= len; qw /= len; }
    this._mesh.position.set(px, py, pz);
    this._mesh.quaternion.set(qx, qy, qz, qw);
  }
}

export class Physics {
  private _P: PhysXModule;
  readonly physics: any;
  readonly scene: any;
  readonly material: any;
  readonly fixedDt: number;
  readonly cookingParams: any;
  readonly module: PhysXModule;

  private _foundation: any;
  private _allocator: any;
  private _errorCb: any;
  private _tolerances: any;
  private _sceneDesc: any;
  private _dispatcher: any;
  private _shapeFlags: any;
  private _filterData: any;

  private _topLevel: any;
  private _vehicleTopLevel: any;
  private _vehicleExtInited = false;
  private _support: any;
  private _bodyExt: any;

  // Batch readback uses the fork's `SupportFunctions.PxScene_writeActiveTransforms`,
  // which dumps every active actor's {ptrU32, px, py, pz, qx, qy, qz, qw}
  // into a HEAPF32 slab in a single wasm call. ~10x faster than the stock
  // per-body loop at 2k+ bodies. Feature-detected at construction so the
  // same code runs on the unpatched npm build (stock path).
  private _hasBatch: boolean;
  private _slabPtr = 0;
  private _slabCapSlots = 0;
  private static readonly _BATCH_STRIDE = 8;

  // Reusable scratch objects — single-threaded so we don't need per-body pools.
  private _scratchVec: any;
  private _scratchOrigin: any;
  private _scratchDir: any;
  private _scratchPoseVec: any;
  private _scratchPoseQuat: any;
  private _raycastResult: any;
  private _impulseMode: number;

  private _bodies = new Map<number, RigidBody>();
  private _released = false;
  private _preStepListeners: Array<(dt: number) => void> = [];

  static async create(opts: PhysicsOptions = {}): Promise<Physics> {
    const P = await loadPhysXModule();
    return new Physics(P, opts);
  }

  private constructor(P: PhysXModule, opts: PhysicsOptions) {
    this._P = P;
    this.module = P;
    this.fixedDt = opts.fixedDt ?? 1 / 60;

    // The d.ts types these as `static` but runtime methods live on the
    // prototype — grab the prototype once and treat it as a function bag.
    this._topLevel = P.PxTopLevelFunctions.prototype;
    this._vehicleTopLevel = P.PxVehicleTopLevelFunctions?.prototype;
    this._support = P.SupportFunctions.prototype;
    this._bodyExt = P.PxRigidBodyExt.prototype;
    // Set `globalThis.__disableBatch = true` in devtools before loading to
    // force the stock readback path for A/B perf comparisons on a build
    // that does have the batch fn.
    this._hasBatch = typeof this._support.PxScene_writeActiveTransforms === 'function'
      && !((globalThis as any).__disableBatch);

    // PHYSICS_VERSION is exposed both on the module (as a convenience) and
    // on PxTopLevelFunctions.prototype (where all the other "static" methods
    // actually live at runtime). Reading `P.PxTopLevelFunctions.PHYSICS_VERSION`
    // returns undefined → version 0 → "Wrong version" crash.
    const VERSION = this._topLevel.PHYSICS_VERSION;

    this._allocator = new P.PxDefaultAllocator();
    this._errorCb = new P.PxDefaultErrorCallback();
    this._foundation = this._topLevel.CreateFoundation(VERSION, this._allocator, this._errorCb);
    this._tolerances = new P.PxTolerancesScale();
    this.physics = this._topLevel.CreatePhysics(VERSION, this._foundation, this._tolerances);

    this._sceneDesc = new P.PxSceneDesc(this._tolerances);
    const grav = opts.gravity ?? { x: 0, y: -9.81, z: 0 };
    const gv = new P.PxVec3(grav.x, grav.y, grav.z);
    this._sceneDesc.gravity = gv;
    this._dispatcher = this._topLevel.DefaultCpuDispatcherCreate(0);
    this._sceneDesc.cpuDispatcher = this._dispatcher;
    this._sceneDesc.filterShader = this._topLevel.DefaultFilterShader();
    this._sceneDesc.flags.raise(P.PxSceneFlagEnum.eENABLE_ACTIVE_ACTORS);
    this.scene = this.physics.createScene(this._sceneDesc);
    P.destroy(gv);

    this.material = this.physics.createMaterial(0.5, 0.5, 0.2);
    this.cookingParams = new P.PxCookingParams(this._tolerances);
    const simFlag = P.PxShapeFlagEnum?.eSIMULATION_SHAPE;
    const sqFlag = P.PxShapeFlagEnum?.eSCENE_QUERY_SHAPE;
    if (simFlag == null || sqFlag == null) {
      throw new Error(`PxShapeFlagEnum values unresolved: sim=${simFlag} sq=${sqFlag}`);
    }
    this._shapeFlags = new P.PxShapeFlags(sqFlag | simFlag);
    // PhysX's DefaultFilterShader only reports a pair as colliding when
    //   (shapeA.simulationFilterData.word0 & shapeB.simulationFilterData.word1) != 0
    // and vice-versa. Shapes created by `physics.createShape(...)` have all
    // four words = 0 by default, so pairs short-circuit to no-collision and
    // bodies fall through everything. Giving every shape the same non-zero
    // mask in word0 & word1 restores the expected "collide with everything"
    // behaviour. Callers who need filtering can override after createXxx.
    this._filterData = new P.PxFilterData(1, 1, 0, 0);

    this._scratchVec = new P.PxVec3(0, 0, 0);
    this._scratchOrigin = new P.PxVec3(0, 0, 0);
    this._scratchDir = new P.PxVec3(0, 1, 0);
    this._scratchPoseVec = new P.PxVec3(0, 0, 0);
    this._scratchPoseQuat = new P.PxQuat(P.PxIDENTITYEnum.PxIdentity);
    this._raycastResult = new P.PxRaycastResult();
    this._impulseMode = P.PxForceModeEnum.eIMPULSE;
  }

  createDynamicBox(halfExtents: Vec3Like, pose: Pose, mass = 1): RigidBody {
    const P = this._P;
    const geom = new P.PxBoxGeometry(halfExtents.x, halfExtents.y, halfExtents.z);
    const t = this._buildTransform(pose);
    const actor = this.physics.createRigidDynamic(t);
    const shape = this.physics.createShape(geom, this.material, true, this._shapeFlags);
    shape.setSimulationFilterData(this._filterData);
    actor.attachShape(shape);
    this._bodyExt.setMassAndUpdateInertia(actor, mass);
    this.scene.addActor(actor);
    P.destroy(geom);
    P.destroy(t);
    shape.release();

    const rb = new RigidBody(actor, true);
    this._bodies.set(rb.ptr, rb);
    return rb;
  }

  createStaticBox(halfExtents: Vec3Like, pose: Pose): RigidBody {
    const P = this._P;
    const geom = new P.PxBoxGeometry(halfExtents.x, halfExtents.y, halfExtents.z);
    const t = this._buildTransform(pose);
    const actor = this.physics.createRigidStatic(t);
    const shape = this.physics.createShape(geom, this.material, true, this._shapeFlags);
    shape.setSimulationFilterData(this._filterData);
    actor.attachShape(shape);
    this.scene.addActor(actor);
    P.destroy(geom);
    P.destroy(t);
    shape.release();

    const rb = new RigidBody(actor, false);
    this._bodies.set(rb.ptr, rb);
    return rb;
  }

  // Ground plane. `pose.pos.y` sets the height; `pose.quat`, if provided, is
  // used verbatim — otherwise we build a plane with normal = (0,1,0) via the
  // PhysX top-level helper (which internally composes the 90°-about-Z rotation
  // that turns PhysX's default +X-normal into a ground plane).
  createStaticPlane(pose: Pose): RigidBody {
    const P = this._P;
    let actor: any;
    if (pose.quat) {
      const geom = new P.PxPlaneGeometry();
      const t = this._buildTransform(pose);
      actor = this.physics.createRigidStatic(t);
      const shape = this.physics.createShape(geom, this.material, true, this._shapeFlags);
      shape.setSimulationFilterData(this._filterData);
      actor.attachShape(shape);
      P.destroy(geom);
      P.destroy(t);
      shape.release();
    } else {
      const plane = new P.PxPlane(0, 1, 0, -pose.pos.y);
      actor = this._topLevel.CreatePlane(this.physics, plane, this.material);
      // CreatePlane auto-creates a shape on the actor. Retrieve it via
      // SupportFunctions (there's no exposed PxArray_PxShapePtr helper) and
      // stamp the collide-with-everything filter data onto it.
      const autoShape = this._support.PxActor_getShape(actor, 0);
      autoShape.setSimulationFilterData(this._filterData);
      P.destroy(plane);
    }
    this.scene.addActor(actor);

    const rb = new RigidBody(actor, false);
    this._bodies.set(rb.ptr, rb);
    return rb;
  }

  addImpulse(body: RigidBody, impulse: Vec3Like): void {
    if (!body.isDynamic) return;
    this._scratchVec.set_x(impulse.x);
    this._scratchVec.set_y(impulse.y);
    this._scratchVec.set_z(impulse.z);
    body.actor.addForce(this._scratchVec, this._impulseMode, true);
  }

  raycast(origin: Vec3Like, direction: Vec3Like, maxDistance: number): RaycastHit | null {
    this._scratchOrigin.set_x(origin.x);
    this._scratchOrigin.set_y(origin.y);
    this._scratchOrigin.set_z(origin.z);
    const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
    this._scratchDir.set_x(direction.x / len);
    this._scratchDir.set_y(direction.y / len);
    this._scratchDir.set_z(direction.z / len);
    const ok = this.scene.raycast(this._scratchOrigin, this._scratchDir, maxDistance, this._raycastResult);
    if (!ok) return null;
    const n = this._raycastResult.getNbAnyHits();
    if (!n) return null;
    let best = this._raycastResult.getAnyHit(0);
    for (let i = 1; i < n; i++) {
      const h = this._raycastResult.getAnyHit(i);
      if (h.distance < best.distance) best = h;
    }
    const body = this._bodies.get(best.actor.ptr);
    if (!body) return null;
    return {
      body,
      distance: best.distance,
      position: { x: best.position.x, y: best.position.y, z: best.position.z },
      normal: { x: best.normal.x, y: best.normal.y, z: best.normal.z },
    };
  }

  // Advances the simulation by one fixed timestep and captures pose into the
  // "next" slot for every active actor. Inactive actors keep their previous
  // pose, which is what we want — they aren't moving.
  step(): void {
    for (const fn of this._preStepListeners) fn(this.fixedDt);
    this.scene.simulate(this.fixedDt);
    this.scene.fetchResults(true);

    for (const rb of this._bodies.values()) rb.isActive = false;
    if (this._hasBatch) {
      this._stepCaptureBatch();
    } else {
      this._stepCaptureStock();
    }
  }

  // Register a pre-step callback that runs before scene.simulate each tick.
  // Vehicle2 needs this because vehicle.step() writes velocities directly onto
  // the chassis actor that the following scene.simulate then integrates.
  onPreStep(fn: (dt: number) => void): void {
    this._preStepListeners.push(fn);
  }
  offPreStep(fn: (dt: number) => void): void {
    const i = this._preStepListeners.indexOf(fn);
    if (i >= 0) this._preStepListeners.splice(i, 1);
  }

  // PhysX Vehicle 2 needs a one-time global init that hooks the scene's
  // simulation callbacks. Safe to call repeatedly — guarded internally.
  initVehicleExtension(): void {
    if (this._vehicleExtInited) return;
    if (!this._vehicleTopLevel?.InitVehicleExtension) {
      throw new Error('PxVehicleTopLevelFunctions not available in this binding');
    }
    this._vehicleTopLevel.InitVehicleExtension(this._foundation);
    this._vehicleExtInited = true;
  }

  // Register an externally-created PxRigidActor (e.g. the vehicle's chassis
  // that was created by EngineDriveVehicle.initialize) so it participates in
  // batch pose capture + interpolation like any other body.
  registerActor(actor: any, isDynamic: boolean): RigidBody {
    const rb = new RigidBody(actor, isDynamic);
    this._bodies.set(rb.ptr, rb);
    return rb;
  }

  private _stepCaptureStock(): void {
    const active = this._support.PxScene_getActiveActors(this.scene);
    const n = active.size();
    for (let i = 0; i < n; i++) {
      const actor = active.get(i);
      const rb = this._bodies.get(actor.ptr);
      if (rb) {
        rb.isActive = true;
        rb._capturePose();
      }
    }
  }

  private _stepCaptureBatch(): void {
    this._ensureSlab(this._bodies.size);
    const count = this._support.PxScene_writeActiveTransforms(
      this.scene, this._slabPtr, this._slabCapSlots,
    );
    // HEAPF32 / HEAPU32 views are rebuilt by emscripten whenever wasm memory
    // grows. Re-read them every step to be safe — a big addActor burst that
    // triggers heap growth would invalidate stale captures otherwise.
    const f32 = this._P.HEAPF32;
    const u32 = this._P.HEAPU32;
    const base0 = this._slabPtr >>> 2;
    for (let i = 0; i < count; i++) {
      const base = base0 + i * Physics._BATCH_STRIDE;
      const rb = this._bodies.get(u32[base + 0]);
      if (!rb) continue;
      rb.isActive = true;
      rb._capturePoseFromSlab(
        f32[base + 1], f32[base + 2], f32[base + 3],
        f32[base + 4], f32[base + 5], f32[base + 6], f32[base + 7],
      );
    }
  }

  private _ensureSlab(requiredSlots: number): void {
    if (requiredSlots <= this._slabCapSlots) return;
    if (this._slabPtr) this._P._free(this._slabPtr);
    // Grow geometrically (×2) with a floor so churn on add/remove doesn't
    // re-allocate every frame.
    const slots = Math.max(requiredSlots, this._slabCapSlots * 2, 64);
    this._slabPtr = this._P._malloc(slots * Physics._BATCH_STRIDE * 4);
    this._slabCapSlots = slots;
  }

  get batchPathActive(): boolean { return this._hasBatch; }
  get foundation(): any { return this._foundation; }
  get filterData(): any { return this._filterData; }

  // alpha ∈ [0,1]: how far we are between the last two physics ticks.
  interpolate(alpha: number): void {
    for (const rb of this._bodies.values()) {
      if (rb.isActive) rb._applyInterp(alpha);
      else rb._snapMeshToLatest();
    }
  }

  get bodyCount(): number { return this._bodies.size; }
  get activeCount(): number {
    let c = 0;
    for (const rb of this._bodies.values()) if (rb.isActive) c++;
    return c;
  }

  forEachBody(fn: (body: RigidBody) => void): void {
    for (const rb of this._bodies.values()) fn(rb);
  }

  release(): void {
    if (this._released) return;
    this._released = true;
    const P = this._P;
    if (this._vehicleExtInited && this._vehicleTopLevel?.CloseVehicleExtension) {
      this._vehicleTopLevel.CloseVehicleExtension();
      this._vehicleExtInited = false;
    }
    for (const rb of this._bodies.values()) {
      this.scene.removeActor(rb.actor);
      rb.actor.release();
    }
    this._bodies.clear();
    if (this._slabPtr) {
      P._free(this._slabPtr);
      this._slabPtr = 0;
      this._slabCapSlots = 0;
    }
    P.destroy(this._raycastResult);
    P.destroy(this._scratchVec);
    P.destroy(this._scratchOrigin);
    P.destroy(this._scratchDir);
    P.destroy(this._scratchPoseVec);
    P.destroy(this._scratchPoseQuat);
    this.scene.release();
    this.material.release();
    this.physics.release();
    this._foundation.release();
    P.destroy(this._filterData);
    P.destroy(this._shapeFlags);
    P.destroy(this.cookingParams);
    P.destroy(this._sceneDesc);
    P.destroy(this._tolerances);
    P.destroy(this._errorCb);
    P.destroy(this._allocator);
  }

  // Some embind getters for struct members return a fresh wrapper whose
  // ptr is stack-temp memory — mutating .x/.y/.z on it is silently lost.
  // Writing into dedicated PxVec3/PxQuat scratch objects and then calling
  // set_p/set_q is the reliable path and what fabmax's kool uses.
  private _buildTransform(pose: Pose): any {
    const P = this._P;
    const t = new P.PxTransform(P.PxIDENTITYEnum.PxIdentity);
    this._scratchPoseVec.set_x(pose.pos.x);
    this._scratchPoseVec.set_y(pose.pos.y);
    this._scratchPoseVec.set_z(pose.pos.z);
    t.set_p(this._scratchPoseVec);
    if (pose.quat) {
      this._scratchPoseQuat.set_x(pose.quat.x);
      this._scratchPoseQuat.set_y(pose.quat.y);
      this._scratchPoseQuat.set_z(pose.quat.z);
      this._scratchPoseQuat.set_w(pose.quat.w);
      t.set_q(this._scratchPoseQuat);
    }
    return t;
  }
}
