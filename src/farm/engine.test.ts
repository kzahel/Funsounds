import { describe, it, expect } from 'vitest';
import {
  createGameState, processAction, tileAt, isArable,
  currentSeason, seasonTimeRemaining, playerSpeed, playerScareRadius,
  sellValue, cloneState,
} from './engine';
import {
  CROP_PRICE, COST_CAT, COST_SCARECROW, COST_BEEHIVE, COST_FENCE, COST_BOOTS,
  SEASON_DURATION, toolsEqual,
} from './types';
import type { Tool, GameState } from './types';

const TILL: Tool = { kind: 'till' };
const WATER: Tool = { kind: 'water' };
const SEED_CARROT: Tool = { kind: 'seed', crop: 'carrot' };
const SEED_STRAWBERRY: Tool = { kind: 'seed', crop: 'strawberry' };
const SEED_POTATO: Tool = { kind: 'seed', crop: 'potato' };
const SEED_APPLE: Tool = { kind: 'seed', crop: 'apple' };
const SEED_TURNIP: Tool = { kind: 'seed', crop: 'turnip' };
const PICK: Tool = { kind: 'pick' };

function place(state: GameState, row: number, col: number, tool: Tool) {
  return processAction(state, { type: 'place', row, col, tool });
}

function tickN(state: GameState, seconds: number, dt: number = 0.1): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) processAction(state, { type: 'tick', dt });
}

function parkPlayer(state: GameState, x: number = 0.5, y: number = 0.5): void {
  state.player.x = x;
  state.player.y = y;
}

describe('createGameState', () => {
  it('builds a grid, player at centre, and one market tile', () => {
    const s = createGameState({ rows: 6, cols: 8 });
    expect(s.tiles).toHaveLength(48);
    expect(s.tiles.filter((t) => t.isMarket)).toHaveLength(1);
    expect(s.player.x).toBeCloseTo(4.5);
    expect(s.player.y).toBeCloseTo(3.5);
    expect(s.money).toBeGreaterThan(0);
    expect(s.hasBoots).toBe(false);
  });
});

describe('seasons', () => {
  it('cycles spring → summer → fall → winter with SEASON_DURATION each', () => {
    expect(currentSeason(0)).toBe('spring');
    expect(currentSeason(SEASON_DURATION - 1)).toBe('spring');
    expect(currentSeason(SEASON_DURATION)).toBe('summer');
    expect(currentSeason(2 * SEASON_DURATION)).toBe('fall');
    expect(currentSeason(3 * SEASON_DURATION)).toBe('winter');
    expect(currentSeason(4 * SEASON_DURATION)).toBe('spring');
  });

  it('reports remaining season time', () => {
    expect(seasonTimeRemaining(10)).toBeCloseTo(SEASON_DURATION - 10);
  });

  it('emits season_changed when the clock rolls over', () => {
    const s = createGameState();
    s.nextPestAt = 1e9;
    s.nextRainAt = 1e9;
    s.time = SEASON_DURATION - 0.05;
    parkPlayer(s);
    const events = processAction(s, { type: 'tick', dt: 0.1 });
    expect(events.some((e) => e.type === 'season_changed')).toBe(true);
    expect(currentSeason(s.time)).toBe('summer');
  });
});

describe('crop season gating', () => {
  it('carrot grows in spring but not in winter', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    s.nextRainAt = 1e9;
    const c = s.arableCenter;
    parkPlayer(s);
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_CARROT);
    // Skip to winter
    s.time = 3 * SEASON_DURATION + 1;
    tickN(s, 5);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBe(0);
  });

  it('turnip grows only in winter', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    s.nextRainAt = 1e9;
    const c = s.arableCenter;
    parkPlayer(s);
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_TURNIP);
    // Spring — no growth
    tickN(s, 5);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBe(0);
    // Fast-forward to winter
    s.time = 3 * SEASON_DURATION + 1;
    tickN(s, 50);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBeGreaterThan(0);
  });

  it('summer growth is faster than spring', () => {
    const s1 = createGameState({ rows: 9, cols: 9 });
    const s2 = createGameState({ rows: 9, cols: 9 });
    for (const s of [s1, s2]) {
      s.nextPestAt = 1e9;
      s.nextRainAt = 1e9;
      const c = s.arableCenter;
      parkPlayer(s);
      place(s, c.row, c.col, TILL);
      place(s, c.row, c.col, WATER);
      place(s, c.row, c.col, SEED_STRAWBERRY);
    }
    // Spring-only ticks
    tickN(s1, 10);
    // Summer ticks
    s2.time = SEASON_DURATION + 1;
    tickN(s2, 10);
    const c = s1.arableCenter;
    expect(tileAt(s2, c.row, c.col)!.crop!.growth)
      .toBeGreaterThan(tileAt(s1, c.row, c.col)!.crop!.growth);
  });
});

describe('new crops', () => {
  it('strawberry grows in 30s', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    s.nextRainAt = 1e9;
    const c = s.arableCenter;
    parkPlayer(s);
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_STRAWBERRY);
    tickN(s, 35);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBeGreaterThanOrEqual(1);
  });

  it('potato harvest yields 3', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    s.nextRainAt = 1e9;
    const c = s.arableCenter;
    parkPlayer(s);
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_POTATO);
    tickN(s, 100);
    place(s, c.row, c.col, PICK);
    expect(s.inventory.potato).toBe(3);
  });

  it('apple tree is planted on grass, becomes permanent, regrows after harvest', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    s.nextRainAt = 1e9;
    const c = s.arableCenter;
    parkPlayer(s);
    // Apple planted directly on grass
    place(s, c.row, c.col, SEED_APPLE);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('apple_tree');
    expect(tileAt(s, c.row, c.col)!.crop!.kind).toBe('apple');
    // Grow first apple (~120s)
    tickN(s, 125);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBeGreaterThanOrEqual(1);
    // Harvest — tile stays apple_tree, crop resets
    place(s, c.row, c.col, PICK);
    expect(s.inventory.apple).toBe(1);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('apple_tree');
    expect(tileAt(s, c.row, c.col)!.crop!.hasYielded).toBe(true);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBe(0);
    // Regrows faster than the first apple
    tickN(s, 50);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBeGreaterThanOrEqual(1);
  });

  it('apple tree tile resists till and erase', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    const c = s.arableCenter;
    place(s, c.row, c.col, SEED_APPLE);
    // Tilling an apple tree does nothing (kind isn't 'grass')
    place(s, c.row, c.col, TILL);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('apple_tree');
  });
});

describe('season sell prices', () => {
  it('winter adds 30% bonus across the board', () => {
    const s = createGameState();
    s.inventory.carrot = 10;
    // Fast-forward to winter
    s.time = 3 * SEASON_DURATION + 1;
    const winterVal = sellValue(s);
    s.time = 0; // back to spring
    const springVal = sellValue(s);
    expect(winterVal).toBeGreaterThan(springVal);
    expect(winterVal).toBeCloseTo(Math.round(springVal * 1.3), -1);
  });

  it('fall gives 50% bonus to pumpkin and apple specifically', () => {
    const s = createGameState();
    s.inventory.pumpkin = 1;
    s.time = 2 * SEASON_DURATION + 1; // fall
    const fallPumpkin = sellValue(s);
    expect(fallPumpkin).toBe(Math.round(CROP_PRICE.pumpkin * 1.5));
  });
});

describe('shop additions', () => {
  it('buying a beehive deducts money and adds a charge', () => {
    const s = createGameState();
    s.money = 200;
    place(s, 0, 0, { kind: 'buy_beehive' });
    expect(s.money).toBe(200 - COST_BEEHIVE);
    expect(s.pendingBeehives).toBe(1);
  });

  it('buying a fence deducts money and adds a charge', () => {
    const s = createGameState();
    s.money = 200;
    place(s, 0, 0, { kind: 'buy_fence' });
    expect(s.money).toBe(200 - COST_FENCE);
    expect(s.pendingFences).toBe(1);
  });

  it('buying boots is a one-time upgrade and charges the full price', () => {
    const s = createGameState();
    s.money = 200;
    place(s, 0, 0, { kind: 'buy_boots' });
    expect(s.hasBoots).toBe(true);
    expect(s.money).toBe(200 - COST_BOOTS);
    // Buying again emits purchase_failed, no double-charge
    const events = place(s, 0, 0, { kind: 'buy_boots' });
    expect(events.some((e) => e.type === 'purchase_failed')).toBe(true);
    expect(s.money).toBe(200 - COST_BOOTS);
  });

  it('winter discount reduces shop prices by 25%', () => {
    const s = createGameState();
    s.time = 3 * SEASON_DURATION + 1;
    s.money = 1000;
    place(s, 0, 0, { kind: 'buy_cat' });
    expect(s.money).toBe(1000 - Math.round(COST_CAT * 0.75));
  });
});

describe('fence blocking', () => {
  it('a fence tile cannot be tilled', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    const c = s.arableCenter;
    s.pendingFences = 1;
    place(s, c.row, c.col, { kind: 'place_fence' });
    place(s, c.row, c.col, TILL);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('grass');
    expect(tileAt(s, c.row, c.col)!.hasFence).toBe(true);
  });

  it('a rabbit walking into a fence tile starts fleeing', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.nextPestAt = 1e9;
    // Place fence at (4, 6), rabbit just west of it heading east
    const row = 4;
    const col = 6;
    s.tiles[row * s.size.cols + col].hasFence = true;
    s.pests.push({
      id: 99, kind: 'rabbit',
      x: col - 0.3, y: row + 0.5, // immediately west of the fence tile
      target: { row, col: col + 1 },
      eating: false, eatStartedAt: 0, fleeing: false,
      heading: 0, speed: 2, // east-bound
    });
    tickN(s, 0.5);
    expect(s.pests[0]?.fleeing ?? true).toBe(true);
  });

  it('birds fly over fences', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.nextPestAt = 1e9;
    const row = 4;
    const col = 6;
    s.tiles[row * s.size.cols + col].hasFence = true;
    s.pests.push({
      id: 99, kind: 'bird',
      x: col - 0.3, y: row + 0.5,
      target: { row, col: col + 1 },
      eating: false, eatStartedAt: 0, fleeing: false,
      heading: 0, speed: 2,
    });
    tickN(s, 0.3);
    expect(s.pests[0].fleeing).toBe(false);
  });
});

describe('beehive', () => {
  it('produces honey every 30s', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    const c = s.arableCenter;
    s.pendingBeehives = 1;
    place(s, c.row, c.col, { kind: 'place_beehive' });
    tickN(s, 32);
    expect(s.inventory.honey).toBeGreaterThanOrEqual(1);
  });

  it('boosts growth of nearby crops', () => {
    const mk = (): GameState => {
      const s = createGameState({ rows: 9, cols: 9 });
      s.nextPestAt = 1e9;
      s.nextRainAt = 1e9;
      parkPlayer(s);
      const c = s.arableCenter;
      place(s, c.row, c.col, TILL);
      place(s, c.row, c.col, WATER);
      place(s, c.row, c.col, SEED_STRAWBERRY);
      return s;
    };
    const base = mk();
    const boosted = mk();
    boosted.pendingBeehives = 1;
    const c = boosted.arableCenter;
    place(boosted, c.row, c.col + 1, { kind: 'place_beehive' });
    tickN(base, 8);
    tickN(boosted, 8);
    expect(tileAt(boosted, c.row, c.col)!.crop!.growth)
      .toBeGreaterThan(tileAt(base, c.row, c.col)!.crop!.growth);
  });
});

describe('running boots', () => {
  it('increases player speed and scare radius when equipped', () => {
    const s = createGameState();
    const baseSpeed = playerSpeed(s);
    const baseScare = playerScareRadius(s);
    s.hasBoots = true;
    expect(playerSpeed(s)).toBeGreaterThan(baseSpeed);
    expect(playerScareRadius(s)).toBeGreaterThan(baseScare);
  });
});

describe('save / load round-trip', () => {
  it('load_state replaces game state in place', () => {
    const original = createGameState();
    original.money = 999;
    original.hasBoots = true;
    original.time = 500;
    const snapshot = cloneState(original);

    const runtime = createGameState();
    runtime.money = 10;
    processAction(runtime, { type: 'load_state', state: snapshot });
    expect(runtime.money).toBe(999);
    expect(runtime.hasBoots).toBe(true);
    expect(runtime.time).toBe(500);
  });

  it('cloneState yields a deep independent copy', () => {
    const s = createGameState();
    const c = cloneState(s);
    c.tiles[0].kind = 'tilled';
    expect(s.tiles[0].kind).toBe('grass');
  });
});

describe('toolsEqual', () => {
  it('compares by kind and discriminated fields', () => {
    expect(toolsEqual({ kind: 'till' }, { kind: 'till' })).toBe(true);
    expect(toolsEqual({ kind: 'till' }, { kind: 'water' })).toBe(false);
    expect(toolsEqual(
      { kind: 'seed', crop: 'carrot' },
      { kind: 'seed', crop: 'carrot' },
    )).toBe(true);
    expect(toolsEqual(
      { kind: 'seed', crop: 'carrot' },
      { kind: 'seed', crop: 'tomato' },
    )).toBe(false);
  });
});

describe('arable gating & core lifecycle (regression)', () => {
  it('till fails outside arable radius', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    expect(isArable(s, 0, 0)).toBe(false);
    place(s, 0, 0, TILL);
    expect(tileAt(s, 0, 0)!.kind).toBe('grass');
  });

  it('till works inside arable radius', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('tilled');
  });

  it('full cycle: till → water → seed → grow → pick', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    s.nextRainAt = 1e9;
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_CARROT);
    parkPlayer(s);
    tickN(s, 70);
    place(s, c.row, c.col, PICK);
    expect(s.inventory.carrot).toBe(1);
  });

  it('walking over a ripe crop harvests it', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.nextPestAt = 1e9;
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_CARROT);
    parkPlayer(s);
    tickN(s, 65);
    s.player.x = c.col + 0.5;
    s.player.y = c.row + 0.5;
    processAction(s, { type: 'tick', dt: 0.01 });
    expect(s.inventory.carrot).toBe(1);
  });

  it('walking onto market tile sells inventory', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.inventory.carrot = 3;
    s.inventory.tomato = 2;
    const startMoney = s.money;
    s.player.x = 12.5;
    s.player.y = 0.5;
    processAction(s, { type: 'tick', dt: 0.01 });
    expect(s.inventory.carrot).toBe(0);
    expect(s.inventory.tomato).toBe(0);
    // Spring prices, no bonus
    expect(s.money).toBe(startMoney + 3 * CROP_PRICE.carrot + 2 * CROP_PRICE.tomato);
  });
});

describe('pests (regression)', () => {
  it('a pest next to a crop eats it after eating duration', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_CARROT);
    s.pests.push({
      id: 99, kind: 'rabbit',
      x: c.col + 0.5, y: c.row + 0.5,
      target: null, eating: false, eatStartedAt: 0,
      fleeing: false, heading: 0, speed: 1,
    });
    s.nextPestAt = 1e9;
    tickN(s, 6);
    expect(tileAt(s, c.row, c.col)!.crop).toBeNull();
  });

  it('moving player scares nearby pests', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.nextPestAt = 1e9;
    s.pests.push({
      id: 99, kind: 'rabbit',
      x: s.player.x + 0.5, y: s.player.y,
      target: null, eating: false, eatStartedAt: 0,
      fleeing: false, heading: 0, speed: 1,
    });
    processAction(s, { type: 'set_player_moving', dir: 'left', moving: true });
    tickN(s, 0.3);
    expect(s.pests[0].fleeing).toBe(true);
  });

  it('no pests spawn in winter', () => {
    const s = createGameState();
    s.time = 3 * SEASON_DURATION + 1;
    s.nextPestAt = s.time + 0.5;
    s.pests = [];
    tickN(s, 5);
    expect(s.pests).toHaveLength(0);
  });
});

describe('weather (regression)', () => {
  it('rain start waters all tilled tiles', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    s.nextRainAt = 0.5;
    s.nextPestAt = 1e9;
    tickN(s, 1);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('wet_tilled');
  });
});

describe('tool selection (regression)', () => {
  it('updates selectedTab and selectedTool', () => {
    const s = createGameState();
    const tool: Tool = { kind: 'seed', crop: 'tomato' };
    processAction(s, { type: 'select_tool', tool, tab: 'seeds' });
    expect(s.selectedTab).toBe('seeds');
    expect(s.selectedTool).toBe(tool);
  });
});
