// Barrel Hop — reusable 2D platformer core.
//
// Deliberately framework-free and DOM-light so future jump-games can reuse it:
//   - fixed-timestep loop with render interpolation (stable physics on a 60Hz
//     laptop even when frames drop)
//   - an AABB body with gravity, variable-height jumping, coyote time and jump
//     buffering (forgiving timing for little kids)
//   - per-axis swept-free AABB collision against a list of solids
//
// World units are pixels in a virtual space; the renderer scales them to fit.

export interface Solid {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional game object backing this solid (e.g. a Barrel). */
  ref?: unknown;
}

export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  grounded: boolean;
  // Previous integrated position, for render interpolation.
  prevX: number;
  prevY: number;
  // Forgiveness timers (seconds) — owned by the body, advanced by stepBody.
  coyote: number;
  buffer: number;
  jumpHold: number;
  jumping: boolean;
}

export interface MoveInput {
  left: boolean;
  right: boolean;
  jumpHeld: boolean;
  /** True only on the frame the jump key first went down. */
  jumpPressed: boolean;
}

export interface Tuning {
  gravity: number;
  jumpVelocity: number;
  /** Gravity multiplier while ascending and holding jump (lower = floatier). */
  ascendHoldFactor: number;
  /** vy is multiplied by this when jump is released early (short hop). */
  jumpCutFactor: number;
  maxSpeed: number;
  groundAccel: number;
  airAccel: number;
  groundFriction: number;
  airFriction: number;
  terminalVy: number;
  coyoteTime: number;
  jumpBuffer: number;
  /** Max seconds the hold can keep gravity reduced (caps jump height). */
  maxJumpHold: number;
}

// Tuned to be generous and kid-friendly: a tap is a small hop, a long hold is a
// big floaty jump, and timing windows are forgiving.
export const DEFAULT_TUNING: Tuning = {
  gravity: 2300,
  jumpVelocity: -820,
  ascendHoldFactor: 0.5,
  jumpCutFactor: 0.55,
  maxSpeed: 300,
  groundAccel: 2600,
  airAccel: 2000,
  groundFriction: 2800,
  airFriction: 600,
  terminalVy: 1300,
  coyoteTime: 0.1,
  jumpBuffer: 0.13,
  maxJumpHold: 0.32,
};

export interface StepResult {
  /** Became grounded this step (a real landing, not standing). */
  landed: boolean;
  startedJump: boolean;
  /** Solid the feet rested on this step (set every grounded frame). */
  landedOn: Solid | null;
  /** Solids hit horizontally this step. */
  wallHits: Solid[];
  ceilingHit: Solid | null;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function makeBody(x: number, y: number, w: number, h: number): Body {
  return {
    x,
    y,
    w,
    h,
    vx: 0,
    vy: 0,
    grounded: false,
    prevX: x,
    prevY: y,
    coyote: 0,
    buffer: 0,
    jumpHold: 0,
    jumping: false,
  };
}

function overlaps(b: Body, s: Solid): boolean {
  return b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y;
}

/**
 * Advance one body by `dt` seconds against `solids`, resolving collisions per
 * axis. Mutates `body` and returns what happened (for scoring / sfx).
 */
export function stepBody(
  body: Body,
  solids: Solid[],
  input: MoveInput,
  tuning: Tuning,
  dt: number,
): StepResult {
  const res: StepResult = {
    landed: false,
    startedJump: false,
    landedOn: null,
    wallHits: [],
    ceilingHit: null,
  };

  body.prevX = body.x;
  body.prevY = body.y;

  // Forgiveness timers.
  body.coyote = body.grounded ? tuning.coyoteTime : Math.max(0, body.coyote - dt);
  body.buffer = input.jumpPressed ? tuning.jumpBuffer : Math.max(0, body.buffer - dt);

  // Horizontal acceleration + friction.
  const dir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  if (dir !== 0) {
    const accel = body.grounded ? tuning.groundAccel : tuning.airAccel;
    body.vx = clamp(body.vx + dir * accel * dt, -tuning.maxSpeed, tuning.maxSpeed);
  } else {
    const friction = (body.grounded ? tuning.groundFriction : tuning.airFriction) * dt;
    if (body.vx > 0) body.vx = Math.max(0, body.vx - friction);
    else if (body.vx < 0) body.vx = Math.min(0, body.vx + friction);
  }

  // Start a jump (buffered press + on ground or within coyote window).
  if (body.buffer > 0 && body.coyote > 0) {
    body.vy = tuning.jumpVelocity;
    body.buffer = 0;
    body.coyote = 0;
    body.grounded = false;
    body.jumping = true;
    body.jumpHold = 0;
    res.startedJump = true;
  }

  // Variable jump height: reduced gravity while rising and holding.
  let g = tuning.gravity;
  if (body.jumping && input.jumpHeld && body.vy < 0 && body.jumpHold < tuning.maxJumpHold) {
    g *= tuning.ascendHoldFactor;
    body.jumpHold += dt;
  }
  // Early release => cut the rise short.
  if (body.jumping && !input.jumpHeld && body.vy < 0) {
    body.vy *= tuning.jumpCutFactor;
    body.jumping = false;
  }
  if (body.vy >= 0) body.jumping = false;

  body.vy = Math.min(tuning.terminalVy, body.vy + g * dt);

  // Integrate + resolve X.
  body.x += body.vx * dt;
  for (const s of solids) {
    if (!overlaps(body, s)) continue;
    if (body.vx > 0) {
      body.x = s.x - body.w;
      body.vx = 0;
      res.wallHits.push(s);
    } else if (body.vx < 0) {
      body.x = s.x + s.w;
      body.vx = 0;
      res.wallHits.push(s);
    }
  }

  // Integrate + resolve Y.
  const wasGrounded = body.grounded;
  body.grounded = false;
  body.y += body.vy * dt;
  for (const s of solids) {
    if (!overlaps(body, s)) continue;
    if (body.vy > 0) {
      body.y = s.y - body.h;
      body.vy = 0;
      body.grounded = true;
      res.landedOn = s;
    } else if (body.vy < 0) {
      body.y = s.y + s.h;
      body.vy = 0;
      res.ceilingHit = s;
    }
  }
  if (body.grounded && !wasGrounded) res.landed = true;

  return res;
}

export interface Loop {
  start(): void;
  stop(): void;
  running(): boolean;
}

/**
 * Fixed-timestep game loop. `update(dt)` runs a whole number of times per frame
 * at a constant dt; `render(alpha)` runs once with the interpolation fraction in
 * [0,1). Decoupling physics from frame rate keeps the feel identical on a 60Hz
 * laptop and a 144Hz monitor and survives the occasional dropped frame.
 */
export function createLoop(
  update: (dt: number) => void,
  render: (alpha: number) => void,
  dt = 1 / 60,
): Loop {
  let rafId = 0;
  let active = false;
  let last = 0;
  let acc = 0;

  function frame(now: number): void {
    if (!active) return;
    if (!last) last = now;
    let delta = (now - last) / 1000;
    last = now;
    if (delta > 0.1) delta = 0.1; // avoid the spiral of death after a stall
    acc += delta;
    let steps = 0;
    while (acc >= dt && steps < 5) {
      update(dt);
      acc -= dt;
      steps++;
    }
    render(clamp(acc / dt, 0, 1));
    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (active) return;
      active = true;
      last = 0;
      acc = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    running() {
      return active;
    },
  };
}
