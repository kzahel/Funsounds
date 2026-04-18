import {
  CROP_GROW_SECONDS,
  CROP_PRICE,
  CROP_YIELD,
  CROP_SEASONS,
  APPLE_REGROW_SECONDS,
  COST_CAT,
  COST_SCARECROW,
  COST_BEEHIVE,
  COST_FENCE,
  COST_BOOTS,
  FLYING_PESTS,
  SEASONS,
  SEASON_DURATION,
  SELL_PRICE,
  costToExpand,
  seasonSellMultiplier,
  seasonShopMultiplier,
} from './types';
import type {
  GameState,
  TileState,
  Action,
  GameEvent,
  Tool,
  Player,
  Pest,
  PestKind,
  Defense,
  DefenseKind,
  CropKind,
  Inventory,
  Facing,
  GridSize,
  Season,
} from './types';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const PLAYER_SPEED = 3.2;
const BOOTS_SPEED_MULT = 1.5;
const PLAYER_SCARE_RADIUS = 1.6;
const BOOTS_SCARE_MULT = 1.5;
const CAT_SCARE_RADIUS = 1.8;
const SCARECROW_SCARE_RADIUS = 2.6;
const PEST_EAT_SECONDS = 3.0;
const PEST_SPAWN_MIN = 6;
const PEST_SPAWN_MAX = 14;
const RAIN_INTERVAL_MIN = 35;
const RAIN_INTERVAL_MAX = 70;
const RAIN_DURATION = 8;

const BEEHIVE_HONEY_INTERVAL = 30;
const BEEHIVE_BOOST_RADIUS = 2;
const BEEHIVE_BOOST_MULT = 1.25;
const SUMMER_GROWTH_MULT = 1.25;
const SUMMER_PEST_MULT = 1.5;

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export function currentSeason(time: number): Season {
  const idx = Math.floor(time / SEASON_DURATION) % SEASONS.length;
  return SEASONS[idx];
}

export function seasonTimeRemaining(time: number): number {
  return SEASON_DURATION - (time % SEASON_DURATION);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function makeEmptyInventory(): Inventory {
  return {
    carrot: 0, tomato: 0, corn: 0, pumpkin: 0,
    strawberry: 0, potato: 0, watermelon: 0, apple: 0, turnip: 0,
    honey: 0,
  };
}

export function createGameState(size: GridSize = { rows: 9, cols: 13 }): GameState {
  const tiles: TileState[] = [];
  const market = { row: 0, col: size.cols - 1 };
  for (let r = 0; r < size.rows; r++) {
    for (let c = 0; c < size.cols; c++) {
      tiles.push({
        row: r,
        col: c,
        kind: 'grass',
        crop: null,
        isMarket: r === market.row && c === market.col,
        hasFence: false,
      });
    }
  }
  const center = { row: Math.floor(size.rows / 2), col: Math.floor(size.cols / 2) };
  const player: Player = {
    x: center.col + 0.5,
    y: center.row + 0.5,
    facing: 'down',
    moving: { up: false, down: false, left: false, right: false },
    speed: PLAYER_SPEED,
  };
  return {
    size,
    tiles,
    player,
    pests: [],
    defenses: [],
    inventory: makeEmptyInventory(),
    money: 10,
    arableRadius: 1,
    arableCenter: center,
    pendingCats: 0,
    pendingScarecrows: 0,
    pendingBeehives: 0,
    pendingFences: 0,
    hasBoots: false,
    time: 0,
    nextRainAt: RAIN_INTERVAL_MIN + Math.random() * (RAIN_INTERVAL_MAX - RAIN_INTERVAL_MIN),
    rainUntil: -1,
    nextPestAt: PEST_SPAWN_MIN + Math.random() * (PEST_SPAWN_MAX - PEST_SPAWN_MIN),
    selectedTab: 'farm',
    selectedTool: { kind: 'till' },
    nextId: 1,
    paused: false,
  };
}

export function tileAt(state: GameState, row: number, col: number): TileState | undefined {
  if (row < 0 || row >= state.size.rows || col < 0 || col >= state.size.cols) return undefined;
  return state.tiles[row * state.size.cols + col];
}

export function isArable(state: GameState, row: number, col: number): boolean {
  const dr = Math.abs(row - state.arableCenter.row);
  const dc = Math.abs(col - state.arableCenter.col);
  return Math.max(dr, dc) <= state.arableRadius;
}

export function isRaining(state: GameState): boolean {
  return state.time < state.rainUntil;
}

export function playerSpeed(state: GameState): number {
  return PLAYER_SPEED * (state.hasBoots ? BOOTS_SPEED_MULT : 1);
}

export function playerScareRadius(state: GameState): number {
  return PLAYER_SCARE_RADIUS * (state.hasBoots ? BOOTS_SCARE_MULT : 1);
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

export function processAction(state: GameState, action: Action): GameEvent[] {
  switch (action.type) {
    case 'place':
      return placeAt(state, action.row, action.col, action.tool);
    case 'tick':
      return tick(state, action.dt);
    case 'select_tool':
      state.selectedTab = action.tab;
      state.selectedTool = action.tool;
      return [];
    case 'set_player_moving': {
      state.player.moving[action.dir] = action.moving;
      return [];
    }
    case 'set_paused':
      state.paused = action.paused;
      return [];
    case 'reset': {
      const fresh = createGameState(state.size);
      Object.assign(state, fresh);
      return [];
    }
    case 'load_state': {
      // Replace state fields with loaded state (keep reference identity).
      Object.assign(state, action.state);
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Tool placement
// ---------------------------------------------------------------------------

function placeAt(state: GameState, row: number, col: number, tool: Tool): GameEvent[] {
  const tile = tileAt(state, row, col);
  if (!tile) return [];
  const events: GameEvent[] = [];

  switch (tool.kind) {
    case 'till': {
      if (!isArable(state, row, col)) return [];
      if (tile.isMarket || tile.hasFence) return [];
      if (tile.crop) return [];
      if (tile.kind !== 'grass') return [];
      tile.kind = 'tilled';
      events.push({ type: 'tile_changed', row, col });
      return events;
    }
    case 'water': {
      if (!isArable(state, row, col)) return [];
      if (tile.kind === 'tilled' || tile.kind === 'wet_tilled') {
        tile.kind = 'wet_tilled';
        events.push({ type: 'tile_changed', row, col });
      }
      return events;
    }
    case 'seed': {
      if (!isArable(state, row, col)) return [];
      if (tile.crop || tile.hasFence || tile.isMarket) return [];
      if (tool.crop === 'apple') {
        // Apple tree: plants on plain grass, makes the tile permanently 'apple_tree'.
        if (tile.kind !== 'grass') return [];
        tile.kind = 'apple_tree';
        tile.crop = { kind: 'apple', growth: 0, plantedAt: state.time, hasYielded: false };
        events.push({ type: 'tile_changed', row, col });
        return events;
      }
      if (tile.kind !== 'tilled' && tile.kind !== 'wet_tilled') return [];
      tile.crop = { kind: tool.crop, growth: 0, plantedAt: state.time };
      events.push({ type: 'tile_changed', row, col });
      return events;
    }
    case 'pick': {
      return harvestTile(state, row, col);
    }
    case 'place_cat':
    case 'place_scarecrow':
    case 'place_beehive': {
      const kind: DefenseKind =
        tool.kind === 'place_cat' ? 'cat' :
        tool.kind === 'place_scarecrow' ? 'scarecrow' : 'beehive';
      const pending =
        kind === 'cat' ? 'pendingCats' :
        kind === 'scarecrow' ? 'pendingScarecrows' : 'pendingBeehives';
      if (state[pending] <= 0) return [];
      if (!isArable(state, row, col)) return [];
      if (tile.isMarket || tile.hasFence) return [];
      state[pending] -= 1;
      const d = createDefense(state, row, col, kind);
      state.defenses.push(d);
      events.push({ type: 'defense_added', id: d.id });
      if (state[pending] <= 0) {
        state.selectedTool = { kind: 'till' };
        state.selectedTab = 'farm';
      }
      return events;
    }
    case 'place_fence': {
      if (state.pendingFences <= 0) return [];
      if (tile.isMarket || tile.hasFence) return [];
      // Fences can be placed anywhere — no arable restriction (perimeter walls).
      // Can't place on top of a crop.
      if (tile.crop) return [];
      state.pendingFences -= 1;
      tile.hasFence = true;
      events.push({ type: 'tile_changed', row, col });
      if (state.pendingFences <= 0) {
        state.selectedTool = { kind: 'till' };
        state.selectedTab = 'farm';
      }
      return events;
    }
    case 'buy_cat': return buyStack(state, events, COST_CAT, 'pendingCats', { kind: 'place_cat' });
    case 'buy_scarecrow': return buyStack(state, events, COST_SCARECROW, 'pendingScarecrows', { kind: 'place_scarecrow' });
    case 'buy_beehive': return buyStack(state, events, COST_BEEHIVE, 'pendingBeehives', { kind: 'place_beehive' });
    case 'buy_fence': return buyStack(state, events, COST_FENCE, 'pendingFences', { kind: 'place_fence' });
    case 'buy_boots': {
      const cost = Math.round(COST_BOOTS * seasonShopMultiplier(currentSeason(state.time)));
      if (state.hasBoots || state.money < cost) {
        events.push({ type: 'purchase_failed' });
        return events;
      }
      state.money -= cost;
      state.hasBoots = true;
      events.push({ type: 'boots_equipped' });
      return events;
    }
    case 'buy_expand': {
      const cost = Math.round(costToExpand(state.arableRadius) * seasonShopMultiplier(currentSeason(state.time)));
      if (state.money < cost) {
        events.push({ type: 'purchase_failed' });
        return events;
      }
      const maxRadius = Math.min(
        state.arableCenter.row,
        state.arableCenter.col,
        state.size.rows - 1 - state.arableCenter.row,
        state.size.cols - 1 - state.arableCenter.col,
      );
      if (state.arableRadius >= maxRadius) {
        events.push({ type: 'purchase_failed' });
        return events;
      }
      state.money -= cost;
      state.arableRadius += 1;
      events.push({ type: 'expanded', radius: state.arableRadius });
      return events;
    }
  }
  return events;
}

type PendingKey = 'pendingCats' | 'pendingScarecrows' | 'pendingBeehives' | 'pendingFences';

function buyStack(
  state: GameState,
  events: GameEvent[],
  baseCost: number,
  pending: PendingKey,
  placeTool: Tool,
): GameEvent[] {
  const cost = Math.round(baseCost * seasonShopMultiplier(currentSeason(state.time)));
  if (state.money < cost) {
    events.push({ type: 'purchase_failed' });
    return events;
  }
  state.money -= cost;
  state[pending] += 1;
  state.selectedTab = 'defense';
  state.selectedTool = placeTool;
  return events;
}

function harvestTile(state: GameState, row: number, col: number): GameEvent[] {
  const tile = tileAt(state, row, col);
  if (!tile || !tile.crop) return [];
  if (tile.crop.growth < 1) return [];
  const kind = tile.crop.kind;
  const yieldAmount = CROP_YIELD[kind];
  state.inventory[kind] += yieldAmount;
  if (kind === 'apple' && tile.kind === 'apple_tree') {
    // Tree stays; reset crop so it regrows. Subsequent fruits grow faster.
    tile.crop = { kind: 'apple', growth: 0, plantedAt: state.time, hasYielded: true };
  } else {
    tile.crop = null;
    tile.kind = 'tilled';
  }
  return [
    { type: 'harvested', crop: kind, amount: yieldAmount },
    { type: 'tile_changed', row, col },
  ];
}

// ---------------------------------------------------------------------------
// Defenses (cat wanders, beehive ticks honey, scarecrow static)
// ---------------------------------------------------------------------------

function createDefense(state: GameState, row: number, col: number, kind: DefenseKind): Defense {
  const d: Defense = {
    id: state.nextId++,
    kind,
    x: col + 0.5,
    y: row + 0.5,
    heading: Math.random() * Math.PI * 2,
    nextDecisionAt: 0,
    moving: kind === 'cat',
  };
  if (kind === 'beehive') d.nextHoneyAt = state.time + BEEHIVE_HONEY_INTERVAL;
  return d;
}

function tickCat(state: GameState, d: Defense, dt: number): void {
  if (d.kind !== 'cat') return;
  if (state.time >= d.nextDecisionAt) {
    d.moving = Math.random() < 0.75;
    d.heading = Math.random() * Math.PI * 2;
    d.nextDecisionAt = state.time + 1.2 + Math.random() * 2.5;
  }
  if (!d.moving) return;
  const nx = d.x + Math.cos(d.heading) * 1.1 * dt;
  const ny = d.y + Math.sin(d.heading) * 1.1 * dt;
  if (nx < 0.3 || nx >= state.size.cols - 0.3 || ny < 0.3 || ny >= state.size.rows - 0.3) {
    d.heading += Math.PI;
    return;
  }
  d.x = nx;
  d.y = ny;
}

function tickBeehive(state: GameState, d: Defense): void {
  if (d.kind !== 'beehive') return;
  if (d.nextHoneyAt == null) d.nextHoneyAt = state.time + BEEHIVE_HONEY_INTERVAL;
  if (state.time >= d.nextHoneyAt) {
    state.inventory.honey += 1;
    d.nextHoneyAt = state.time + BEEHIVE_HONEY_INTERVAL;
  }
}

/** Is there a beehive within BEEHIVE_BOOST_RADIUS tiles of (col+0.5, row+0.5)? */
function beehiveNear(state: GameState, row: number, col: number): boolean {
  const cx = col + 0.5;
  const cy = row + 0.5;
  const r2 = BEEHIVE_BOOST_RADIUS * BEEHIVE_BOOST_RADIUS;
  for (const d of state.defenses) {
    if (d.kind !== 'beehive') continue;
    const dx = d.x - cx;
    const dy = d.y - cy;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pests
// ---------------------------------------------------------------------------

function spawnPest(state: GameState): Pest {
  const edge = Math.floor(Math.random() * 4);
  const kind: PestKind = Math.random() < 0.5 ? 'rabbit' : 'bird';
  let x = 0;
  let y = 0;
  if (edge === 0) { x = Math.random() * state.size.cols; y = 0.1; }
  else if (edge === 1) { x = state.size.cols - 0.1; y = Math.random() * state.size.rows; }
  else if (edge === 2) { x = Math.random() * state.size.cols; y = state.size.rows - 0.1; }
  else { x = 0.1; y = Math.random() * state.size.rows; }
  return {
    id: state.nextId++,
    kind,
    x, y,
    target: null,
    eating: false,
    eatStartedAt: 0,
    fleeing: false,
    heading: 0,
    speed: kind === 'bird' ? 1.6 : 1.1,
  };
}

function findTargetCrop(state: GameState, x: number, y: number): { row: number; col: number } | null {
  let best: { row: number; col: number } | null = null;
  let bestD2 = Infinity;
  for (const t of state.tiles) {
    if (!t.crop) continue;
    const cx = t.col + 0.5;
    const cy = t.row + 0.5;
    const d2 = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    const weight = t.crop.growth >= 1 ? 1 : 2.2;
    const score = d2 * weight;
    if (score < bestD2) {
      bestD2 = score;
      best = { row: t.row, col: t.col };
    }
  }
  return best;
}

function threatProximity(state: GameState, x: number, y: number): { d2: number; tx: number; ty: number } | null {
  let best: { d2: number; tx: number; ty: number } | null = null;
  const consider = (tx: number, ty: number, radius: number): void => {
    const dx = x - tx;
    const dy = y - ty;
    const d2 = dx * dx + dy * dy;
    if (d2 <= radius * radius && (!best || d2 < best.d2)) {
      best = { d2, tx, ty };
    }
  };
  const p = state.player;
  const pMoving = p.moving.up || p.moving.down || p.moving.left || p.moving.right;
  if (pMoving) consider(p.x, p.y, playerScareRadius(state));
  for (const d of state.defenses) {
    if (d.kind === 'cat') consider(d.x, d.y, CAT_SCARE_RADIUS);
    else if (d.kind === 'scarecrow') consider(d.x, d.y, SCARECROW_SCARE_RADIUS);
    // Beehives don't scare pests.
  }
  return best;
}

function tickPest(state: GameState, pest: Pest, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  const flying = FLYING_PESTS.has(pest.kind);

  // Threats — sticky fleeing
  const threat = threatProximity(state, pest.x, pest.y);
  if (threat) {
    pest.fleeing = true;
    pest.eating = false;
    pest.target = null;
    pest.heading = Math.atan2(pest.y - threat.ty, pest.x - threat.tx);
  }

  // Eating
  if (pest.eating && pest.target) {
    const tile = tileAt(state, pest.target.row, pest.target.col);
    if (!tile || !tile.crop) {
      pest.eating = false;
      pest.target = null;
    } else if (state.time - pest.eatStartedAt >= PEST_EAT_SECONDS) {
      if (tile.crop.kind === 'apple' && tile.kind === 'apple_tree') {
        // Pest snacks the apple; tree survives, fruit resets.
        tile.crop = { kind: 'apple', growth: 0, plantedAt: state.time, hasYielded: true };
      } else {
        tile.crop = null;
      }
      events.push({ type: 'crop_eaten', row: tile.row, col: tile.col });
      events.push({ type: 'tile_changed', row: tile.row, col: tile.col });
      pest.eating = false;
      pest.target = null;
    }
    if (!pest.fleeing) return events;
  }

  // Acquire target (birds ignore fences; rabbits see only fence-reachable crops treat simply)
  if (!pest.target && !pest.fleeing) {
    pest.target = findTargetCrop(state, pest.x, pest.y);
    if (pest.target) {
      const tx = pest.target.col + 0.5;
      const ty = pest.target.row + 0.5;
      pest.heading = Math.atan2(ty - pest.y, tx - pest.x);
    } else {
      const tx = state.size.cols / 2;
      const ty = state.size.rows / 2;
      pest.heading = Math.atan2(ty - pest.y, tx - pest.x);
    }
  }

  if (!pest.fleeing && pest.target) {
    const tx = pest.target.col + 0.5;
    const ty = pest.target.row + 0.5;
    pest.heading = Math.atan2(ty - pest.y, tx - pest.x);
    const dx = tx - pest.x;
    const dy = ty - pest.y;
    if (dx * dx + dy * dy < 0.2 * 0.2) {
      const tile = tileAt(state, pest.target.row, pest.target.col);
      if (tile?.crop) {
        pest.eating = true;
        pest.eatStartedAt = state.time;
      } else {
        pest.target = null;
      }
      return events;
    }
  }

  const nx = pest.x + Math.cos(pest.heading) * pest.speed * dt;
  const ny = pest.y + Math.sin(pest.heading) * pest.speed * dt;

  // Rabbits are blocked by fences; birds fly over.
  if (!flying && !pest.fleeing) {
    const nextTile = tileAt(state, Math.floor(ny), Math.floor(nx));
    if (nextTile?.hasFence) {
      // Dumb behaviour: give up and flee off-map.
      pest.fleeing = true;
      pest.heading += Math.PI;
      pest.target = null;
      return events;
    }
  }

  if (pest.fleeing) {
    pest.x = nx;
    pest.y = ny;
    if (nx < -0.5 || nx > state.size.cols + 0.5 || ny < -0.5 || ny > state.size.rows + 0.5) {
      events.push({ type: 'pest_removed', id: pest.id });
    }
    return events;
  }

  pest.x = Math.max(0.1, Math.min(state.size.cols - 0.1, nx));
  pest.y = Math.max(0.1, Math.min(state.size.rows - 0.1, ny));
  return events;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function updatePlayer(state: GameState, dt: number): GameEvent[] {
  const p = state.player;
  let vx = 0;
  let vy = 0;
  if (p.moving.up) vy -= 1;
  if (p.moving.down) vy += 1;
  if (p.moving.left) vx -= 1;
  if (p.moving.right) vx += 1;
  if (vx !== 0 || vy !== 0) {
    const len = Math.hypot(vx, vy);
    vx /= len;
    vy /= len;
    if (Math.abs(vx) > Math.abs(vy)) p.facing = vx > 0 ? 'right' : 'left';
    else p.facing = vy > 0 ? 'down' : 'up';
    const speed = playerSpeed(state);
    const nx = p.x + vx * speed * dt;
    const ny = p.y + vy * speed * dt;
    p.x = Math.max(0.25, Math.min(state.size.cols - 0.25, nx));
    p.y = Math.max(0.25, Math.min(state.size.rows - 0.25, ny));
  }
  return checkPlayerCollisions(state);
}

function checkPlayerCollisions(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const p = state.player;
  const row = Math.floor(p.y);
  const col = Math.floor(p.x);
  const tile = tileAt(state, row, col);
  if (tile && tile.crop && tile.crop.growth >= 1) {
    events.push(...harvestTile(state, row, col));
  }
  if (tile && tile.isMarket) {
    const sale = sellAll(state);
    if (sale > 0) events.push({ type: 'sold', amount: sale });
  }
  return events;
}

/** Compute the gross sale of current inventory at the current season's prices. */
export function sellValue(state: GameState): number {
  const season = currentSeason(state.time);
  let total = 0;
  for (const k of Object.keys(state.inventory) as (keyof Inventory)[]) {
    const qty = state.inventory[k];
    if (!qty) continue;
    total += qty * SELL_PRICE[k] * seasonSellMultiplier(season, k);
  }
  return Math.round(total);
}

function sellAll(state: GameState): number {
  const total = sellValue(state);
  if (total <= 0) return 0;
  for (const k of Object.keys(state.inventory) as (keyof Inventory)[]) {
    state.inventory[k] = 0;
  }
  state.money += total;
  return total;
}

// ---------------------------------------------------------------------------
// Weather & crops
// ---------------------------------------------------------------------------

function updateWeather(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.rainUntil > 0 && state.time >= state.rainUntil) {
    events.push({ type: 'rain_end' });
    state.rainUntil = -1;
    state.nextRainAt = state.time + RAIN_INTERVAL_MIN + Math.random() * (RAIN_INTERVAL_MAX - RAIN_INTERVAL_MIN);
  } else if (state.rainUntil < 0 && state.time >= state.nextRainAt) {
    state.rainUntil = state.time + RAIN_DURATION;
    events.push({ type: 'rain_start' });
    for (const t of state.tiles) {
      if (t.kind === 'tilled') {
        t.kind = 'wet_tilled';
        events.push({ type: 'tile_changed', row: t.row, col: t.col });
      }
    }
  }
  return events;
}

function cropGrowMult(state: GameState, t: TileState): number {
  if (!t.crop) return 0;
  const season = currentSeason(state.time);
  // Per-crop seasonal gating
  const seasons = CROP_SEASONS[t.crop.kind];
  if (!seasons.has(season)) return 0;
  // Apples grow anywhere; others skip winter (already filtered by season set, but apply summer boost below).
  let mult = 1;
  if (season === 'summer' && t.crop.kind !== 'apple' && t.crop.kind !== 'turnip') {
    mult *= SUMMER_GROWTH_MULT;
  }
  // Beehive boost
  if (beehiveNear(state, t.row, t.col)) mult *= BEEHIVE_BOOST_MULT;
  return mult;
}

function updateCrops(state: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (const t of state.tiles) {
    if (!t.crop) continue;
    const wasRipe = t.crop.growth >= 1;
    // Apple trees don't need wet soil — they're permanent plantings.
    // Others need wet_tilled soil to grow.
    const wetEnough = t.kind === 'wet_tilled' || t.kind === 'apple_tree';
    if (wetEnough) {
      const baseSeconds =
        t.crop.kind === 'apple' && t.crop.hasYielded
          ? APPLE_REGROW_SECONDS
          : CROP_GROW_SECONDS[t.crop.kind];
      const rate = (1 / baseSeconds) * cropGrowMult(state, t);
      t.crop.growth = Math.min(1, t.crop.growth + rate * dt);
    }
    if (!wasRipe && t.crop.growth >= 1) {
      events.push({ type: 'tile_changed', row: t.row, col: t.col });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function tick(state: GameState, dt: number): GameEvent[] {
  if (state.paused) return [];
  const prevSeason = currentSeason(state.time);
  state.time += dt;
  const season = currentSeason(state.time);
  const events: GameEvent[] = [];
  if (season !== prevSeason) events.push({ type: 'season_changed', season });

  events.push(...updatePlayer(state, dt));
  events.push(...updateWeather(state));
  events.push(...updateCrops(state, dt));

  for (const d of state.defenses) {
    tickCat(state, d, dt);
    tickBeehive(state, d);
  }

  // Spawn pests on a timer — no spawns in winter, faster in summer.
  if (season !== 'winter' && state.time >= state.nextPestAt) {
    const pest = spawnPest(state);
    state.pests.push(pest);
    events.push({ type: 'pest_added', id: pest.id });
    const spawnMult = season === 'summer' ? SUMMER_PEST_MULT : 1;
    const interval = (PEST_SPAWN_MIN + Math.random() * (PEST_SPAWN_MAX - PEST_SPAWN_MIN)) / spawnMult;
    state.nextPestAt = state.time + interval;
  } else if (season === 'winter') {
    // Keep pushing the timer so pests don't surge at spring start.
    if (state.time >= state.nextPestAt) state.nextPestAt = state.time + PEST_SPAWN_MAX;
  }

  const keep: Pest[] = [];
  for (const p of state.pests) {
    const pestEvents = tickPest(state, p, dt);
    events.push(...pestEvents);
    if (!pestEvents.some((e) => e.type === 'pest_removed' && e.id === p.id)) keep.push(p);
  }
  state.pests = keep;

  return events;
}

// ---------------------------------------------------------------------------
// Save / load helpers
// ---------------------------------------------------------------------------

/** Deep-clone state via JSON round-trip. Keeps things simple and serialisable. */
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
