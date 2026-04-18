import { describe, it, expect } from 'vitest';
import { createGameState, processAction, tileAt, isArable } from './engine';
import { CROP_PRICE, COST_CAT, COST_SCARECROW } from './types';
import type { Tool } from './types';

const TILL: Tool = { kind: 'till' };
const WATER: Tool = { kind: 'water' };
const SEED_CARROT: Tool = { kind: 'seed', crop: 'carrot' };
const PICK: Tool = { kind: 'pick' };

function place(state: ReturnType<typeof createGameState>, row: number, col: number, tool: Tool) {
  return processAction(state, { type: 'place', row, col, tool });
}

function tickN(state: ReturnType<typeof createGameState>, seconds: number, dt: number = 0.1): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) processAction(state, { type: 'tick', dt });
}

describe('createGameState', () => {
  it('builds a grid, player at centre, and one market tile', () => {
    const s = createGameState({ rows: 6, cols: 8 });
    expect(s.tiles).toHaveLength(48);
    const markets = s.tiles.filter((t) => t.isMarket);
    expect(markets).toHaveLength(1);
    expect(s.player.x).toBeCloseTo(4.5);
    expect(s.player.y).toBeCloseTo(3.5);
    expect(s.money).toBeGreaterThan(0);
  });
});

describe('arable gating', () => {
  it('till fails outside arable radius', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    // Far corner should be outside
    expect(isArable(s, 0, 0)).toBe(false);
    place(s, 0, 0, TILL);
    expect(tileAt(s, 0, 0)!.kind).toBe('grass');
  });

  it('till works inside arable radius', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    const c = s.arableCenter;
    expect(isArable(s, c.row, c.col)).toBe(true);
    place(s, c.row, c.col, TILL);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('tilled');
  });
});

describe('crop lifecycle', () => {
  it('till → water → seed → grow → ripe', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9; // disable pests for this test
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('wet_tilled');
    place(s, c.row, c.col, SEED_CARROT);
    expect(tileAt(s, c.row, c.col)!.crop?.kind).toBe('carrot');
    // Move player off the crop tile so walk-over auto-harvest doesn't fire
    s.player.x = 0.5;
    s.player.y = 0.5;
    // Tick ~70 seconds — growth should complete
    tickN(s, 70);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBeGreaterThanOrEqual(1);
  });

  it('does not grow on dry (tilled-but-not-wet) soil', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, SEED_CARROT);
    // 10s of ticks — growth stays 0 since soil is dry
    tickN(s, 10);
    expect(tileAt(s, c.row, c.col)!.crop!.growth).toBe(0);
  });

  it('seed refuses on grass (must be tilled first)', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    const c = s.arableCenter;
    place(s, c.row, c.col, SEED_CARROT);
    expect(tileAt(s, c.row, c.col)!.crop).toBeNull();
  });
});

describe('harvest & market', () => {
  it('pick tool harvests a ripe crop into inventory', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_CARROT);
    s.player.x = 0.5;
    s.player.y = 0.5;
    tickN(s, 65);
    place(s, c.row, c.col, PICK);
    expect(s.inventory.carrot).toBe(1);
    expect(tileAt(s, c.row, c.col)!.crop).toBeNull();
    expect(tileAt(s, c.row, c.col)!.kind).toBe('tilled');
  });

  it('pick tool does nothing on unripe crops', () => {
    const s = createGameState({ rows: 9, cols: 9 });
    s.nextPestAt = 1e9;
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_CARROT);
    tickN(s, 5);
    place(s, c.row, c.col, PICK);
    expect(s.inventory.carrot).toBe(0);
    expect(tileAt(s, c.row, c.col)!.crop).not.toBeNull();
  });

  it('walking onto market tile sells inventory', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.inventory.carrot = 3;
    s.inventory.tomato = 2;
    const startMoney = s.money;
    // Teleport player onto market tile, then tick once to trigger collision check
    s.player.x = 12.5;
    s.player.y = 0.5;
    processAction(s, { type: 'tick', dt: 0.01 });
    expect(s.inventory.carrot).toBe(0);
    expect(s.inventory.tomato).toBe(0);
    expect(s.money).toBe(startMoney + 3 * CROP_PRICE.carrot + 2 * CROP_PRICE.tomato);
  });
});

describe('player movement', () => {
  it('movement moves player in world space', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    const startX = s.player.x;
    processAction(s, { type: 'set_player_moving', dir: 'right', moving: true });
    tickN(s, 1);
    expect(s.player.x).toBeGreaterThan(startX);
  });

  it('walking over a ripe crop harvests it', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.nextPestAt = 1e9;
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, SEED_CARROT);
    // Park player in the corner while the crop grows
    s.player.x = 0.5;
    s.player.y = 0.5;
    tickN(s, 65);
    // Now teleport player onto the crop tile
    s.player.x = c.col + 0.5;
    s.player.y = c.row + 0.5;
    processAction(s, { type: 'tick', dt: 0.01 });
    expect(s.inventory.carrot).toBe(1);
  });
});

describe('shop', () => {
  it('buying a cat deducts money and adds a charge', () => {
    const s = createGameState();
    s.money = 100;
    place(s, 0, 0, { kind: 'buy_cat' });
    expect(s.money).toBe(100 - COST_CAT);
    expect(s.pendingCats).toBe(1);
  });

  it('buying with insufficient money emits purchase_failed', () => {
    const s = createGameState();
    s.money = 5;
    const events = place(s, 0, 0, { kind: 'buy_cat' });
    expect(events.some((e) => e.type === 'purchase_failed')).toBe(true);
    expect(s.pendingCats).toBe(0);
  });

  it('placing a cat consumes a pending charge', () => {
    const s = createGameState();
    s.money = 200;
    place(s, 0, 0, { kind: 'buy_cat' });
    const c = s.arableCenter;
    place(s, c.row, c.col, { kind: 'place_cat' });
    expect(s.pendingCats).toBe(0);
    expect(s.defenses).toHaveLength(1);
  });

  it('expanding farm increases arable radius', () => {
    const s = createGameState();
    s.money = 500;
    const r0 = s.arableRadius;
    place(s, 0, 0, { kind: 'buy_expand' });
    expect(s.arableRadius).toBe(r0 + 1);
  });

  it('scarecrow buy + place costs the right amount', () => {
    const s = createGameState();
    s.money = COST_SCARECROW;
    place(s, 0, 0, { kind: 'buy_scarecrow' });
    expect(s.pendingScarecrows).toBe(1);
    expect(s.money).toBe(0);
    const c = s.arableCenter;
    place(s, c.row, c.col, { kind: 'place_scarecrow' });
    expect(s.defenses).toHaveLength(1);
    expect(s.defenses[0].kind).toBe('scarecrow');
  });
});

describe('pests', () => {
  it('pests spawn after their timer', () => {
    const s = createGameState();
    s.nextPestAt = 1;
    tickN(s, 2);
    expect(s.pests.length).toBeGreaterThanOrEqual(1);
  });

  it('a pest near a crop eats it after eating duration', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    place(s, c.row, c.col, WATER);
    place(s, c.row, c.col, { kind: 'seed', crop: 'carrot' });
    // Manually place a pest right on top of the crop
    s.pests.push({
      id: 99,
      kind: 'rabbit',
      x: c.col + 0.5,
      y: c.row + 0.5,
      target: null,
      eating: false,
      eatStartedAt: 0,
      fleeing: false,
      heading: 0,
      speed: 1,
    });
    // Push spawn timer far so no new pests appear
    s.nextPestAt = 10_000;
    tickN(s, 6);
    expect(tileAt(s, c.row, c.col)!.crop).toBeNull();
  });

  it('moving player scares nearby pests away (they flee)', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    s.nextPestAt = 10_000;
    // Place pest very close to player
    s.pests.push({
      id: 99,
      kind: 'rabbit',
      x: s.player.x + 0.5,
      y: s.player.y,
      target: null,
      eating: false,
      eatStartedAt: 0,
      fleeing: false,
      heading: 0,
      speed: 1,
    });
    processAction(s, { type: 'set_player_moving', dir: 'left', moving: true });
    tickN(s, 0.5);
    expect(s.pests[0].fleeing).toBe(true);
  });
});

describe('weather', () => {
  it('rain start waters all tilled tiles', () => {
    const s = createGameState({ rows: 9, cols: 13 });
    const c = s.arableCenter;
    place(s, c.row, c.col, TILL);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('tilled');
    // Force rain to start on next tick
    s.nextRainAt = 0.5;
    tickN(s, 1);
    expect(tileAt(s, c.row, c.col)!.kind).toBe('wet_tilled');
  });
});

describe('tool selection', () => {
  it('updates selectedTab and selectedTool', () => {
    const s = createGameState();
    const tool: Tool = { kind: 'seed', crop: 'tomato' };
    processAction(s, { type: 'select_tool', tool, tab: 'seeds' });
    expect(s.selectedTab).toBe('seeds');
    expect(s.selectedTool).toBe(tool);
  });
});
