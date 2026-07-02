// Barrel Hop — shared game types.
// The physics primitives (Body, Solid, Tuning) live in core.ts; this file holds
// the higher-level, game-specific shapes (levels, modes, particles).

export type ModeId = 'practice' | 'easy' | 'hard' | 'buddy' | 'wedding';

/** A solid the player can stand on / bump into. `kind` drives gameplay meaning. */
export interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'ground' | 'float';
}

/** A barrel — either jumped OVER (easy) or landed ON (hard). Always solid. */
export interface Barrel {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Checkpoint {
  x: number;
  /** Top-left y the player body should spawn at (sits on a surface). */
  y: number;
}

/** A fully built course for one mode + level number. */
export interface Level {
  width: number;
  startX: number;
  startY: number;
  goalX: number;
  /** Left-side goal flag (buddy mode does laps between the two flags). */
  leftGoalX?: number;
  /** Wedding-mode partner, placed just past the right-side flag. */
  partnerX?: number;
  partnerY?: number;
  platforms: Platform[];
  barrels: Barrel[];
  checkpoints: Checkpoint[];
  /** y below which the player has fallen into a pit (hard mode). */
  killY: number;
}

/** Static, data-driven description of a play mode. */
export interface ModeConfig {
  id: ModeId;
  name: string;
  emoji: string;
  /** One-line spoken + shown intro. */
  intro: string;
  /** Practice cannot fail (no hearts lost, no pits). */
  canFail: boolean;
  /** How barrels score: 'over' = clearing them, 'on' = landing on top. */
  scoreBy: 'over' | 'on' | 'either';
  /** If set, this is a Buddy-mode lap challenge: collect this many buddies. */
  buddies?: number;
  /** If true, this mode creates unlimited mini buddies at the partner. */
  wedding?: boolean;
  /** Build the course for a given 1-based level number. */
  build: (levelNum: number) => Level;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'dust' | 'spark' | 'croissant';
  angle?: number;
  spin?: number;
}
