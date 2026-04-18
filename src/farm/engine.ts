import {
  CROP_GROW_SECONDS,
  CROP_PRICE,
  COST_CAT,
  COST_SCARECROW,
  FLYING_PESTS,
  costToExpand,
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
} from './types';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const PLAYER_SPEED = 3.2; // tiles / sec
const PLAYER_SCARE_RADIUS = 1.6;
const CAT_SCARE_RADIUS = 1.8;
const SCARECROW_SCARE_RADIUS = 2.6;
const PEST_EAT_SECONDS = 3.0;
const PEST_SPAWN_MIN = 6;
const PEST_SPAWN_MAX = 14;
const RAIN_INTERVAL_MIN = 35;
const RAIN_INTERVAL_MAX = 70;
const RAIN_DURATION = 8;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

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
      });
    }
  }
  const center = { row: Math.floor(size.rows / 2), col: Math.floor(size.cols / 2) };
  const inventory: Inventory = { carrot: 0, tomato: 0, corn: 0, pumpkin: 0 };
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
    inventory,
    money: 10,
    arableRadius: 1,
    arableCenter: center,
    pendingCats: 0,
    pendingScarecrows: 0,
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
      if (tile.isMarket) return [];
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
      if (tile.crop) return [];
      if (tile.kind !== 'tilled' && tile.kind !== 'wet_tilled') return [];
      tile.crop = { kind: tool.crop, growth: 0, plantedAt: state.time };
      events.push({ type: 'tile_changed', row, col });
      return events;
    }
    case 'pick': {
      return harvestTile(state, row, col);
    }
    case 'place_cat': {
      if (state.pendingCats <= 0) return [];
      if (!isArable(state, row, col)) return [];
      if (tile.isMarket) return [];
      state.pendingCats -= 1;
      const d = createDefense(state, row, col, 'cat');
      state.defenses.push(d);
      events.push({ type: 'defense_added', id: d.id });
      // Auto-switch back to a useful tool if no more charges
      if (state.pendingCats <= 0) {
        state.selectedTool = { kind: 'till' };
        state.selectedTab = 'farm';
      }
      return events;
    }
    case 'place_scarecrow': {
      if (state.pendingScarecrows <= 0) return [];
      if (!isArable(state, row, col)) return [];
      if (tile.isMarket) return [];
      state.pendingScarecrows -= 1;
      const d = createDefense(state, row, col, 'scarecrow');
      state.defenses.push(d);
      events.push({ type: 'defense_added', id: d.id });
      if (state.pendingScarecrows <= 0) {
        state.selectedTool = { kind: 'till' };
        state.selectedTab = 'farm';
      }
      return events;
    }
    case 'buy_cat': {
      if (state.money < COST_CAT) {
        events.push({ type: 'purchase_failed' });
        return events;
      }
      state.money -= COST_CAT;
      state.pendingCats += 1;
      state.selectedTab = 'defense';
      state.selectedTool = { kind: 'place_cat' };
      return events;
    }
    case 'buy_scarecrow': {
      if (state.money < COST_SCARECROW) {
        events.push({ type: 'purchase_failed' });
        return events;
      }
      state.money -= COST_SCARECROW;
      state.pendingScarecrows += 1;
      state.selectedTab = 'defense';
      state.selectedTool = { kind: 'place_scarecrow' };
      return events;
    }
    case 'buy_expand': {
      const cost = costToExpand(state.arableRadius);
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

function harvestTile(state: GameState, row: number, col: number): GameEvent[] {
  const tile = tileAt(state, row, col);
  if (!tile || !tile.crop) return [];
  if (tile.crop.growth < 1) return [];
  const kind = tile.crop.kind;
  state.inventory[kind] += 1;
  tile.crop = null;
  // Tile becomes tilled (still usable) after harvest — loses wetness
  tile.kind = 'tilled';
  return [
    { type: 'harvested', crop: kind },
    { type: 'tile_changed', row, col },
  ];
}

// ---------------------------------------------------------------------------
// Defenses
// ---------------------------------------------------------------------------

function createDefense(state: GameState, row: number, col: number, kind: DefenseKind): Defense {
  return {
    id: state.nextId++,
    kind,
    x: col + 0.5,
    y: row + 0.5,
    heading: Math.random() * Math.PI * 2,
    nextDecisionAt: 0,
    moving: kind === 'cat',
  };
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

// ---------------------------------------------------------------------------
// Pests
// ---------------------------------------------------------------------------

function spawnPest(state: GameState): Pest {
  // Pick a random edge and spawn just outside
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

/** Find the nearest ripe-or-growing crop to (x, y). Returns null if none. */
function findTargetCrop(state: GameState, x: number, y: number): { row: number; col: number } | null {
  let best: { row: number; col: number } | null = null;
  let bestD2 = Infinity;
  for (const t of state.tiles) {
    if (!t.crop) continue;
    // Prefer ripe; growing is still a snack
    const cx = t.col + 0.5;
    const cy = t.row + 0.5;
    const d2 = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    // Ripe is much more attractive
    const weight = t.crop.growth >= 1 ? 1 : 2.2;
    const score = d2 * weight;
    if (score < bestD2) {
      bestD2 = score;
      best = { row: t.row, col: t.col };
    }
  }
  return best;
}

/** Return the shortest squared distance to any active threat (player if moving, cat, scarecrow). */
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
  // Player is a threat when moving
  const p = state.player;
  const pMoving = p.moving.up || p.moving.down || p.moving.left || p.moving.right;
  if (pMoving) consider(p.x, p.y, PLAYER_SCARE_RADIUS);
  for (const d of state.defenses) {
    if (d.kind === 'cat') consider(d.x, d.y, CAT_SCARE_RADIUS);
    else consider(d.x, d.y, SCARECROW_SCARE_RADIUS);
  }
  return best;
}

function tickPest(state: GameState, pest: Pest, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  const flying = FLYING_PESTS.has(pest.kind);

  // Check threats first — if any, flee. Fleeing is sticky: once scared,
  // the pest keeps running until it escapes off-map (see removal below).
  const threat = threatProximity(state, pest.x, pest.y);
  if (threat) {
    pest.fleeing = true;
    pest.eating = false;
    pest.target = null;
    // Head away from threat
    pest.heading = Math.atan2(pest.y - threat.ty, pest.x - threat.tx);
  }

  // Eating behaviour
  if (pest.eating && pest.target) {
    const tile = tileAt(state, pest.target.row, pest.target.col);
    if (!tile || !tile.crop) {
      pest.eating = false;
      pest.target = null;
    } else if (state.time - pest.eatStartedAt >= PEST_EAT_SECONDS) {
      // Finished eating
      tile.crop = null;
      events.push({ type: 'crop_eaten', row: tile.row, col: tile.col });
      events.push({ type: 'tile_changed', row: tile.row, col: tile.col });
      pest.eating = false;
      pest.target = null;
    }
    // Even while "eating", allow fleeing to move away
    if (!pest.fleeing) return events;
  }

  // Acquire target if none
  if (!pest.target && !pest.fleeing) {
    pest.target = findTargetCrop(state, pest.x, pest.y);
    if (pest.target) {
      const tx = pest.target.col + 0.5;
      const ty = pest.target.row + 0.5;
      pest.heading = Math.atan2(ty - pest.y, tx - pest.x);
    } else {
      // No crops anywhere — wander toward centre
      const tx = state.size.cols / 2;
      const ty = state.size.rows / 2;
      pest.heading = Math.atan2(ty - pest.y, tx - pest.x);
    }
  }

  // If not fleeing and target still valid, re-aim each tick (crops don't move but threats push us off course)
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

  // Move along heading
  const nx = pest.x + Math.cos(pest.heading) * pest.speed * dt;
  const ny = pest.y + Math.sin(pest.heading) * pest.speed * dt;

  // Fleeing pests escape off-map — remove them once gone
  if (pest.fleeing) {
    pest.x = nx;
    pest.y = ny;
    if (nx < -0.5 || nx > state.size.cols + 0.5 || ny < -0.5 || ny > state.size.rows + 0.5) {
      events.push({ type: 'pest_removed', id: pest.id });
    }
    return events;
  }

  // Stay on map when hunting
  pest.x = Math.max(0.1, Math.min(state.size.cols - 0.1, nx));
  pest.y = Math.max(0.1, Math.min(state.size.rows - 0.1, ny));
  void flying;
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
    const nx = p.x + vx * p.speed * dt;
    const ny = p.y + vy * p.speed * dt;
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
  // Walk-over harvest
  const tile = tileAt(state, row, col);
  if (tile && tile.crop && tile.crop.growth >= 1) {
    events.push(...harvestTile(state, row, col));
  }
  // Walk onto market -> sell inventory
  if (tile && tile.isMarket) {
    const sale = sellAll(state);
    if (sale > 0) events.push({ type: 'sold', amount: sale });
  }
  return events;
}

function sellAll(state: GameState): number {
  let total = 0;
  for (const k of Object.keys(state.inventory) as CropKind[]) {
    total += state.inventory[k] * CROP_PRICE[k];
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
    // Rain just ended
    events.push({ type: 'rain_end' });
    state.rainUntil = -1;
    state.nextRainAt = state.time + RAIN_INTERVAL_MIN + Math.random() * (RAIN_INTERVAL_MAX - RAIN_INTERVAL_MIN);
  } else if (state.rainUntil < 0 && state.time >= state.nextRainAt) {
    state.rainUntil = state.time + RAIN_DURATION;
    events.push({ type: 'rain_start' });
    // Rain waters all tilled tiles
    for (const t of state.tiles) {
      if (t.kind === 'tilled') {
        t.kind = 'wet_tilled';
        events.push({ type: 'tile_changed', row: t.row, col: t.col });
      }
    }
  }
  return events;
}

function updateCrops(state: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  const rate = 1 / CROP_GROW_SECONDS;
  for (const t of state.tiles) {
    if (!t.crop) continue;
    const wasRipe = t.crop.growth >= 1;
    if (t.kind === 'wet_tilled') {
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
  state.time += dt;
  const events: GameEvent[] = [];
  events.push(...updatePlayer(state, dt));
  events.push(...updateWeather(state));
  events.push(...updateCrops(state, dt));

  for (const d of state.defenses) tickCat(state, d, dt);

  // Spawn pests on a timer
  if (state.time >= state.nextPestAt) {
    const pest = spawnPest(state);
    state.pests.push(pest);
    events.push({ type: 'pest_added', id: pest.id });
    state.nextPestAt = state.time + PEST_SPAWN_MIN + Math.random() * (PEST_SPAWN_MAX - PEST_SPAWN_MIN);
  }

  // Tick pests; remove any that escaped
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
// Small helpers exposed for tests
// ---------------------------------------------------------------------------

export function inventoryTotal(inv: Inventory): number {
  return inv.carrot + inv.tomato + inv.corn + inv.pumpkin;
}

export function setFacing(player: Player, facing: Facing): void {
  player.facing = facing;
}
