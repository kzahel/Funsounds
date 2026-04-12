import { Direction, DIR_DELTA } from './types';
import type {
  GameState,
  GamePhase,
  Action,
  GameEvent,
  CubeState,
  PlayerState,
  EnemyState,
  DiscState,
  LevelDef,
  EnemyType,
} from './types';
import { LEVELS } from './levels';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isValidPos(rows: number, row: number, col: number): boolean {
  return row >= 0 && row < rows && col >= 0 && col <= row;
}

function getCube(state: GameState, row: number, col: number): CubeState | undefined {
  return state.cubes.find((c) => c.row === row && c.col === col);
}

function buildCubes(rows: number): CubeState[] {
  const cubes: CubeState[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= r; c++) {
      cubes.push({ row: r, col: c, colorIndex: 0 });
    }
  }
  return cubes;
}

function allCubesDone(state: GameState): boolean {
  return state.cubes.every((c) => c.colorIndex === state.level.targetColorIndex);
}

function addScore(state: GameState, delta: number, events: GameEvent[]): void {
  state.score += delta;
  events.push({ type: 'score_changed', score: state.score, delta });
}

/** Find disc adjacent to the edge position the player would hop to. */
function findDisc(state: GameState, row: number, col: number, dir: Direction): DiscState | undefined {
  // Player hopping off-left: col < 0 on their target row
  // Player hopping off-right: col > targetRow
  const [dRow] = DIR_DELTA[dir];
  const targetRow = row + dRow; // row they're leaving from, going to targetRow
  // Actually we need the source row. The player is AT (row, col) and hopping in dir.
  // If they land off-grid, check if a disc exists adjacent.

  // Left edge: col goes below 0 for the target row
  // A disc on the left at a given row means the player hops off the left side of that row.
  // Right edge: col exceeds the target row.

  // Simpler: compute target pos
  const [dr, dc] = DIR_DELTA[dir];
  const tRow = row + dr;
  const tCol = col + dc;

  if (isValidPos(state.level.pyramidRows, tRow, tCol)) return undefined; // still on grid

  // Determine which side
  if (tCol < 0) {
    return state.discs.find((d) => !d.used && d.side === 'left' && d.row === tRow);
  }
  if (tCol > tRow) {
    return state.discs.find((d) => !d.used && d.side === 'right' && d.row === tRow);
  }
  // Row out of bounds (above top or below bottom) — no disc for that
  if (tRow < 0) {
    // Hopping up off the top: check left/right based on direction
    const side = dir === Direction.UP_LEFT ? 'left' : 'right';
    return state.discs.find((d) => !d.used && d.side === side && d.row === 0);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createGameState(levelNumber: number, time: number): GameState {
  const level = LEVELS[Math.min(levelNumber - 1, LEVELS.length - 1)];
  return {
    level,
    cubes: buildCubes(level.pyramidRows),
    player: { row: 0, col: 0, hop: null, alive: true, ridingDisc: false },
    enemies: [],
    discs: level.discs.map((d) => ({ ...d, used: false })),
    score: 0,
    lives: 3,
    phase: 'playing',
    nextEnemyId: 1,
    freezeUntil: time,
  };
}

export function getLevelDef(levelNumber: number): LevelDef {
  return LEVELS[Math.min(levelNumber - 1, LEVELS.length - 1)];
}

/**
 * Resolve any in-flight hops that have completed by `now`.
 * Call this at the top of your game loop before processing new actions.
 */
export function resolveHops(state: GameState, now: number): GameEvent[] {
  const events: GameEvent[] = [];

  // Player hop
  if (state.player.hop && now >= state.player.hop.startTime + state.player.hop.duration) {
    const hop = state.player.hop;
    state.player.row = hop.toRow;
    state.player.col = hop.toCol;
    state.player.hop = null;

    if (state.player.ridingDisc) {
      // Landed back at the top from a disc ride
      state.player.ridingDisc = false;
      state.player.row = 0;
      state.player.col = 0;
    } else {
      // Normal landing — change cube color
      const cube = getCube(state, state.player.row, state.player.col);
      if (cube) {
        const wasTarget = cube.colorIndex === state.level.targetColorIndex;
        if (state.level.revertsOnExtra || cube.colorIndex !== state.level.targetColorIndex) {
          cube.colorIndex = (cube.colorIndex + 1) % state.level.numColors;
          events.push({ type: 'cube_changed', row: cube.row, col: cube.col, colorIndex: cube.colorIndex });
          if (!wasTarget && cube.colorIndex === state.level.targetColorIndex) {
            addScore(state, 25, events);
          }
        }
        if (allCubesDone(state)) {
          state.phase = 'level_complete';
          addScore(state, 1000, events);
          events.push({ type: 'level_complete' });
          return events;
        }
      }

      // Check collision with enemies at rest
      const collisionEvents = checkPlayerEnemyCollisions(state);
      events.push(...collisionEvents);
    }
  }

  // Enemy hops
  for (const enemy of state.enemies) {
    if (enemy.hop && now >= enemy.hop.startTime + enemy.hop.duration) {
      enemy.row = enemy.hop.toRow;
      enemy.col = enemy.hop.toCol;
      enemy.hop = null;

      // Coily ball transforms into chasing coily at bottom
      if (enemy.type === 'coily_ball' && enemy.row >= state.level.pyramidRows - 1) {
        enemy.type = 'coily';
      }

      // Slick/Sam revert cube colors when they land
      if (enemy.type === 'slick' || enemy.type === 'sam') {
        const cube = getCube(state, enemy.row, enemy.col);
        if (cube && cube.colorIndex > 0) {
          cube.colorIndex = Math.max(0, cube.colorIndex - 1);
          events.push({ type: 'cube_changed', row: cube.row, col: cube.col, colorIndex: cube.colorIndex });
        }
      }
    }
  }

  // Remove enemies that fell off the grid (from previous tick moves)
  // They would have hop targets off-grid; we handle that in enemy_tick
  // But also check resting enemies — shouldn't happen normally

  // Check collisions after all hops resolved
  if (state.phase === 'playing') {
    const collisionEvents = checkPlayerEnemyCollisions(state);
    events.push(...collisionEvents);
  }

  return events;
}

/**
 * Process a game action. Returns events for the renderer/controller.
 */
export function processAction(state: GameState, action: Action): GameEvent[] {
  const events: GameEvent[] = [];

  if (state.phase !== 'playing') return events;
  if (action.time < state.freezeUntil) return events;

  switch (action.type) {
    case 'move':
      return processMove(state, action.direction, action.time);
    case 'enemy_tick':
      return processEnemyTick(state, action.time);
    case 'spawn_enemy':
      return processSpawnEnemy(state, action.enemyType, action.time);
  }
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

function processMove(state: GameState, dir: Direction, time: number): GameEvent[] {
  const events: GameEvent[] = [];
  const p = state.player;

  if (p.hop || !p.alive) return events;

  const [dr, dc] = DIR_DELTA[dir];
  const tRow = p.row + dr;
  const tCol = p.col + dc;

  if (isValidPos(state.level.pyramidRows, tRow, tCol)) {
    // Normal hop onto a cube
    p.hop = {
      fromRow: p.row,
      fromCol: p.col,
      toRow: tRow,
      toCol: tCol,
      startTime: time,
      duration: state.level.hopDurationMs,
    };
    events.push({ type: 'hop', entityId: 'player', fromRow: p.row, fromCol: p.col, toRow: tRow, toCol: tCol });
  } else {
    // Off the grid — check for disc
    const disc = findDisc(state, p.row, p.col, dir);
    if (disc) {
      disc.used = true;
      p.ridingDisc = true;
      p.hop = {
        fromRow: p.row,
        fromCol: p.col,
        toRow: 0,
        toCol: 0,
        startTime: time,
        duration: state.level.hopDurationMs * 2, // disc ride takes longer
      };
      events.push({ type: 'disc_used', side: disc.side, row: disc.row });
      // Lure any chasing coily off the edge
      const coily = state.enemies.find((e) => e.type === 'coily' && !e.hop);
      if (coily) {
        state.enemies = state.enemies.filter((e) => e !== coily);
        addScore(state, 500, events);
        events.push({ type: 'coily_lured', enemyId: coily.id });
      }
    } else {
      // Fall off — lose a life
      p.alive = false;
      p.hop = {
        fromRow: p.row,
        fromCol: p.col,
        toRow: tRow,
        toCol: tCol,
        startTime: time,
        duration: state.level.hopDurationMs,
      };
      events.push({ type: 'player_fell' });
      handleDeath(state, time, events);
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Enemy tick
// ---------------------------------------------------------------------------

function processEnemyTick(state: GameState, time: number): GameEvent[] {
  const events: GameEvent[] = [];
  const toRemove: EnemyState[] = [];

  for (const enemy of state.enemies) {
    if (enemy.hop) continue; // still mid-hop, skip

    const dir = pickEnemyDirection(state, enemy);
    if (dir === null) {
      toRemove.push(enemy);
      continue;
    }

    const [dr, dc] = DIR_DELTA[dir];
    const tRow = enemy.row + dr;
    const tCol = enemy.col + dc;

    if (isValidPos(state.level.pyramidRows, tRow, tCol)) {
      enemy.hop = {
        fromRow: enemy.row,
        fromCol: enemy.col,
        toRow: tRow,
        toCol: tCol,
        startTime: time,
        duration: state.level.hopDurationMs,
      };
    } else {
      // Enemy falls off the pyramid
      toRemove.push(enemy);
      events.push({ type: 'enemy_fell', enemyId: enemy.id });
    }
  }

  state.enemies = state.enemies.filter((e) => !toRemove.includes(e));

  return events;
}

function pickEnemyDirection(state: GameState, enemy: EnemyState): Direction | null {
  switch (enemy.type) {
    case 'red_ball':
    case 'coily_ball':
    case 'slick':
    case 'sam':
      // Random downward
      return Math.random() < 0.5 ? Direction.DOWN_LEFT : Direction.DOWN_RIGHT;

    case 'coily': {
      // Chase the player
      const p = state.player;
      const pRow = p.hop ? p.hop.toRow : p.row;
      const pCol = p.hop ? p.hop.toCol : p.col;

      const dRow = pRow - enemy.row;
      const dCol = pCol - enemy.col;

      // Pick the diagonal direction that gets closest
      if (dRow <= 0) {
        // Need to go up
        return dCol <= -1 ? Direction.UP_LEFT : Direction.UP_RIGHT;
      } else {
        // Need to go down
        return dCol <= 0 ? Direction.DOWN_LEFT : Direction.DOWN_RIGHT;
      }
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

function processSpawnEnemy(state: GameState, enemyType: EnemyType, time: number): GameEvent[] {
  const events: GameEvent[] = [];
  const id = state.nextEnemyId++;

  // Spawn at the top of the pyramid
  const enemy: EnemyState = {
    id,
    type: enemyType,
    row: 0,
    col: 0,
    hop: null,
  };

  state.enemies.push(enemy);
  events.push({ type: 'enemy_spawned', enemy: { ...enemy } });

  return events;
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

function checkPlayerEnemyCollisions(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const p = state.player;
  if (!p.alive || p.hop || p.ridingDisc) return events;

  const toRemove: EnemyState[] = [];

  for (const enemy of state.enemies) {
    if (enemy.hop) continue; // mid-hop, no collision
    if (enemy.row !== p.row || enemy.col !== p.col) continue;

    if (enemy.type === 'slick' || enemy.type === 'sam') {
      // Catching slick/sam — bonus points, remove them
      toRemove.push(enemy);
      addScore(state, 300, events);
      events.push({ type: 'enemy_caught', enemyId: enemy.id });
    } else {
      // Deadly enemy — player dies
      events.push({ type: 'player_died' });
      handleDeath(state, performance.now(), events);
      break;
    }
  }

  state.enemies = state.enemies.filter((e) => !toRemove.includes(e));
  return events;
}

function handleDeath(state: GameState, time: number, events: GameEvent[]): void {
  state.lives--;
  if (state.lives <= 0) {
    state.phase = 'game_over';
    events.push({ type: 'game_over' });
  } else {
    state.phase = 'dying';
    state.freezeUntil = time + 1500;
  }
}

/**
 * Respawn the player after death. Call this from the controller after the death animation.
 */
export function respawnPlayer(state: GameState, time: number): void {
  state.player.row = 0;
  state.player.col = 0;
  state.player.hop = null;
  state.player.alive = true;
  state.player.ridingDisc = false;
  state.enemies = [];
  state.phase = 'playing';
  state.freezeUntil = time + 500; // brief invulnerability
}
