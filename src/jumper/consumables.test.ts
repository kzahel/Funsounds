import { describe, expect, it } from 'vitest';
import { buildConsumables, consumableKindForWorld } from './consumables';
import { MODES } from './modes';
import type { WorldLayer } from './types';

describe('jumper consumables', () => {
  it('gives every world a distinct, appropriate snack', () => {
    expect(consumableKindForWorld('surface', 1)).toBe('strawberry');
    expect(consumableKindForWorld('surface', 2)).toBe('apple');
    expect(consumableKindForWorld('surface', 3)).toBe('cookie');
    expect(consumableKindForWorld('candy', 1)).toBe('gumdrop');
    expect(consumableKindForWorld('upperAtmosphere', 1)).toBe('croissant');
    expect(consumableKindForWorld('cave', 1)).toBe('cheese');
    expect(consumableKindForWorld('underwater', 1)).toBe('kelp');
    expect(consumableKindForWorld('deepSea', 1)).toBe('starfruit');
  });

  it('rests each snack on a platform and keeps the UFO beam clear', () => {
    const level = MODES.wedding.build(1);
    const worlds: WorldLayer[] = ['surface', 'candy', 'upperAtmosphere', 'cave', 'underwater', 'deepSea'];
    const ufoX = level.width * 0.58;

    for (const world of worlds) {
      const foods = buildConsumables(level, world, 1, ufoX);
      expect(foods.length).toBeGreaterThan(0);
      for (const food of foods) {
        expect(Math.abs(food.x + food.w / 2 - ufoX)).toBeGreaterThanOrEqual(88);
        expect(level.platforms.some((platform) => (
          food.x + food.w / 2 >= platform.x
          && food.x + food.w / 2 <= platform.x + platform.w
          && food.y + food.h === platform.y
        ))).toBe(true);
      }
    }
  });
});
