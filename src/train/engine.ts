import { Dir, DIR_DELTA, EXIT_BIT, opposite, hasExit } from './types';
import type {
  GameState,
  TileState,
  Action,
  GameEvent,
  Tool,
  Train,
  TrainCar,
  TrainKind,
  Animal,
  AnimalKind,
  GridSize,
  TrackPiece,
} from './types';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createGameState(size: GridSize = { rows: 12, cols: 18 }): GameState {
  const tiles: TileState[] = [];
  for (let r = 0; r < size.rows; r++) {
    for (let c = 0; c < size.cols; c++) {
      tiles.push({ row: r, col: c, terrain: 'grass', track: null, decoration: null });
    }
  }
  return {
    size,
    tiles,
    trains: [],
    animals: [],
    selectedTab: 'tracks',
    selectedTool: { kind: 'track' },
    nextId: 1,
    paused: false,
  };
}

export function tileAt(state: GameState, row: number, col: number): TileState | undefined {
  if (row < 0 || row >= state.size.rows || col < 0 || col >= state.size.cols) return undefined;
  return state.tiles[row * state.size.cols + col];
}

export function inBounds(state: GameState, row: number, col: number): boolean {
  return row >= 0 && row < state.size.rows && col >= 0 && col < state.size.cols;
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

export function processAction(state: GameState, action: Action): GameEvent[] {
  switch (action.type) {
    case 'place':
      return placeAt(state, action.row, action.col, action.tool);
    case 'erase':
      return eraseAt(state, action.row, action.col);
    case 'tick':
      return tick(state, action.dt, action.time);
    case 'select_tool':
      state.selectedTab = action.tab;
      state.selectedTool = action.tool;
      return [];
    case 'set_paused':
      state.paused = action.paused;
      return [];
    case 'clear_all': {
      for (const t of state.tiles) {
        t.terrain = 'grass';
        t.track = null;
        t.decoration = null;
      }
      state.trains = [];
      state.animals = [];
      return [{ type: 'cleared' }];
    }
  }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function placeAt(state: GameState, row: number, col: number, tool: Tool): GameEvent[] {
  const tile = tileAt(state, row, col);
  if (!tile) return [];
  const events: GameEvent[] = [];

  switch (tool.kind) {
    case 'track':
      if (tile.terrain === 'water') return [];
      placeTrack(state, row, col);
      events.push({ type: 'tile_changed', row, col });
      // Recompute neighbours so they reorient toward the new track
      for (let d: Dir = 0; d < 4; d++) {
        const [dr, dc] = DIR_DELTA[d as Dir];
        if (tileAt(state, row + dr, col + dc)?.track) {
          recomputeTrackExits(state, row + dr, col + dc);
          events.push({ type: 'tile_changed', row: row + dr, col: col + dc });
        }
      }
      break;

    case 'tunnel':
    case 'bridge': {
      // Bridges go over water; tunnels imply a hill underneath.
      // Both also place a track if missing.
      placeTrack(state, row, col);
      tile.decoration = tool.kind;
      events.push({ type: 'tile_changed', row, col });
      for (let d: Dir = 0; d < 4; d++) {
        const [dr, dc] = DIR_DELTA[d as Dir];
        if (tileAt(state, row + dr, col + dc)?.track) {
          recomputeTrackExits(state, row + dr, col + dc);
          events.push({ type: 'tile_changed', row: row + dr, col: col + dc });
        }
      }
      break;
    }

    case 'terrain':
      // Don't allow placing water under existing track (unless it's a bridge)
      if (tool.terrain === 'water' && tile.track && tile.decoration !== 'bridge') return [];
      tile.terrain = tool.terrain;
      events.push({ type: 'tile_changed', row, col });
      break;

    case 'train':
      if (!tile.track) return [];
      const train = createTrain(state, tile, tool.train, tool.length);
      if (!train) return [];
      state.trains.push(train);
      events.push({ type: 'train_added', trainId: train.id });
      break;

    case 'animal':
      if (tile.terrain === 'water') return [];
      const animal = createAnimal(state, row, col, tool.animal);
      state.animals.push(animal);
      events.push({ type: 'animal_added', animalId: animal.id });
      break;

    case 'erase':
      return eraseAt(state, row, col);
  }

  return events;
}

function eraseAt(state: GameState, row: number, col: number): GameEvent[] {
  const tile = tileAt(state, row, col);
  if (!tile) return [];
  const events: GameEvent[] = [];

  // Remove trains whose head sits on this tile first
  const beforeTrains = state.trains.length;
  state.trains = state.trains.filter((tr) => {
    const onTile = tr.cars.some((car) => car.row === row && car.col === col);
    if (onTile) events.push({ type: 'train_removed', trainId: tr.id });
    return !onTile;
  });

  // Remove animals on this tile
  state.animals = state.animals.filter((a) => {
    const ar = Math.floor(a.y);
    const ac = Math.floor(a.x);
    if (ar === row && ac === col) {
      events.push({ type: 'animal_removed', animalId: a.id });
      return false;
    }
    return true;
  });

  if (tile.track || tile.decoration) {
    tile.track = null;
    tile.decoration = null;
    events.push({ type: 'tile_changed', row, col });
    for (let d: Dir = 0; d < 4; d++) {
      const [dr, dc] = DIR_DELTA[d as Dir];
      if (tileAt(state, row + dr, col + dc)?.track) {
        recomputeTrackExits(state, row + dr, col + dc);
        events.push({ type: 'tile_changed', row: row + dr, col: col + dc });
      }
    }
  } else if (beforeTrains === state.trains.length && tile.terrain !== 'grass') {
    tile.terrain = 'grass';
    events.push({ type: 'tile_changed', row, col });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Track auto-orientation
// ---------------------------------------------------------------------------

export function placeTrack(state: GameState, row: number, col: number): void {
  const tile = tileAt(state, row, col);
  if (!tile) return;
  if (!tile.track) tile.track = { exits: 0 };
  recomputeTrackExits(state, row, col);
}

export function recomputeTrackExits(state: GameState, row: number, col: number): void {
  const tile = tileAt(state, row, col);
  if (!tile || !tile.track) return;

  let exits = 0;
  // Connect to any neighbour that has a track
  for (let d: Dir = 0; d < 4; d++) {
    const [dr, dc] = DIR_DELTA[d as Dir];
    const neighbour = tileAt(state, row + dr, col + dc);
    if (neighbour?.track) {
      exits |= EXIT_BIT[d as Dir];
    }
  }

  // Lone track: default to a horizontal straight (E-W) so it's visible
  if (exits === 0) exits = EXIT_BIT[Dir.E] | EXIT_BIT[Dir.W];
  // Single connection: extend to the opposite side so we don't have a stub
  else if (popCount(exits) === 1) {
    const onlyDir = singleDir(exits);
    exits |= EXIT_BIT[opposite(onlyDir)];
  }

  tile.track.exits = exits;
}

function popCount(n: number): number {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}

function singleDir(exits: number): Dir {
  for (let d: Dir = 0; d < 4; d++) {
    if (exits === EXIT_BIT[d as Dir]) return d as Dir;
  }
  return Dir.N;
}

// ---------------------------------------------------------------------------
// Trains
// ---------------------------------------------------------------------------

const TRAIN_SPEEDS: Record<TrainKind, number> = {
  steam: 2.5,
  diesel: 3.5,
  electric: 4.5,
  monorail: 6.0,
};

function createTrain(state: GameState, tile: TileState, kind: TrainKind, length: number): Train | null {
  if (!tile.track) return null;
  // Pick an exit to head out of
  const dir = pickAnyExit(tile.track);
  if (dir === null) return null;

  const id = state.nextId++;
  const cars: TrainCar[] = [];
  // Place cars trailing back along the inverse direction.
  // Each car occupies its own tile slot; head starts at tile, others spaced behind.
  for (let i = 0; i < length; i++) {
    cars.push({
      row: tile.row,
      col: tile.col,
      dir,
      progress: -i * 1.0, // negative progress => behind the head
    });
  }
  return { id, kind, cars, speed: TRAIN_SPEEDS[kind], stopped: false };
}

function pickAnyExit(p: TrackPiece): Dir | null {
  for (let d: Dir = 0; d < 4; d++) {
    if (hasExit(p, d as Dir)) return d as Dir;
  }
  return null;
}

/** Advance a single car by `dist` tile-units along the track. */
function advanceCar(state: GameState, car: TrainCar, dist: number): boolean {
  let remaining = dist;
  // Cap iterations as a safety belt
  for (let i = 0; i < 8 && remaining > 0; i++) {
    car.progress += remaining;
    if (car.progress < 1) return true;

    // Hopped to next tile
    remaining = car.progress - 1;
    const [dr, dc] = DIR_DELTA[car.dir];
    const nextRow = car.row + dr;
    const nextCol = car.col + dc;
    const nextTile = tileAt(state, nextRow, nextCol);
    if (!nextTile?.track) {
      // Off the rails — try to reverse
      car.dir = opposite(car.dir);
      car.progress = 0;
      return false;
    }

    // The car arrived on the next tile from the opposite side
    const enterFrom = opposite(car.dir);
    if (!hasExit(nextTile.track, enterFrom)) {
      car.dir = opposite(car.dir);
      car.progress = 0;
      return false;
    }

    car.row = nextRow;
    car.col = nextCol;
    car.progress = 0;

    // Pick the next exit (anything that's not where we came from)
    let nextDir: Dir | null = null;
    const choices: Dir[] = [];
    for (let d: Dir = 0; d < 4; d++) {
      if (d === enterFrom) continue;
      if (hasExit(nextTile.track, d as Dir)) choices.push(d as Dir);
    }
    if (choices.length === 0) {
      // Dead end — reverse
      car.dir = opposite(car.dir);
      car.progress = 0;
      return false;
    }
    // Prefer continuing straight, otherwise random
    const straight = opposite(enterFrom);
    if (choices.includes(straight)) nextDir = straight;
    else nextDir = choices[Math.floor(Math.random() * choices.length)];
    car.dir = nextDir;
    car.progress = remaining;
    remaining = 0;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Animals
// ---------------------------------------------------------------------------

function createAnimal(state: GameState, row: number, col: number, kind: AnimalKind): Animal {
  return {
    id: state.nextId++,
    kind,
    x: col + 0.5,
    y: row + 0.5,
    heading: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.3,
    nextDecisionAt: 0,
    moving: false,
  };
}

function tickAnimal(state: GameState, a: Animal, dt: number, now: number): void {
  if (now >= a.nextDecisionAt) {
    // Toggle moving / pick a new heading
    a.moving = Math.random() < 0.7;
    a.heading = Math.random() * Math.PI * 2;
    a.speed = 0.3 + Math.random() * 0.4;
    a.nextDecisionAt = now + 800 + Math.random() * 2200;
  }
  if (!a.moving) return;

  const nx = a.x + Math.cos(a.heading) * a.speed * dt;
  const ny = a.y + Math.sin(a.heading) * a.speed * dt;
  // Avoid water and grid edges
  const tile = tileAt(state, Math.floor(ny), Math.floor(nx));
  if (!tile || tile.terrain === 'water') {
    // Bounce by flipping heading
    a.heading += Math.PI;
    return;
  }
  a.x = nx;
  a.y = ny;
}

// ---------------------------------------------------------------------------
// Tick (simulation step)
// ---------------------------------------------------------------------------

export function tick(state: GameState, dt: number, now: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.paused) return events;

  // Trains
  for (const train of state.trains) {
    if (train.stopped) continue;
    const move = train.speed * dt;
    for (const car of train.cars) {
      // Cars start with progress < 0 if they're trailing — they only move once they're "born"
      if (car.progress < 0) {
        car.progress += move;
        if (car.progress > 1) car.progress = 1; // clamp during catch-up
        continue;
      }
      const ok = advanceCar(state, car, move);
      if (!ok) {
        // The head reversed — trail will catch up via next ticks
      }
    }
  }

  // Animals
  for (const a of state.animals) {
    tickAnimal(state, a, dt, now);
  }

  return events;
}
