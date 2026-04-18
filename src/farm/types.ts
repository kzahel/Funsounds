// ---------------------------------------------------------------------------
// Farm game types
// ---------------------------------------------------------------------------

export const enum Dir {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
}

export const DIR_DELTA: Record<Dir, [dRow: number, dCol: number]> = {
  [Dir.N]: [-1, 0],
  [Dir.E]: [0, 1],
  [Dir.S]: [1, 0],
  [Dir.W]: [0, -1],
};

// ---------------------------------------------------------------------------
// Tiles & crops
// ---------------------------------------------------------------------------

export type TileKind = 'grass' | 'tilled' | 'wet_tilled';

export type CropKind = 'carrot' | 'tomato' | 'corn' | 'pumpkin';

/** Seconds from plant to fully ripe. */
export const CROP_GROW_SECONDS = 60;

export const CROP_PRICE: Record<CropKind, number> = {
  carrot: 3,
  tomato: 5,
  corn: 4,
  pumpkin: 12,
};

export interface Crop {
  kind: CropKind;
  /** Growth progress 0..1; ripe when >= 1. */
  growth: number;
  /** Time the seed was planted (game seconds). */
  plantedAt: number;
}

export interface TileState {
  row: number;
  col: number;
  kind: TileKind;
  crop: Crop | null;
  isMarket: boolean;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface MoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface Player {
  /** Position in tile-space (col, row), fractional. */
  x: number;
  y: number;
  facing: Facing;
  moving: MoveInput;
  speed: number; // tiles/sec
}

// ---------------------------------------------------------------------------
// Pests & defenses
// ---------------------------------------------------------------------------

export type PestKind = 'rabbit' | 'bird';

/** Birds fly (ignore water/obstacles) and can approach from any edge. */
export const FLYING_PESTS: ReadonlySet<PestKind> = new Set<PestKind>(['bird']);

export interface Pest {
  id: number;
  kind: PestKind;
  x: number;
  y: number;
  /** Target tile to eat. Recomputed when reached or cleared. */
  target: { row: number; col: number } | null;
  /** True while chomping a crop — stays in place until eaten or scared. */
  eating: boolean;
  /** Game time when eating started. Eats for EAT_DURATION seconds. */
  eatStartedAt: number;
  /** While true, flee the nearest threat until off-grid. */
  fleeing: boolean;
  /** Heading in radians when wandering/fleeing. */
  heading: number;
  speed: number;
}

export type DefenseKind = 'cat' | 'scarecrow';

export interface Defense {
  id: number;
  kind: DefenseKind;
  x: number;
  y: number;
  /** Cats wander; scarecrows are static (ignored fields). */
  heading: number;
  nextDecisionAt: number;
  moving: boolean;
}

// ---------------------------------------------------------------------------
// Inventory, economy
// ---------------------------------------------------------------------------

export type Inventory = Record<CropKind, number>;

export const COST_CAT = 50;
export const COST_SCARECROW = 20;
/** Expansion cost grows with radius. */
export function costToExpand(currentRadius: number): number {
  return 30 * currentRadius;
}

// ---------------------------------------------------------------------------
// Toolbar / placement
// ---------------------------------------------------------------------------

export type ToolTab = 'farm' | 'seeds' | 'defense' | 'shop';

export type Tool =
  | { kind: 'till' }
  | { kind: 'water' }
  | { kind: 'pick' }
  | { kind: 'seed'; crop: CropKind }
  | { kind: 'place_cat' }
  | { kind: 'place_scarecrow' }
  | { kind: 'buy_cat' }
  | { kind: 'buy_scarecrow' }
  | { kind: 'buy_expand' };

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
  player: Player;
  pests: Pest[];
  defenses: Defense[];
  inventory: Inventory;
  money: number;
  /** Chebyshev radius from arableCenter inside which tiles can be farmed. */
  arableRadius: number;
  arableCenter: { row: number; col: number };
  /** Purchased but not yet placed defense charges. */
  pendingCats: number;
  pendingScarecrows: number;
  /** Continuous game time in seconds. */
  time: number;
  nextRainAt: number;
  rainUntil: number;
  nextPestAt: number;
  selectedTab: ToolTab;
  selectedTool: Tool;
  nextId: number;
  paused: boolean;
}

// ---------------------------------------------------------------------------
// Actions / events
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'place'; row: number; col: number; tool: Tool }
  | { type: 'tick'; dt: number }
  | { type: 'select_tool'; tool: Tool; tab: ToolTab }
  | { type: 'set_player_moving'; dir: Facing; moving: boolean }
  | { type: 'set_paused'; paused: boolean }
  | { type: 'reset' };

export type GameEvent =
  | { type: 'tile_changed'; row: number; col: number }
  | { type: 'harvested'; crop: CropKind }
  | { type: 'sold'; amount: number }
  | { type: 'pest_added'; id: number }
  | { type: 'pest_removed'; id: number }
  | { type: 'defense_added'; id: number }
  | { type: 'expanded'; radius: number }
  | { type: 'rain_start' }
  | { type: 'rain_end' }
  | { type: 'purchase_failed' }
  | { type: 'crop_eaten'; row: number; col: number };

// ---------------------------------------------------------------------------
// Renderer interface (mirrors train builder)
// ---------------------------------------------------------------------------

export interface Renderer {
  init(container: HTMLElement, state: GameState): void;
  render(state: GameState, now: number): void;
  screenToTile(clientX: number, clientY: number): { row: number; col: number } | null;
  destroy(): void;
}
