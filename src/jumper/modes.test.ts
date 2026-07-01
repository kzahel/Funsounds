import { describe, expect, it } from 'vitest';
import { MODES, MODE_ORDER, GROUND_Y, PLAYER_W } from './modes';

describe('jumper modes', () => {
  it('builds Buddies with the right flag on the final ground platform', () => {
    const level = MODES.buddy.build(1);
    expect(level.leftGoalX).toBeDefined();

    const rightFlagPlatform = level.platforms.find(
      (p) => p.kind === 'ground' && p.x <= level.goalX && p.x + p.w >= level.goalX && p.y === GROUND_Y,
    );
    expect(rightFlagPlatform).toBeDefined();
    expect(rightFlagPlatform!.x).toBeGreaterThan(level.leftGoalX!);
  });

  it('builds Wedding with a partner past the flag on solid party ground', () => {
    const level = MODES.wedding.build(1);
    expect(level.leftGoalX).toBeDefined();
    expect(level.partnerX).toBeDefined();
    expect(level.partnerY).toBeDefined();
    expect(level.partnerX!).toBeGreaterThan(level.goalX);

    const leftFlagPlatform = level.platforms.find(
      (p) => p.kind === 'ground' && p.x <= level.leftGoalX! && p.x + p.w >= level.leftGoalX! && p.y === GROUND_Y,
    );
    expect(leftFlagPlatform).toBeDefined();

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
