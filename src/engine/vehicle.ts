import type { Physics, RigidBody, Vec3Like, QuatLike, Pose } from './physics';

// PhysX Vehicle 2 port of fabmax/kool's Vehicle.web.kt, trimmed for a 4-wheel
// engine-driven vehicle. Uses the raycast road-geometry query (not sweep), so
// no unit-cylinder cook is needed.
//
// Coordinate convention (matches kool):
//   +Z = forward, +X = right (lateral), +Y = up (vertical).

export interface VehicleProps {
  chassisMass: number;
  chassisDims: Vec3Like;                  // full width/height/length of chassis box
  wheelMass: number;
  wheelRadius: number;
  wheelWidth: number;
  wheelPosFront: number;                  // +Z offset of front axle from chassis center
  wheelPosRear: number;                   // -Z offset of rear axle
  trackWidthFront: number;
  trackWidthRear: number;
  wheelCenterHeightOffset: number;        // Y offset of wheel center from chassis origin
  maxSteerAngleDeg: number;
  maxBrakeTorque: number;
  brakeTorqueFrontFactor: number;
  brakeTorqueRearFactor: number;
  maxHandBrakeTorque: number;
  maxCompression: number;
  maxDroop: number;
  springStrength: number;
  springDamperRate: number;
  peakEngineTorque: number;
  peakEngineRpm: number;
  gearFinalRatio: number;
  clutchStrength: number;
  frontAntiRollBarStiffness: number;
  rearAntiRollBarStiffness: number;
}

// Pickup-truck defaults: heavier than a sedan, longer wheelbase, softer springs
// for a trucky bounce, more torque.
export const DEFAULT_VEHICLE_PROPS: VehicleProps = {
  chassisMass: 1800,
  chassisDims: { x: 1.9, y: 1.0, z: 4.6 },
  wheelMass: 25,
  wheelRadius: 0.45,
  wheelWidth: 0.35,
  wheelPosFront: 1.55,
  wheelPosRear: -1.55,
  trackWidthFront: 1.7,
  trackWidthRear: 1.7,
  wheelCenterHeightOffset: -0.4,
  maxSteerAngleDeg: 32,
  maxBrakeTorque: 6000,
  brakeTorqueFrontFactor: 0.65,
  brakeTorqueRearFactor: 0.35,
  maxHandBrakeTorque: 6000,
  maxCompression: 0.3,
  maxDroop: 0.3,
  springStrength: 28000,
  springDamperRate: 4200,
  peakEngineTorque: 1200,
  peakEngineRpm: 5500,
  gearFinalRatio: 4,
  clutchStrength: 50,
  frontAntiRollBarStiffness: 8000,
  rearAntiRollBarStiffness: 8000,
};

const FRONT_LEFT = 0;
const FRONT_RIGHT = 1;
const REAR_LEFT = 2;
const REAR_RIGHT = 3;

// Omega (rad/s) → RPM
const OMEGA_TO_RPM = 60 / (2 * Math.PI);

export class Vehicle {
  readonly chassis: RigidBody;
  readonly wheelLocalPoses: Pose[] = [
    { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } },
    { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } },
    { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } },
    { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } },
  ];

  readonly props: VehicleProps;
  private _physics: Physics;
  private _P: any;
  private _pxVehicle: any;
  private _simContext: any;
  private _preStepFn: (dt: number) => void;
  private _released = false;
  // Objects that PhysXIntegrationParams.create() may hold pointers into; must
  // outlive the vehicle. Destroyed in release().
  private _heldRefs: any[] = [];

  // Runtime inputs in normalized ranges.
  private _throttle = 0;
  private _steer = 0;
  private _brake = 0;
  private _reverse = false;

  // Cached state for UI/tests.
  private _forwardSpeed = 0;
  private _engineRpm = 0;

  static create(physics: Physics, pose: Pose, propsIn: Partial<VehicleProps> = {}): Vehicle {
    return new Vehicle(physics, pose, { ...DEFAULT_VEHICLE_PROPS, ...propsIn });
  }

  private constructor(physics: Physics, pose: Pose, props: VehicleProps) {
    this._physics = physics;
    this._P = physics.module;
    this.props = props;

    // Vehicle 2 needs a global init (once per foundation).
    physics.initVehicleExtension();

    const pxVehicle = new this._P.EngineDriveVehicle();
    this._pxVehicle = pxVehicle;

    const wheelOffsets = this._computeWheelOffsets();
    this._setupBaseParams(pxVehicle, wheelOffsets);
    this._setupPhysxParams(pxVehicle);
    this._setupEngineParams(pxVehicle);

    // addPhysXBeginEndComponents=true wires the scene's rigid-body transform
    // in/out into the vehicle's component sequence — without it, the vehicle
    // computes state internally but never actually moves the PxRigidDynamic.
    const ok = pxVehicle.initialize(
      physics.physics,
      physics.cookingParams,
      physics.material,
      this._P.EngineDriveVehicleEnum.eDIFFTYPE_FOURWHEELDRIVE,
      true,
    );
    if (!ok) throw new Error('EngineDriveVehicle.initialize() returned false');

    // EngineDriveVehicle.initialize creates the PxRigidDynamic but does NOT
    // add it to the scene — we have to do that ourselves, otherwise the
    // vehicle will happily write velocities into the actor each tick but
    // scene.simulate() won't integrate the pose.
    const actor = pxVehicle.physXState.physxActor.rigidBody;
    physics.scene.addActor(actor);

    // Attach pickup-bed wall colliders on top of the chassis box. Vehicle 2
    // only takes a single geometry in physXParams.create(), so we add the
    // walls directly onto the actor after initialization. Their combined mass
    // contribution is ignored — the chassis mass/MOI is set explicitly below.
    this._attachBedColliders(actor);

    const initPose = this._makeTransform(pose);
    actor.setGlobalPose(initPose, true);
    this._P.destroy(initPose);

    // Start in first forward gear with the automatic gearbox engaged.
    const gearBox = pxVehicle.engineDriveParams.gearBoxParams;
    const gearState = pxVehicle.engineDriveState.gearboxState;
    gearState.currentGear = gearBox.neutralGear + 1;
    gearState.targetGear = gearBox.neutralGear + 1;
    pxVehicle.transmissionCommandState.targetGear =
      this._P.PxVehicleEngineDriveTransmissionCommandStateEnum.eAUTOMATIC_GEAR;

    actor.setMass(props.chassisMass);

    // Per-vehicle simulation context ties the vehicle to our PxScene and tells
    // it to write velocities back onto the actor each tick.
    const ctx = new this._P.PxVehiclePhysXSimulationContext();
    ctx.setToDefault();
    ctx.frame.lngAxis = this._P.PxVehicleAxesEnum.ePosZ;
    ctx.frame.latAxis = this._P.PxVehicleAxesEnum.ePosX;
    ctx.frame.vrtAxis = this._P.PxVehicleAxesEnum.ePosY;
    ctx.scale.scale = 1;
    // Gravity matches the scene; Vehicle 2 stores its own copy.
    const g = new this._P.PxVec3(0, -9.81, 0);
    ctx.gravity = g;
    this._P.destroy(g);
    ctx.physxScene = physics.scene;
    ctx.physxActorUpdateMode = this._P.PxVehiclePhysXActorUpdateModeEnum.eAPPLY_ACCELERATION;
    this._simContext = ctx;

    // Wire chassis into our pose pipeline so the batch-readback + interp path
    // drives the chassis mesh automatically like any other dynamic body.
    this.chassis = physics.registerActor(actor, true);

    // Pump the vehicle once per physics tick, before scene.simulate().
    this._preStepFn = (dt) => this._step(dt);
    physics.onPreStep(this._preStepFn);
  }

  // ── Inputs ────────────────────────────────────────────────────────────────

  setThrottle(x: number): void { this._throttle = clamp(x, 0, 1); }
  setBrake(x: number): void { this._brake = clamp(x, 0, 1); }
  setSteer(x: number): void { this._steer = clamp(x, -1, 1); }
  setReverse(on: boolean): void { this._reverse = on; }

  // ── Read-only state ───────────────────────────────────────────────────────

  get forwardSpeed(): number { return this._forwardSpeed; }
  get engineRpm(): number { return this._engineRpm; }

  // ── Per-tick pump ─────────────────────────────────────────────────────────

  private _step(dt: number): void {
    if (this._released) return;
    const v = this._pxVehicle;

    // Write inputs into command state. PhysX Vehicle 2's steer command is
    // inverted relative to our "+1 = right" convention (matches kool's port).
    v.commandState.throttle = this._throttle;
    v.commandState.set_brakes(0, this._brake);
    v.commandState.nbBrakes = 1;
    v.commandState.steer = -this._steer;

    // Forward/reverse: toggle gearbox target between neutral-1 and automatic.
    const gearBox = v.engineDriveParams.gearBoxParams;
    const gState = v.engineDriveState.gearboxState;
    const neutral = gearBox.neutralGear;
    const autoGear = this._P.PxVehicleEngineDriveTransmissionCommandStateEnum.eAUTOMATIC_GEAR;
    if (this._reverse && gState.targetGear !== neutral - 1) {
      v.transmissionCommandState.targetGear = 0;
      gState.currentGear = neutral - 1;
      gState.targetGear = neutral - 1;
    } else if (!this._reverse && gState.targetGear === neutral - 1) {
      v.transmissionCommandState.targetGear = autoGear;
      gState.currentGear = neutral + 1;
      gState.targetGear = neutral + 1;
    }

    v.step(dt, this._simContext);

    // Read out wheel local poses for visual binding.
    for (let i = 0; i < 4; i++) {
      const wlp = v.baseState.get_wheelLocalPoses(i).localPose;
      const out = this.wheelLocalPoses[i];
      out.pos.x = wlp.p.x;
      out.pos.y = wlp.p.y;
      out.pos.z = wlp.p.z;
      out.quat!.x = wlp.q.x;
      out.quat!.y = wlp.q.y;
      out.quat!.z = wlp.q.z;
      out.quat!.w = wlp.q.w;
    }

    // Cache speed/RPM for external consumers (UI, tests).
    const actor = v.physXState.physxActor.rigidBody;
    const lv = actor.getLinearVelocity();
    const pose = actor.getGlobalPose();
    const fwdQ = pose.q;
    // Forward = rotated +Z axis. Quat-rotate (0,0,1) without building a matrix.
    const fx = 2 * (fwdQ.x * fwdQ.z + fwdQ.w * fwdQ.y);
    const fy = 2 * (fwdQ.y * fwdQ.z - fwdQ.w * fwdQ.x);
    const fz = 1 - 2 * (fwdQ.x * fwdQ.x + fwdQ.y * fwdQ.y);
    this._forwardSpeed = lv.x * fx + lv.y * fy + lv.z * fz;
    this._engineRpm = v.engineDriveState.engineState.rotationSpeed * OMEGA_TO_RPM;
  }

  release(): void {
    if (this._released) return;
    this._released = true;
    this._physics.offPreStep(this._preStepFn);
    this._P.destroy(this._pxVehicle);
    this._P.destroy(this._simContext);
    for (const ref of this._heldRefs) this._P.destroy(ref);
    this._heldRefs.length = 0;
  }

  // ── Setup helpers (direct port of kool's three setup* blocks) ─────────────

  private _computeWheelOffsets(): Vec3Like[] {
    const p = this.props;
    const twF = p.trackWidthFront * 0.5;
    const twR = p.trackWidthRear * 0.5;
    return [
      { x: twF, y: p.wheelCenterHeightOffset, z: p.wheelPosFront },   // FL
      { x: -twF, y: p.wheelCenterHeightOffset, z: p.wheelPosFront },  // FR
      { x: twR, y: p.wheelCenterHeightOffset, z: p.wheelPosRear },    // RL
      { x: -twR, y: p.wheelCenterHeightOffset, z: p.wheelPosRear },   // RR
    ];
  }

  private _setupBaseParams(v: any, wheelOffsets: Vec3Like[]): void {
    const P = this._P;
    const p = this.props;

    // Axle description: 2 axles, front axle owns wheels [0,1], rear owns [2,3].
    const axle = v.baseParams.axleDescription;
    axle.nbAxles = 2;
    axle.nbWheels = 4;
    axle.set_nbWheelsPerAxle(0, 2);
    axle.set_nbWheelsPerAxle(1, 2);
    axle.set_axleToWheelIds(0, 0);
    axle.set_axleToWheelIds(1, 2);
    for (let i = 0; i < 4; i++) axle.set_wheelIdsInAxleOrder(i, i);

    v.baseParams.frame.lngAxis = P.PxVehicleAxesEnum.ePosZ;
    v.baseParams.frame.latAxis = P.PxVehicleAxesEnum.ePosX;
    v.baseParams.frame.vrtAxis = P.PxVehicleAxesEnum.ePosY;
    v.baseParams.scale.scale = 1;

    // Chassis rigid body (mass + moment of inertia).
    const rbParams = v.baseParams.rigidBodyParams;
    rbParams.mass = p.chassisMass;
    const d = p.chassisDims;
    const moi = new P.PxVec3(
      ((d.y * d.y + d.z * d.z) * p.chassisMass) / 12.0,
      ((d.x * d.x + d.z * d.z) * p.chassisMass) / 12.0 * 0.8,
      ((d.x * d.x + d.y * d.y) * p.chassisMass) / 12.0,
    );
    rbParams.moi = moi;
    P.destroy(moi);

    // Brake response: normal brake (slot 0) + hand brake (slot 1).
    const normalBrake = v.baseParams.get_brakeResponseParams(0);
    const handBrake = v.baseParams.get_brakeResponseParams(1);
    normalBrake.nonlinearResponse.nbSpeedResponses = 0;
    normalBrake.nonlinearResponse.nbCommandValues = 0;
    normalBrake.maxResponse = p.maxBrakeTorque;
    handBrake.nonlinearResponse.nbSpeedResponses = 0;
    handBrake.nonlinearResponse.nbCommandValues = 0;
    handBrake.maxResponse = p.maxHandBrakeTorque;
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      normalBrake.set_wheelResponseMultipliers(
        i, isFront ? p.brakeTorqueFrontFactor : p.brakeTorqueRearFactor,
      );
      handBrake.set_wheelResponseMultipliers(i, isFront ? 0 : 1);
    }

    // Steering: only the front wheels receive steer input.
    const steer = v.baseParams.steerResponseParams;
    steer.maxResponse = (p.maxSteerAngleDeg * Math.PI) / 180;
    for (let i = 0; i < 4; i++) {
      steer.set_wheelResponseMultipliers(i, i < 2 ? 1 : 0);
    }

    // Ackermann geometry tying the two front wheels together.
    const ack = v.baseParams.get_ackermannParams(0);
    ack.set_wheelIds(0, 0);
    ack.set_wheelIds(1, 1);
    ack.wheelBase = Math.abs(p.wheelPosFront) + Math.abs(p.wheelPosRear);
    ack.trackWidth = p.trackWidthFront;
    ack.strength = 1;

    // Per-wheel params.
    for (let i = 0; i < 4; i++) {
      const w = v.baseParams.get_wheelParams(i);
      w.mass = p.wheelMass;
      w.moi = 0.5 * p.wheelMass * p.wheelRadius * p.wheelRadius;
      w.radius = p.wheelRadius;
      w.halfWidth = p.wheelWidth / 2;
      w.dampingRate = 0.25;
    }

    // Tires. Constants copied verbatim from kool's sedan tune — good enough
    // starting point for a demo; tune later if it feels off.
    for (let i = 0; i < 4; i++) {
      const tire = v.baseParams.get_tireForceParams(i);
      tire.longStiff = 25000;
      tire.latStiffX = 0.007;
      tire.latStiffY = 180000;
      tire.camberStiff = 0;
      tire.restLoad = 5500;
      P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, 0, 0, 0);
      P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, 0, 1, 1);
      P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, 1, 0, 0.1);
      P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, 1, 1, 1);
      P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, 2, 0, 1);
      P.PxVehicleTireForceParamsExt.prototype.setFrictionVsSlip(tire, 2, 1, 1);
      P.PxVehicleTireForceParamsExt.prototype.setLoadFilter(tire, 0, 0, 0);
      P.PxVehicleTireForceParamsExt.prototype.setLoadFilter(tire, 0, 1, 0.23);
      P.PxVehicleTireForceParamsExt.prototype.setLoadFilter(tire, 1, 0, 3);
      P.PxVehicleTireForceParamsExt.prototype.setLoadFilter(tire, 1, 1, 3);
    }

    // Suspensions. Sprung masses are distributed via PxVehicle helper based
    // on wheel world offsets + chassis total mass.
    v.baseParams.suspensionStateCalculationParams.suspensionJounceCalculationType =
      P.PxVehicleSuspensionJounceCalculationTypeEnum.eSWEEP;
    v.baseParams.suspensionStateCalculationParams.limitSuspensionExpansionVelocity = false;

    const pxOffsets = new P.PxArray_PxVec3(4);
    for (let i = 0; i < 4; i++) {
      const v3 = new P.PxVec3(wheelOffsets[i].x, wheelOffsets[i].y, wheelOffsets[i].z);
      pxOffsets.set(i, v3);
      P.destroy(v3);
    }
    const sprungMasses = new P.PxArray_PxReal(4);
    P.PxVehicleTopLevelFunctions.prototype.VehicleComputeSprungMasses(
      4, pxOffsets, p.chassisMass, P.PxVehicleAxesEnum.eNegY, sprungMasses,
    );

    const travelDir = new P.PxVec3(0, -1, 0);
    const forceAppPoint = new P.PxVec3(0, 0, -0.2);
    const zero = new P.PxVec3(0, 0, 0);
    const identQ = new P.PxQuat(P.PxIDENTITYEnum.PxIdentity);
    for (let i = 0; i < 4; i++) {
      const susp = v.baseParams.get_suspensionParams(i);
      const suspForce = v.baseParams.get_suspensionForceParams(i);
      const suspComp = v.baseParams.get_suspensionComplianceParams(i);

      const attachPos = new P.PxVec3(wheelOffsets[i].x, wheelOffsets[i].y, wheelOffsets[i].z);
      // PxVehicleSuspensionParams() default-constructs its transform fields
      // to zero — including the quats — which leaves the tire's rolling axis
      // undefined and makes lateral tire forces apply in a garbage direction
      // (no chassis yaw torque, even with visible steer on the wheels).
      // Explicitly set both .q's to identity, matching kool's Kotlin port.
      susp.suspensionAttachment.p = attachPos;
      susp.suspensionAttachment.q = identQ;
      susp.suspensionTravelDir = travelDir;
      susp.suspensionTravelDist = p.maxCompression + p.maxDroop;
      susp.wheelAttachment.p = zero;
      susp.wheelAttachment.q = identQ;
      P.destroy(attachPos);

      suspForce.damping = p.springDamperRate;
      suspForce.stiffness = p.springStrength;
      suspForce.sprungMass = sprungMasses.get(i);

      suspComp.wheelToeAngle.addPair(0, 0);
      suspComp.wheelCamberAngle.addPair(0, 0);
      suspComp.suspForceAppPoint.addPair(0, forceAppPoint);
      suspComp.tireForceAppPoint.addPair(0, forceAppPoint);
    }
    P.destroy(travelDir);
    P.destroy(forceAppPoint);
    P.destroy(zero);
    P.destroy(identQ);
    P.destroy(sprungMasses);
    P.destroy(pxOffsets);

    // Anti-roll bars front + rear.
    let antiRollIdx = 0;
    if (p.frontAntiRollBarStiffness > 0) {
      const bar = v.baseParams.get_antiRollForceParams(antiRollIdx++);
      bar.wheel0 = FRONT_LEFT;
      bar.wheel1 = FRONT_RIGHT;
      bar.stiffness = p.frontAntiRollBarStiffness;
    }
    if (p.rearAntiRollBarStiffness > 0) {
      const bar = v.baseParams.get_antiRollForceParams(antiRollIdx++);
      bar.wheel0 = REAR_LEFT;
      bar.wheel1 = REAR_RIGHT;
      bar.stiffness = p.rearAntiRollBarStiffness;
    }
    v.baseParams.nbAntiRollForceParams = antiRollIdx;
  }

  private _setupPhysxParams(v: any): void {
    const P = this._P;
    const p = this.props;

    // Raycast-only road queries — skips the cook of a unit cylinder.
    const roadQueryFlags = new P.PxQueryFlags(P.PxQueryFlagEnum.eSTATIC);
    const roadFilterData = new P.PxFilterData(0, 0, 0, 0);
    const roadQueryFilter = new P.PxQueryFilterData(roadFilterData, roadQueryFlags);

    const cm = new P.PxTransform(P.PxIDENTITYEnum.PxIdentity);
    const shapeLocal = new P.PxTransform(P.PxIDENTITYEnum.PxIdentity);

    // Chassis shape flags: collide as a normal shape, participate in queries.
    v.physXParams.physxActorShapeFlags.raise(P.PxShapeFlagEnum.eSIMULATION_SHAPE);
    v.physXParams.physxActorShapeFlags.raise(P.PxShapeFlagEnum.eSCENE_QUERY_SHAPE);

    // Collide chassis with everything using the same (1,1) bitmask that the
    // rest of our bodies use.
    const chassisFilter = new P.PxFilterData(1, 1, 0, 0);
    this._copyFilterData(chassisFilter, v.physXParams.physxActorSimulationFilterData);
    this._copyFilterData(chassisFilter, v.physXParams.physxActorQueryFilterData);
    this._copyFilterData(chassisFilter, v.physXParams.physxActorWheelSimulationFilterData);
    this._copyFilterData(chassisFilter, v.physXParams.physxActorWheelQueryFilterData);

    const chassisGeom = new P.PxBoxGeometry(p.chassisDims.x / 2, p.chassisDims.y / 2, p.chassisDims.z / 2);
    const materialFriction = new P.PxVehiclePhysXMaterialFriction();
    materialFriction.friction = 1.5;
    materialFriction.material = this._physics.material;

    v.physXParams.create(
      v.baseParams.axleDescription,
      roadQueryFilter,
      null,
      materialFriction,
      1,
      1.5,
      cm,
      chassisGeom,
      shapeLocal,
      P.PxVehiclePhysXRoadGeometryQueryTypeEnum.eRAYCAST,
    );

    // PhysXIntegrationParams.create() stores pointers into these — they must
    // outlive the vehicle (or at least outlive pxVehicle.initialize()).
    // Destroying chassisGeom here was producing "Gu::computeBounds: Unknown
    // shape type" crashes once scene.addActor processed the chassis shape.
    this._heldRefs.push(
      materialFriction, chassisGeom, chassisFilter, shapeLocal, cm,
      roadQueryFilter, roadFilterData, roadQueryFlags,
    );
  }

  private _setupEngineParams(v: any): void {
    const P = this._P;
    const p = this.props;

    // Autobox: when/how to shift up or down.
    const autobox = v.engineDriveParams.autoboxParams;
    for (let i = 0; i < 8; i++) {
      autobox.set_upRatios(i, 0.9);
      autobox.set_downRatios(i, 0.5);
    }
    autobox.set_upRatios(1, 0.15); // lower bar for leaving neutral
    autobox.latency = 0.7;

    v.engineDriveParams.clutchCommandResponseParams.maxResponse = p.clutchStrength;
    v.engineDriveParams.clutchParams.accuracyMode =
      P.PxVehicleClutchAccuracyModeEnum.eBEST_POSSIBLE;
    v.engineDriveParams.clutchParams.estimateIterations = 5;

    // Engine torque curve (x = rpmNorm, y = torqueMultiplier).
    const eng = v.engineDriveParams.engineParams;
    eng.torqueCurve.addPair(0.0, 0.3);
    eng.torqueCurve.addPair(0.33, 0.85);
    eng.torqueCurve.addPair(0.8, 1.0);
    eng.torqueCurve.addPair(0.9, 0.8);
    eng.torqueCurve.addPair(1.0, 0.5);
    eng.moi = 1.0;
    eng.peakTorque = p.peakEngineTorque;
    eng.idleOmega = 0;
    eng.maxOmega = p.peakEngineRpm / OMEGA_TO_RPM;
    eng.dampingRateFullThrottle = 0.15;
    eng.dampingRateZeroThrottleClutchEngaged = 2.0;
    eng.dampingRateZeroThrottleClutchDisengaged = 0.35;

    // Gearbox: 1 reverse + neutral + 6 forward.
    const gb = v.engineDriveParams.gearBoxParams;
    gb.neutralGear = 1;
    gb.set_ratios(0, -4);
    gb.set_ratios(1, 0);
    gb.set_ratios(2, 4);
    gb.set_ratios(3, 2);
    gb.set_ratios(4, 1.5);
    gb.set_ratios(5, 1.1);
    gb.set_ratios(6, 0.95);
    gb.set_ratios(7, 0.85);
    gb.nbRatios = 8;
    gb.finalRatio = p.gearFinalRatio;
    gb.switchTime = 0.35;

    // 4WD differential bias. Torque split 30/70 front/rear for a truck feel.
    const fourWD = v.engineDriveParams.fourWheelDifferentialParams;
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      fourWD.set_torqueRatios(i, isFront ? 0.15 : 0.35);
      fourWD.set_aveWheelSpeedRatios(i, 0.25);
    }
    fourWD.set_frontWheelIds(0, 0);
    fourWD.set_frontWheelIds(1, 1);
    fourWD.set_rearWheelIds(0, 2);
    fourWD.set_rearWheelIds(1, 3);
    fourWD.centerBias = 1.3;
    fourWD.centerTarget = 1.29;
    fourWD.frontBias = 1.3;
    fourWD.frontTarget = 1.29;
    fourWD.rearBias = 1.3;
    fourWD.rearTarget = 1.29;
    fourWD.rate = 10;

    // Fill in the other differential types too (diff switching works but not
    // used here — leaving them at defaults causes an isValid() failure).
    for (let i = 0; i < 4; i++) {
      v.engineDriveParams.multiWheelDifferentialParams.set_torqueRatios(i, 0.25);
      v.engineDriveParams.multiWheelDifferentialParams.set_aveWheelSpeedRatios(i, 0.25);
      v.engineDriveParams.tankDifferentialParams.set_torqueRatios(i, 0.25);
      v.engineDriveParams.tankDifferentialParams.set_aveWheelSpeedRatios(i, 0.25);
    }
  }

  // Attach 3 thin boxes (two sides + tailgate) above the chassis to form an
  // open cargo bed. Dimensions are derived from chassisDims so a wider or
  // longer chassis gets proportionally sized walls. The mesh-side walls in
  // the demo's buildTruckMesh must be kept in sync with these positions.
  private _attachBedColliders(actor: any): void {
    const P = this._P;
    const d = this.props.chassisDims;
    const wallThickness = 0.08;
    const wallHeight = 0.5;
    const halfH = wallHeight / 2;
    const halfLen = d.z * 0.2;                  // bed runs 40% of chassis length
    const centerZ = -d.z * 0.3;                 // centered on rear half
    const sideX = d.x / 2 - wallThickness;
    const wallY = d.y / 2 + halfH;              // sit on top of chassis box

    const shapeFlags = new P.PxShapeFlags(
      P.PxShapeFlagEnum.eSIMULATION_SHAPE | P.PxShapeFlagEnum.eSCENE_QUERY_SHAPE,
    );
    const filterData = new P.PxFilterData(1, 1, 0, 0);

    const addWall = (halfX: number, halfY: number, halfZ: number, lx: number, ly: number, lz: number): void => {
      const geom = new P.PxBoxGeometry(halfX, halfY, halfZ);
      const shape = this._physics.physics.createShape(geom, this._physics.material, true, shapeFlags);
      shape.setSimulationFilterData(filterData);
      const t = new P.PxTransform(P.PxIDENTITYEnum.PxIdentity);
      const v = new P.PxVec3(lx, ly, lz);
      t.p = v;
      shape.setLocalPose(t);
      actor.attachShape(shape);
      shape.release();
      P.destroy(geom);
      P.destroy(v);
      P.destroy(t);
    };

    addWall(wallThickness, halfH, halfLen, sideX, wallY, centerZ);   // right
    addWall(wallThickness, halfH, halfLen, -sideX, wallY, centerZ);  // left
    addWall(d.x / 2, halfH, wallThickness, 0, wallY, centerZ - halfLen); // tail

    P.destroy(shapeFlags);
    P.destroy(filterData);
  }

  private _makeTransform(pose: Pose): any {
    const P = this._P;
    const t = new P.PxTransform(P.PxIDENTITYEnum.PxIdentity);
    const v = new P.PxVec3(pose.pos.x, pose.pos.y, pose.pos.z);
    t.p = v;
    if (pose.quat) {
      const q = new P.PxQuat(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);
      t.q = q;
      P.destroy(q);
    }
    P.destroy(v);
    return t;
  }

  private _copyFilterData(src: any, dst: any): void {
    dst.word0 = src.word0;
    dst.word1 = src.word1;
    dst.word2 = src.word2;
    dst.word3 = src.word3;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export type { Vec3Like, QuatLike, Pose };
