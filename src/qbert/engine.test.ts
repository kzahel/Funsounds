import { describe, it, expect } from 'vitest';
import { Direction } from './types';
import type { GameState } from './types';
import { createGameState, processAction, resolveHops, respawnPlayer, isValidPos } from './engine';

function advance(state: GameState, ms: number): number {
  return state.player.hop ? state.player.hop.startTime + state.player.hop.duration + ms : 0;
}

/** Hop the player and immediately resolve the landing. */
function hopAndLand(state: GameState, dir: Direction, time: number): number {
  processAction(state, { type: 'move', direction: dir, time });
  const landTime = time + state.level.hopDurationMs + 1;
  resolveHops(state, landTime);
  return landTime;
}

describe('isValidPos', () => {
  it('accepts positions inside the pyramid', () => {
    expect(isValidPos(7, 0, 0)).toBe(true);
    expect(isValidPos(7, 6, 6)).toBe(true);
    expect(isValidPos(7, 3, 2)).toBe(true);
  });

  it('rejects positions outside the pyramid', () => {
    expect(isValidPos(7, -1, 0)).toBe(false);
    expect(isValidPos(7, 7, 0)).toBe(false);
    expect(isValidPos(7, 2, 3)).toBe(false);
    expect(isValidPos(7, 0, 1)).toBe(false);
  });
});

describe('createGameState', () => {
  it('creates 28 cubes for a 7-row pyramid', () => {
    const state = createGameState(1, 0);
    expect(state.cubes).toHaveLength(28);
  });

  it('places player at (0,0)', () => {
    const state = createGameState(1, 0);
    expect(state.player.row).toBe(0);
    expect(state.player.col).toBe(0);
  });

  it('initializes all cubes to colorIndex 0', () => {
    const state = createGameState(1, 0);
    expect(state.cubes.every((c) => c.colorIndex === 0)).toBe(true);
  });

  it('starts with 3 lives', () => {
    const state = createGameState(1, 0);
    expect(state.lives).toBe(3);
  });
});

describe('player movement', () => {
  it('starts a hop to a valid adjacent cube', () => {
    const state = createGameState(1, 0);
    const events = processAction(state, { type: 'move', direction: Direction.DOWN_RIGHT, time: 100 });
    expect(state.player.hop).not.toBeNull();
    expect(state.player.hop!.toRow).toBe(1);
    expect(state.player.hop!.toCol).toBe(1);
    expect(events.some((e) => e.type === 'hop')).toBe(true);
  });

  it('ignores move while player is mid-hop', () => {
    const state = createGameState(1, 0);
    processAction(state, { type: 'move', direction: Direction.DOWN_LEFT, time: 100 });
    const events = processAction(state, { type: 'move', direction: Direction.DOWN_RIGHT, time: 150 });
    expect(events).toHaveLength(0);
    expect(state.player.hop!.toCol).toBe(0); // still going DOWN_LEFT
  });

  it('player falls off the pyramid when hopping off an edge', () => {
    const state = createGameState(1, 0);
    // From (0,0), UP_LEFT goes to (-1,-1) which is off the grid, no disc on level 1
    const events = processAction(state, { type: 'move', direction: Direction.UP_LEFT, time: 100 });
    expect(events.some((e) => e.type === 'player_fell')).toBe(true);
    expect(state.player.alive).toBe(false);
  });
});

describe('cube color changes', () => {
  it('increments cube color when player lands', () => {
    const state = createGameState(1, 0);
    const time = hopAndLand(state, Direction.DOWN_LEFT, 100);
    const cube = state.cubes.find((c) => c.row === 1 && c.col === 0)!;
    expect(cube.colorIndex).toBe(1);
  });

  it('detects level complete when all cubes reach target', () => {
    const state = createGameState(1, 0);
    // Set all cubes to target except one
    for (const cube of state.cubes) {
      cube.colorIndex = state.level.targetColorIndex;
    }
    // Reset the cube at (1,0) so landing there completes it
    const target = state.cubes.find((c) => c.row === 1 && c.col === 0)!;
    target.colorIndex = 0;

    const time = hopAndLand(state, Direction.DOWN_LEFT, 100);
    expect(state.phase).toBe('level_complete');
  });

  it('wraps color in revertsOnExtra mode', () => {
    const state = createGameState(7, 0); // level 7 has revertsOnExtra: true
    // Put cube at target
    const cube = state.cubes.find((c) => c.row === 1 && c.col === 0)!;
    cube.colorIndex = state.level.targetColorIndex;

    // Land on it — should wrap past target
    hopAndLand(state, Direction.DOWN_LEFT, 100);
    expect(cube.colorIndex).toBe((state.level.targetColorIndex + 1) % state.level.numColors);
  });

  it('does NOT change cube color when already at target in non-revert mode', () => {
    const state = createGameState(1, 0);
    const cube = state.cubes.find((c) => c.row === 1 && c.col === 0)!;
    cube.colorIndex = state.level.targetColorIndex;

    hopAndLand(state, Direction.DOWN_LEFT, 100);
    expect(cube.colorIndex).toBe(state.level.targetColorIndex);
  });
});

describe('enemy tick', () => {
  it('moves red_ball downward', () => {
    const state = createGameState(1, 0);
    // Move player out of the way first
    hopAndLand(state, Direction.DOWN_LEFT, 100);

    processAction(state, { type: 'spawn_enemy', enemyType: 'red_ball', time: 500 });
    expect(state.enemies).toHaveLength(1);
    expect(state.enemies[0].row).toBe(0);

    processAction(state, { type: 'enemy_tick', time: 600 });
    expect(state.enemies[0].hop).not.toBeNull();
    // Should go to row 1
    expect(state.enemies[0].hop!.toRow).toBe(1);
  });

  it('removes enemy that falls off the pyramid', () => {
    const state = createGameState(1, 0);
    // Move player out of the way
    hopAndLand(state, Direction.DOWN_LEFT, 100);

    processAction(state, { type: 'spawn_enemy', enemyType: 'red_ball', time: 500 });
    const enemy = state.enemies[0];
    // Place it at the bottom edge
    enemy.row = 6;
    enemy.col = 0;

    const events = processAction(state, { type: 'enemy_tick', time: 600 });
    // The ball may go DOWN_LEFT (7,0) or DOWN_RIGHT (7,1) — both off grid
    expect(state.enemies).toHaveLength(0);
    expect(events.some((e) => e.type === 'enemy_fell')).toBe(true);
  });

  it('coily chases the player', () => {
    const state = createGameState(3, 0);
    // Move player to (3,2)
    let t = 100;
    t = hopAndLand(state, Direction.DOWN_RIGHT, t);
    t = hopAndLand(state, Direction.DOWN_RIGHT, t);
    t = hopAndLand(state, Direction.DOWN_RIGHT, t);
    expect(state.player.row).toBe(3);
    expect(state.player.col).toBe(3);

    // Spawn a coily (already transformed) at (1,0)
    processAction(state, { type: 'spawn_enemy', enemyType: 'coily', time: t });
    state.enemies[0].row = 1;
    state.enemies[0].col = 0;

    // Tick — coily should move toward player (down-right)
    processAction(state, { type: 'enemy_tick', time: t + 100 });
    expect(state.enemies[0].hop!.toRow).toBe(2);
    expect(state.enemies[0].hop!.toCol).toBe(1);
  });
});

describe('collisions', () => {
  it('kills player when enemy lands on same cube', () => {
    const state = createGameState(1, 0);
    // Move player to (1,0)
    let t = hopAndLand(state, Direction.DOWN_LEFT, 100);

    // Spawn enemy at same position
    processAction(state, { type: 'spawn_enemy', enemyType: 'red_ball', time: t });
    state.enemies[0].row = 1;
    state.enemies[0].col = 0;
    state.enemies[0].hop = null;

    // Resolve should detect collision
    const events = resolveHops(state, t + 100);
    expect(events.some((e) => e.type === 'player_died')).toBe(true);
  });

  it('catching slick gives bonus points', () => {
    const state = createGameState(1, 0);
    let t = hopAndLand(state, Direction.DOWN_LEFT, 100);

    processAction(state, { type: 'spawn_enemy', enemyType: 'slick', time: t });
    state.enemies[0].row = 1;
    state.enemies[0].col = 0;
    state.enemies[0].hop = null;

    const scoreBefore = state.score;
    resolveHops(state, t + 100);
    expect(state.score).toBeGreaterThan(scoreBefore);
    expect(state.enemies).toHaveLength(0);
  });
});

describe('disc escape', () => {
  it('player rides disc back to top', () => {
    const state = createGameState(3, 0); // level 3 has discs
    // Disc is at row 2, right side. Position player at (2, 2) and hop DOWN_RIGHT off the edge.
    state.player.row = 2;
    state.player.col = 2;
    state.player.hop = null;
    // The disc at row 2 right should catch col > row when going DOWN_RIGHT from (2,2) to (3,3) — that's valid.
    // Actually we need to go off the right edge. From (2,2), UP_RIGHT goes to (1,2) which is valid.
    // Let's place disc at row=2, side=right. From (2,2) going... hmm.
    // row 2 has cols 0,1,2. From (2,2), DOWN_RIGHT goes to (3,3) which IS valid.
    // We need to hop off the right edge. From (2,2), UP_RIGHT goes to (1,2) which is valid (row 1 has cols 0,1).
    // Wait, row 1 has cols 0 and 1. So (1,2) is INVALID. That's off the right edge at row 1.
    // But the disc is at row 2, not row 1. Let me check — target row is 1, target col is 2. Col > row, so side = right.
    // Disc at row 2 would need to match tRow (which is 1). So no match.
    // Let's adjust: put player at a position where they can hop off to a disc row.
    // The disc for level 3 is at row 2 right and row 4 left.
    // For row 2 right: we need tRow=2 and tCol>2. From (1,1) DOWN_RIGHT → (2,2): valid. From (2,2) going UP_RIGHT → (1,2): tRow=1, not 2.
    // Actually from (1,1) going DOWN_RIGHT → (2,2): that's valid, no disc.
    // We need to reach tRow=2 and tCol=3 (col > row=2). That means from (1,2) DOWN_RIGHT → (2,3). But (1,2) is off-grid for row 1.
    // Hmm. Let's think differently. Disc at row 4 left. tRow=4, tCol<0. From (3,0) DOWN_LEFT → (4,0): valid.
    // From (3,0) UP_LEFT → (2,-1): tRow=2, tCol=-1 < 0, side=left. But disc is at row 4 or 2.
    // Disc at row 4 left: tRow must be 4. From (3,0) DOWN_LEFT → (4,0): valid, on grid.
    // From (4,0) DOWN_LEFT → (5,0): valid. From (4,0) UP_LEFT → (3,-1): tRow=3, tCol=-1 < 0, side=left but disc row is 4.
    // We need tRow=4, tCol=-1. That would come from (3,0) DOWN_LEFT where dr=1, dc=0 → (4,0)... no that's valid.
    // Wait, DOWN_LEFT delta is [1, 0]. From (3,0): (4,0) is valid.
    // UP_LEFT delta is [-1,-1]. From (5,0): (4,-1). tRow=4, tCol=-1 < 0 → left disc at row 4. Yes!
    state.player.row = 5;
    state.player.col = 0;
    state.player.hop = null;

    const events = processAction(state, { type: 'move', direction: Direction.UP_LEFT, time: 1000 });
    expect(events.some((e) => e.type === 'disc_used')).toBe(true);
    expect(state.player.ridingDisc).toBe(true);

    // After the hop resolves, player should be at (0,0)
    const landTime = 1000 + state.level.hopDurationMs * 2 + 1;
    resolveHops(state, landTime);
    expect(state.player.row).toBe(0);
    expect(state.player.col).toBe(0);
    expect(state.player.ridingDisc).toBe(false);
  });

  it('lures coily off the edge when using disc', () => {
    const state = createGameState(3, 0);
    state.player.row = 5;
    state.player.col = 0;
    state.player.hop = null;

    // Add a chasing coily
    state.enemies.push({ id: 99, type: 'coily', row: 4, col: 0, hop: null });

    const events = processAction(state, { type: 'move', direction: Direction.UP_LEFT, time: 1000 });
    expect(events.some((e) => e.type === 'coily_lured')).toBe(true);
    expect(state.enemies).toHaveLength(0);
  });
});

describe('respawn', () => {
  it('resets player to top and clears enemies', () => {
    const state = createGameState(1, 0);
    state.player.row = 3;
    state.player.alive = false;
    state.phase = 'dying';
    state.enemies.push({ id: 1, type: 'red_ball', row: 2, col: 1, hop: null });

    respawnPlayer(state, 5000);
    expect(state.player.row).toBe(0);
    expect(state.player.col).toBe(0);
    expect(state.player.alive).toBe(true);
    expect(state.phase).toBe('playing');
    expect(state.enemies).toHaveLength(0);
  });
});
