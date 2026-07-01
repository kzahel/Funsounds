import { describe, expect, it } from 'vitest';
import { MODES, MODE_ORDER, GROUND_Y, PLAYER_W } from './modes';

describe('jumper modes', () => {
  it('builds Wedding with a partner past the flag on solid party ground', () => {
    const level = MODES.wedding.build(1);
    expect(level.leftGoalX).toBeUndefined();
    expect(level.partnerX).toBeDefined();
    expect(level.partnerY).toBeDefined();
    expect(level.partnerX!).toBeGreaterThan(level.goalX);

    const partnerCenter = level.partnerX! + PLAYER_W / 2;
    const partnerGround = level.platforms.find(
      (p) => p.kind === 'ground' && p.x <= partnerCenter && p.x + p.w >= partnerCenter && p.y === GROUND_Y,
    );
    expect(partnerGround).toBeDefined();
  });

  it('keeps Wedding in the mode cycle after Buddies', () => {
    expect(MODE_ORDER[MODE_ORDER.length - 1]).toBe('wedding');
  });
});
