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
// Seasons
// ---------------------------------------------------------------------------

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

export const SEASONS: readonly Season[] = ['spring', 'summer', 'fall', 'winter'];
/** Seconds of game time per season. A full year is SEASON_DURATION * 4. */
export const SEASON_DURATION = 180;

// ---------------------------------------------------------------------------
// Tiles & crops
// ---------------------------------------------------------------------------

/** apple_tree is a permanent tile type planted via the apple seed tool. */
export type TileKind = 'grass' | 'tilled' | 'wet_tilled' | 'apple_tree';

export type CropKind =
  | 'carrot'
  | 'tomato'
  | 'corn'
  | 'pumpkin'
  | 'strawberry'
  | 'potato'
  | 'watermelon'
  | 'apple'
  | 'turnip';

/** Base grow time (seconds on wet soil) per crop. Seasonal multipliers apply on top. */
export const CROP_GROW_SECONDS: Record<CropKind, number> = {
  carrot: 60,
  tomato: 60,
  corn: 60,
  pumpkin: 60,
  strawberry: 30,
  potato: 90,
  watermelon: 100,
  apple: 120, // first fruit; subsequent fruits use APPLE_REGROW_SECONDS
  turnip: 45,
};

/** After the first apple, the tree regrows fruit faster. */
export const APPLE_REGROW_SECONDS = 45;

/** Base sell price per unit harvested. */
export const CROP_PRICE: Record<CropKind, number> = {
  carrot: 3,
  tomato: 5,
  corn: 4,
  pumpkin: 12,
  strawberry: 2,
  potato: 3, // per potato; potato yields 3 per harvest
  watermelon: 20,
  apple: 8,
  turnip: 5,
};

/** Units delivered to inventory per harvested crop. */
export const CROP_YIELD: Record<CropKind, number> = {
  carrot: 1,
  tomato: 1,
  corn: 1,
  pumpkin: 1,
  strawberry: 1,
  potato: 3,
  watermelon: 1,
  apple: 1,
  turnip: 1,
};

/**
 * Seasons in which each crop grows (on wet soil).
 * Apple trees tolerate all seasons; out-of-season crops sit at current growth.
 */
export const CROP_SEASONS: Record<CropKind, ReadonlySet<Season>> = {
  carrot: new Set<Season>(['spring', 'summer', 'fall']),
  tomato: new Set<Season>(['summer']),
  corn: new Set<Season>(['summer', 'fall']),
  pumpkin: new Set<Season>(['fall']),
  strawberry: new Set<Season>(['spring', 'summer']),
  potato: new Set<Season>(['spring', 'fall']),
  watermelon: new Set<Season>(['summer']),
  apple: new Set<Season>(['spring', 'summer', 'fall', 'winter']),
  turnip: new Set<Season>(['winter']),
};

export interface Crop {
  kind: CropKind;
  /** Growth progress 0..1; ripe when >= 1. */
  growth: number;
  /** Time the seed was planted (game seconds). */
  plantedAt: number;
  /** Apple trees flip this to true after the first harvest so regrow uses the faster cycle. */
  hasYielded?: boolean;
}

export interface TileState {
  row: number;
  col: number;
  kind: TileKind;
  crop: Crop | null;
  isMarket: boolean;
  /** True if a fence tile blocks ground pests (rabbits). Birds fly over. */
  hasFence: boolean;
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
  /** Base speed; boots multiply this via hasBoots flag in state. */
  speed: number;
}

// ---------------------------------------------------------------------------
// Pests & defenses
// ---------------------------------------------------------------------------

export type PestKind = 'rabbit' | 'bird';

/** Birds fly (ignore fences) and can approach from any edge. */
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
  eatStartedAt: number;
  fleeing: boolean;
  heading: number;
  speed: number;
}

export type DefenseKind = 'cat' | 'scarecrow' | 'beehive';

export interface Defense {
  id: number;
  kind: DefenseKind;
  x: number;
  y: number;
  /** Cats wander; scarecrows/beehives are static (ignored for those). */
  heading: number;
  nextDecisionAt: number;
  moving: boolean;
  /** Beehives: time of next honey drop. Unused for other kinds. */
  nextHoneyAt?: number;
}

// ---------------------------------------------------------------------------
// Inventory & economy
// ---------------------------------------------------------------------------

export interface Inventory {
  carrot: number;
  tomato: number;
  corn: number;
  pumpkin: number;
  strawberry: number;
  potato: number;
  watermelon: number;
  apple: number;
  turnip: number;
  honey: number;
}

/** Sell prices including non-crop items like honey. */
export const SELL_PRICE: Record<keyof Inventory, number> = {
  ...CROP_PRICE,
  honey: 2,
};

export const COST_CAT = 50;
export const COST_SCARECROW = 20;
export const COST_BEEHIVE = 60;
export const COST_FENCE = 8;
export const COST_BOOTS = 40;

/** Expansion cost grows with radius. */
export function costToExpand(currentRadius: number): number {
  return 30 * currentRadius;
}

/** Winter discount multiplier on shop prices. */
export function seasonShopMultiplier(season: Season): number {
  return season === 'winter' ? 0.75 : 1.0;
}

/** Season sell price multiplier. Winter = general bonus; fall = bonus for pumpkin & apple. */
export function seasonSellMultiplier(season: Season, item: keyof Inventory): number {
  if (season === 'winter') return 1.3;
  if (season === 'fall' && (item === 'pumpkin' || item === 'apple')) return 1.5;
  return 1.0;
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
  | { kind: 'place_beehive' }
  | { kind: 'place_fence' }
  | { kind: 'buy_cat' }
  | { kind: 'buy_scarecrow' }
  | { kind: 'buy_beehive' }
  | { kind: 'buy_fence' }
  | { kind: 'buy_boots' }
  | { kind: 'buy_expand' };

/** Shallow value-equality for tools. Used for toolbar highlighting after loads. */
export function toolsEqual(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'seed' && b.kind === 'seed') return a.crop === b.crop;
  return true;
}

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
  /** Purchased but not yet placed charges. */
  pendingCats: number;
  pendingScarecrows: number;
  pendingBeehives: number;
  pendingFences: number;
  /** One-time upgrades. */
  hasBoots: boolean;
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
// Save payload
// ---------------------------------------------------------------------------

export const SAVE_VERSION = 1;
export const SAVE_SLOT_COUNT = 3;

export interface SavePayload {
  version: number;
  savedAt: string; // ISO
  state: GameState;
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
  | { type: 'reset' }
  | { type: 'load_state'; state: GameState };

export type GameEvent =
  | { type: 'tile_changed'; row: number; col: number }
  | { type: 'harvested'; crop: CropKind; amount: number }
  | { type: 'sold'; amount: number }
  | { type: 'pest_added'; id: number }
  | { type: 'pest_removed'; id: number }
  | { type: 'defense_added'; id: number }
  | { type: 'expanded'; radius: number }
  | { type: 'rain_start' }
  | { type: 'rain_end' }
  | { type: 'purchase_failed' }
  | { type: 'crop_eaten'; row: number; col: number }
  | { type: 'season_changed'; season: Season }
  | { type: 'boots_equipped' };

// ---------------------------------------------------------------------------
// Renderer interface
// ---------------------------------------------------------------------------

export interface Renderer {
  init(container: HTMLElement, state: GameState): void;
  render(state: GameState, now: number): void;
  /** Rebuild tiles (needed after load since tile DOM is stateful). */
  rebuild(state: GameState): void;
  screenToTile(clientX: number, clientY: number): { row: number; col: number } | null;
  destroy(): void;
}
