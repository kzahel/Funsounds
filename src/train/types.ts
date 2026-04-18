// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export const enum Dir {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
}

/** Row/col delta for each direction (row grows downward). */
export const DIR_DELTA: Record<Dir, [dRow: number, dCol: number]> = {
  [Dir.N]: [-1, 0],
  [Dir.E]: [0, 1],
  [Dir.S]: [1, 0],
  [Dir.W]: [0, -1],
};

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

// ---------------------------------------------------------------------------
// Tiles & terrain
// ---------------------------------------------------------------------------

export type TerrainType = 'grass' | 'water';

export interface TileState {
  row: number;
  col: number;
  terrain: TerrainType;
  /** Track piece on this tile, if any. */
  track: TrackPiece | null;
  /** Decoration: 'tunnel' (mountain), 'bridge', or null. Tunnel/bridge implies track. */
  decoration: 'tunnel' | 'bridge' | null;
}

// ---------------------------------------------------------------------------
// Track pieces
// ---------------------------------------------------------------------------

/**
 * A track piece is defined by which of the 4 cardinal exits are connected.
 * Stored as a bitmask: N=1, E=2, S=4, W=8. Auto-orient computes this from neighbors.
 */
export interface TrackPiece {
  /** Bitmask of connected exits. */
  exits: number;
}

export const EXIT_BIT: Record<Dir, number> = {
  [Dir.N]: 1,
  [Dir.E]: 2,
  [Dir.S]: 4,
  [Dir.W]: 8,
};

export function hasExit(p: TrackPiece, d: Dir): boolean {
  return (p.exits & EXIT_BIT[d]) !== 0;
}

// ---------------------------------------------------------------------------
// Trains
// ---------------------------------------------------------------------------

export type TrainKind = 'steam' | 'diesel' | 'electric' | 'monorail';

export interface TrainCar {
  /** Tile the car is currently leaving. */
  row: number;
  col: number;
  /** Direction of travel (the exit it's heading toward). */
  dir: Dir;
  /** Progress across the current tile, 0..1. */
  progress: number;
}

export interface Train {
  id: number;
  kind: TrainKind;
  /** Cars from front (head) to back. */
  cars: TrainCar[];
  /** Pixels per second along track (set per-train). */
  speed: number;
  /** True if the train is stopped (no track to follow). */
  stopped: boolean;
}

// ---------------------------------------------------------------------------
// Animals
// ---------------------------------------------------------------------------

export type AnimalKind = 'cow' | 'sheep' | 'pig' | 'horse' | 'chicken' | 'dog' | 'duck' | 'rabbit' | 'pigeon';

/** Pigeons fly — they ignore terrain and don't idle. Used to gate AI behaviour. */
export const FLYING_ANIMALS: ReadonlySet<AnimalKind> = new Set<AnimalKind>(['pigeon']);

export interface Animal {
  id: number;
  kind: AnimalKind;
  /** Position in tile-space (col, row), can be fractional. */
  x: number;
  y: number;
  /** Heading in radians. */
  heading: number;
  /** Speed in tiles/second. */
  speed: number;
  /** Time at which the animal will choose a new heading. */
  nextDecisionAt: number;
  /** Currently moving (true) or idle (false). Ignored when perched. */
  moving: boolean;
  /** When true, the animal stays put and skips all AI updates. */
  perched: boolean;
}

// ---------------------------------------------------------------------------
// Toolbar / placement
// ---------------------------------------------------------------------------

export type ToolTab = 'tracks' | 'terrain' | 'trains' | 'animals' | 'tools';

export type Tool =
  | { kind: 'track' }
  | { kind: 'tunnel' }
  | { kind: 'bridge' }
  | { kind: 'terrain'; terrain: TerrainType }
  | { kind: 'train'; train: TrainKind; length: number }
  | { kind: 'animal'; animal: AnimalKind }
  | { kind: 'erase' }
  | { kind: 'drag' };

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface GridSize {
  rows: number;
  cols: number;
}

export interface GameState {
  size: GridSize;
  tiles: TileState[];
  trains: Train[];
  animals: Animal[];
  selectedTab: ToolTab;
  selectedTool: Tool;
  /** Monotonic id counter for new trains/animals. */
  nextId: number;
  /** True while the user is paused/editing without simulation. */
  paused: boolean;
}

// ---------------------------------------------------------------------------
// Actions / events
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'place'; row: number; col: number; tool: Tool; time: number }
  | { type: 'erase'; row: number; col: number }
  | { type: 'tick'; dt: number; time: number }
  | { type: 'select_tool'; tool: Tool; tab: ToolTab }
  | { type: 'set_paused'; paused: boolean }
  | { type: 'clear_all' }
  | { type: 'move_animal'; id: number; x: number; y: number }
  | { type: 'set_animal_perched'; id: number; perched: boolean };

export type GameEvent =
  | { type: 'tile_changed'; row: number; col: number }
  | { type: 'train_added'; trainId: number }
  | { type: 'train_removed'; trainId: number }
  | { type: 'animal_added'; animalId: number }
  | { type: 'animal_removed'; animalId: number }
  | { type: 'cleared' };

// ---------------------------------------------------------------------------
// Renderer interface
// ---------------------------------------------------------------------------

export interface Renderer {
  init(container: HTMLElement, state: GameState): void;
  render(state: GameState, now: number): void;
  /** Convert a screen-space (clientX, clientY) into a tile (row, col). Returns null off-grid. */
  screenToTile(clientX: number, clientY: number): { row: number; col: number } | null;
  /** Convert a screen-space (clientX, clientY) into fractional tile-space (col, row). Returns null off-grid. */
  screenToTileSpace(clientX: number, clientY: number): { x: number; y: number } | null;
  destroy(): void;
}
