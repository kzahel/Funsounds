import { describe, it, expect } from 'vitest';
import { Dir, EXIT_BIT, hasExit } from './types';
import type { Tool } from './types';
import { createGameState, processAction, tileAt, findAnimalNear } from './engine';

const PLACE_TRACK: Tool = { kind: 'track' };

function place(state: ReturnType<typeof createGameState>, row: number, col: number, tool: Tool = PLACE_TRACK) {
  return processAction(state, { type: 'place', row, col, tool, time: 0 });
}

describe('createGameState', () => {
  it('builds a grid of the requested size', () => {
    const s = createGameState({ rows: 5, cols: 8 });
    expect(s.tiles).toHaveLength(40);
    expect(tileAt(s, 0, 0)?.terrain).toBe('grass');
    expect(tileAt(s, 4, 7)?.col).toBe(7);
  });

  it('starts with no trains and no animals', () => {
    const s = createGameState();
    expect(s.trains).toHaveLength(0);
    expect(s.animals).toHaveLength(0);
  });
});

describe('track placement', () => {
  it('places a horizontal straight on a lone tile', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    place(s, 1, 1);
    const tile = tileAt(s, 1, 1)!;
    expect(tile.track).not.toBeNull();
    expect(hasExit(tile.track!, Dir.E)).toBe(true);
    expect(hasExit(tile.track!, Dir.W)).toBe(true);
    expect(hasExit(tile.track!, Dir.N)).toBe(false);
    expect(hasExit(tile.track!, Dir.S)).toBe(false);
  });

  it('connects two adjacent tracks horizontally', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    place(s, 1, 1);
    place(s, 1, 2);
    const a = tileAt(s, 1, 1)!.track!;
    const b = tileAt(s, 1, 2)!.track!;
    expect(hasExit(a, Dir.E)).toBe(true);
    expect(hasExit(b, Dir.W)).toBe(true);
  });

  it('forms an L-curve at a corner', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    place(s, 1, 1);
    place(s, 1, 2);
    place(s, 2, 2);
    const corner = tileAt(s, 1, 2)!.track!;
    // (1,2) connects W (to 1,1) and S (to 2,2)
    expect(hasExit(corner, Dir.W)).toBe(true);
    expect(hasExit(corner, Dir.S)).toBe(true);
    expect(hasExit(corner, Dir.E)).toBe(false);
    expect(hasExit(corner, Dir.N)).toBe(false);
  });

  it('refuses to place track on water', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'terrain', terrain: 'water' }, time: 0 });
    place(s, 1, 1);
    expect(tileAt(s, 1, 1)!.track).toBeNull();
  });
});

describe('terrain placement', () => {
  it('refuses to place water under existing track (no bridge)', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    place(s, 1, 1);
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'terrain', terrain: 'water' }, time: 0 });
    expect(tileAt(s, 1, 1)!.terrain).toBe('grass');
  });

  it('allows water under bridge tracks', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'bridge' }, time: 0 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'terrain', terrain: 'water' }, time: 0 });
    expect(tileAt(s, 1, 1)!.terrain).toBe('water');
    expect(tileAt(s, 1, 1)!.decoration).toBe('bridge');
  });
});

describe('erase', () => {
  it('removes a track and reorients corner neighbours', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    // Build an L: (1,1) -> (1,2) -> (2,2)
    place(s, 1, 1);
    place(s, 1, 2);
    place(s, 2, 2);
    // Corner (1,2) connects W and S
    expect(hasExit(tileAt(s, 1, 2)!.track!, Dir.S)).toBe(true);
    processAction(s, { type: 'erase', row: 2, col: 2 });
    expect(tileAt(s, 2, 2)!.track).toBeNull();
    // Corner now has only the W neighbour, so its S connection must be gone
    expect(hasExit(tileAt(s, 1, 2)!.track!, Dir.S)).toBe(false);
  });
});

describe('trains', () => {
  it('places a train on a track tile', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    place(s, 1, 1);
    place(s, 1, 2);
    place(s, 1, 3);
    const events = processAction(s, {
      type: 'place', row: 1, col: 1,
      tool: { kind: 'train', train: 'steam', length: 2 },
      time: 0,
    });
    expect(s.trains).toHaveLength(1);
    expect(s.trains[0].cars).toHaveLength(2);
    expect(events.some((e) => e.type === 'train_added')).toBe(true);
  });

  it('refuses to place a train on a tile with no track', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    processAction(s, {
      type: 'place', row: 1, col: 1,
      tool: { kind: 'train', train: 'steam', length: 2 }, time: 0,
    });
    expect(s.trains).toHaveLength(0);
  });

  it('train moves along a straight track over time', () => {
    const s = createGameState({ rows: 4, cols: 8 });
    for (let c = 0; c < 8; c++) place(s, 1, c);
    processAction(s, {
      type: 'place', row: 1, col: 0,
      tool: { kind: 'train', train: 'steam', length: 1 }, time: 0,
    });
    const car = s.trains[0].cars[0];
    const startCol = car.col;
    // Run a few seconds of simulation
    for (let i = 0; i < 30; i++) {
      processAction(s, { type: 'tick', dt: 0.1, time: i * 100 });
    }
    expect(s.trains[0].cars[0].col).toBeGreaterThan(startCol);
  });
});

describe('animals', () => {
  it('places an animal at the centre of the tile', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    processAction(s, {
      type: 'place', row: 2, col: 3,
      tool: { kind: 'animal', animal: 'cow' }, time: 0,
    });
    expect(s.animals).toHaveLength(1);
    expect(s.animals[0].x).toBeCloseTo(3.5);
    expect(s.animals[0].y).toBeCloseTo(2.5);
    expect(s.animals[0].kind).toBe('cow');
  });

  it('refuses to place an animal on water', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    processAction(s, { type: 'place', row: 2, col: 3, tool: { kind: 'terrain', terrain: 'water' }, time: 0 });
    processAction(s, { type: 'place', row: 2, col: 3, tool: { kind: 'animal', animal: 'cow' }, time: 0 });
    expect(s.animals).toHaveLength(0);
  });

  it('animals stay within bounds when ticked many times', () => {
    const s = createGameState({ rows: 6, cols: 6 });
    processAction(s, { type: 'place', row: 3, col: 3, tool: { kind: 'animal', animal: 'sheep' }, time: 0 });
    for (let i = 0; i < 200; i++) {
      processAction(s, { type: 'tick', dt: 0.05, time: i * 50 });
    }
    const a = s.animals[0];
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThan(6);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeLessThan(6);
  });
});

describe('clear_all', () => {
  it('removes all tracks, trains, and animals', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    place(s, 1, 1);
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'train', train: 'steam', length: 1 }, time: 0 });
    processAction(s, { type: 'place', row: 0, col: 0, tool: { kind: 'animal', animal: 'cow' }, time: 0 });
    processAction(s, { type: 'clear_all' });
    expect(s.trains).toHaveLength(0);
    expect(s.animals).toHaveLength(0);
    expect(s.tiles.every((t) => t.track === null)).toBe(true);
  });
});

describe('select_tool', () => {
  it('updates selectedTab and selectedTool', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    const tool: Tool = { kind: 'animal', animal: 'pig' };
    processAction(s, { type: 'select_tool', tool, tab: 'animals' });
    expect(s.selectedTab).toBe('animals');
    expect(s.selectedTool).toBe(tool);
  });
});

describe('exit bitmask helpers', () => {
  it('EXIT_BIT values are powers of two', () => {
    expect(EXIT_BIT[Dir.N]).toBe(1);
    expect(EXIT_BIT[Dir.E]).toBe(2);
    expect(EXIT_BIT[Dir.S]).toBe(4);
    expect(EXIT_BIT[Dir.W]).toBe(8);
  });
});

describe('pigeon (flying animal)', () => {
  it('can be placed on water tiles, unlike ground animals', () => {
    const s = createGameState({ rows: 4, cols: 4 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'terrain', terrain: 'water' }, time: 0 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    expect(s.animals).toHaveLength(1);
    expect(s.animals[0].kind).toBe('pigeon');
  });

  it('actually moves when ticked (no idle phase)', () => {
    const s = createGameState({ rows: 8, cols: 8 });
    processAction(s, { type: 'place', row: 4, col: 4, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    const startX = s.animals[0].x;
    const startY = s.animals[0].y;
    for (let i = 0; i < 10; i++) {
      processAction(s, { type: 'tick', dt: 0.05, time: i * 50 });
    }
    const moved = Math.hypot(s.animals[0].x - startX, s.animals[0].y - startY);
    expect(moved).toBeGreaterThan(0.05);
  });

  it('flies over water without bouncing back', () => {
    const s = createGameState({ rows: 4, cols: 8 });
    // Make a strip of water across the middle
    for (let c = 0; c < 8; c++) {
      processAction(s, { type: 'place', row: 2, col: c, tool: { kind: 'terrain', terrain: 'water' }, time: 0 });
    }
    processAction(s, { type: 'place', row: 1, col: 4, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    // Force the heading straight south so it would have to cross water
    s.animals[0].heading = Math.PI / 2;
    s.animals[0].nextDecisionAt = 1e12; // prevent re-decision
    s.animals[0].moving = true;
    s.animals[0].speed = 1;
    for (let i = 0; i < 20; i++) {
      processAction(s, { type: 'tick', dt: 0.05, time: i * 50 });
    }
    expect(s.animals[0].y).toBeGreaterThan(2);
  });
});

describe('perched animals', () => {
  it('a perched animal does not move when ticked', () => {
    const s = createGameState({ rows: 8, cols: 8 });
    processAction(s, { type: 'place', row: 4, col: 4, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    const id = s.animals[0].id;
    processAction(s, { type: 'set_animal_perched', id, perched: true });
    const startX = s.animals[0].x;
    const startY = s.animals[0].y;
    for (let i = 0; i < 50; i++) {
      processAction(s, { type: 'tick', dt: 0.05, time: i * 50 });
    }
    expect(s.animals[0].x).toBe(startX);
    expect(s.animals[0].y).toBe(startY);
  });

  it('un-perching releases the animal so it moves again', () => {
    const s = createGameState({ rows: 8, cols: 8 });
    processAction(s, { type: 'place', row: 4, col: 4, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    const id = s.animals[0].id;
    processAction(s, { type: 'set_animal_perched', id, perched: true });
    const startX = s.animals[0].x;
    processAction(s, { type: 'set_animal_perched', id, perched: false });
    for (let i = 0; i < 30; i++) {
      processAction(s, { type: 'tick', dt: 0.05, time: 1000 + i * 50 });
    }
    expect(s.animals[0].x).not.toBe(startX);
  });
});

describe('move_animal (drag)', () => {
  it('moves an animal to the requested coordinates', () => {
    const s = createGameState({ rows: 6, cols: 6 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    const id = s.animals[0].id;
    processAction(s, { type: 'move_animal', id, x: 4.2, y: 3.1 });
    expect(s.animals[0].x).toBeCloseTo(4.2);
    expect(s.animals[0].y).toBeCloseTo(3.1);
  });

  it('clamps to inside the grid', () => {
    const s = createGameState({ rows: 6, cols: 6 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    const id = s.animals[0].id;
    processAction(s, { type: 'move_animal', id, x: -5, y: 999 });
    expect(s.animals[0].x).toBeGreaterThanOrEqual(0);
    expect(s.animals[0].x).toBeLessThan(6);
    expect(s.animals[0].y).toBeGreaterThanOrEqual(0);
    expect(s.animals[0].y).toBeLessThan(6);
  });
});

describe('findAnimalNear', () => {
  it('returns the nearest animal within the radius', () => {
    const s = createGameState({ rows: 6, cols: 6 });
    processAction(s, { type: 'place', row: 1, col: 1, tool: { kind: 'animal', animal: 'cow' }, time: 0 });
    processAction(s, { type: 'place', row: 4, col: 4, tool: { kind: 'animal', animal: 'pigeon' }, time: 0 });
    const a = findAnimalNear(s, 4.4, 4.6, 1.0);
    expect(a?.kind).toBe('pigeon');
  });

  it('returns null when nothing is within the radius', () => {
    const s = createGameState({ rows: 6, cols: 6 });
    processAction(s, { type: 'place', row: 0, col: 0, tool: { kind: 'animal', animal: 'cow' }, time: 0 });
    expect(findAnimalNear(s, 5, 5, 1.0)).toBeNull();
  });
});
