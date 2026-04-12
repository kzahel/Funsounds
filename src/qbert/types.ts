export const enum Direction {
  UP_LEFT,
  UP_RIGHT,
  DOWN_LEFT,
  DOWN_RIGHT,
}

/** Row/col deltas for each direction on the pyramid grid. */
export const DIR_DELTA: Record<Direction, [dRow: number, dCol: number]> = {
  [Direction.UP_LEFT]: [-1, -1],
  [Direction.UP_RIGHT]: [-1, 0],
  [Direction.DOWN_LEFT]: [1, 0],
  [Direction.DOWN_RIGHT]: [1, 1],
};

export type EnemyType = 'coily_ball' | 'coily' | 'red_ball' | 'slick' | 'sam';

export interface HopState {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  startTime: number;
  duration: number;
}

export interface PlayerState {
  row: number;
  col: number;
  hop: HopState | null;
  alive: boolean;
  ridingDisc: boolean;
}

export interface EnemyState {
  id: number;
  type: EnemyType;
  row: number;
  col: number;
  hop: HopState | null;
}

export interface DiscState {
  row: number;
  side: 'left' | 'right';
  used: boolean;
}

export interface CubeState {
  row: number;
  col: number;
  colorIndex: number;
}

export interface EnemyWave {
  type: EnemyType;
  spawnAfterMs: number;
  count: number;
  intervalMs: number;
}

export interface LevelDef {
  number: number;
  pyramidRows: number;
  numColors: number;
  targetColorIndex: number;
  revertsOnExtra: boolean;
  discs: { row: number; side: 'left' | 'right' }[];
  enemyWaves: EnemyWave[];
  enemyTickMs: number;
  hopDurationMs: number;
}

export type GamePhase = 'playing' | 'dying' | 'level_complete' | 'game_over';

export interface GameState {
  level: LevelDef;
  cubes: CubeState[];
  player: PlayerState;
  enemies: EnemyState[];
  discs: DiscState[];
  score: number;
  lives: number;
  phase: GamePhase;
  nextEnemyId: number;
  freezeUntil: number;
}

export type Action =
  | { type: 'move'; direction: Direction; time: number }
  | { type: 'enemy_tick'; time: number }
  | { type: 'spawn_enemy'; enemyType: EnemyType; time: number };

export type GameEvent =
  | { type: 'hop'; entityId: number | 'player'; fromRow: number; fromCol: number; toRow: number; toCol: number }
  | { type: 'cube_changed'; row: number; col: number; colorIndex: number }
  | { type: 'player_died' }
  | { type: 'player_fell' }
  | { type: 'level_complete' }
  | { type: 'enemy_spawned'; enemy: EnemyState }
  | { type: 'enemy_fell'; enemyId: number }
  | { type: 'enemy_caught'; enemyId: number }
  | { type: 'disc_used'; side: 'left' | 'right'; row: number }
  | { type: 'coily_lured'; enemyId: number }
  | { type: 'game_over' }
  | { type: 'score_changed'; score: number; delta: number };

/** Renderer interface — implement this to swap DOM/canvas/3D. */
export interface Renderer {
  init(container: HTMLElement, state: GameState): void;
  render(state: GameState, now: number): void;
  /** Return the player's current screen position for touch input. */
  getPlayerScreenPos(state: GameState, now: number): { x: number; y: number };
  destroy(): void;
}
