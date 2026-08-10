import type { Consumable, ConsumableKind, Level, Platform, WorldLayer } from './types';

export const CONSUMABLE_LABELS: Record<ConsumableKind, string> = {
  strawberry: 'strawberry',
  apple: 'apple',
  cookie: 'snowflake cookie',
  orange: 'sunset orange',
  starCookie: 'star cookie',
  gumdrop: 'gumdrop',
  cheese: 'cave cheese',
  kelp: 'crunchy kelp',
  starfruit: 'glowing starfruit',
  croissant: 'croissant',
  moonCheese: 'moon cheese',
  banana: 'jungle banana',
  toastedMarshmallow: 'toasted marshmallow',
  pearlCandy: 'pearl candy',
};

const FOOD_SIZE: Record<ConsumableKind, { w: number; h: number }> = {
  strawberry: { w: 28, h: 30 },
  apple: { w: 30, h: 31 },
  cookie: { w: 31, h: 31 },
  orange: { w: 30, h: 30 },
  starCookie: { w: 33, h: 33 },
  gumdrop: { w: 31, h: 27 },
  cheese: { w: 35, h: 28 },
  kelp: { w: 28, h: 36 },
  starfruit: { w: 34, h: 34 },
  croissant: { w: 40, h: 26 },
  moonCheese: { w: 36, h: 29 },
  banana: { w: 38, h: 28 },
  toastedMarshmallow: { w: 31, h: 34 },
  pearlCandy: { w: 30, h: 30 },
};

/** The six surface seasons get their own snack; the fantastical worlds do too. */
export function consumableKindForWorld(world: WorldLayer, levelNum: number): ConsumableKind {
  if (world === 'candy') return 'gumdrop';
  if (world === 'upperAtmosphere') return 'croissant';
  if (world === 'moonBase') return 'moonCheese';
  if (world === 'dinosaurJungle') return 'banana';
  if (world === 'volcano') return 'toastedMarshmallow';
  if (world === 'sunkenCastle') return 'pearlCandy';
  if (world === 'cave') return 'cheese';
  if (world === 'underwater') return 'kelp';
  if (world === 'deepSea') return 'starfruit';

  const surfaceKinds: ConsumableKind[] = ['strawberry', 'apple', 'cookie', 'orange', 'starCookie', 'strawberry'];
  const index = ((levelNum - 1) % surfaceKinds.length + surfaceKinds.length) % surfaceKinds.length;
  return surfaceKinds[index];
}

function candidateXs(platform: Platform): number[] {
  const edgePadding = 54;
  const usable = platform.w - edgePadding * 2;
  if (usable <= 0) return [platform.x + platform.w / 2];
  const count = Math.max(1, Math.min(4, Math.floor(platform.w / 310) + 1));
  return Array.from({ length: count }, (_, index) => (
    platform.x + edgePadding + (usable * (index + 1)) / (count + 1)
  ));
}

function tooCloseToLandmark(level: Level, x: number, avoidedXs: number[]): boolean {
  const landmarks = [level.leftGoalX, level.goalX, level.partnerX, ...avoidedXs];
  if (landmarks.some((landmark) => landmark !== undefined && Math.abs(x - landmark) < 88)) return true;
  return level.barrels.some((barrel) => x > barrel.x - 46 && x < barrel.x + barrel.w + 46);
}

/**
 * Place deterministic snacks on real platform tops. Determinism keeps each
 * retry recognizable for young players and makes the level easy to test.
 */
export function buildConsumables(
  level: Level,
  world: WorldLayer,
  levelNum: number,
  avoidedX: number | number[],
): Consumable[] {
  const kind = consumableKindForWorld(world, levelNum);
  const size = FOOD_SIZE[kind];
  const result: Consumable[] = [];
  const avoidedXs = Array.isArray(avoidedX) ? avoidedX : [avoidedX];
  let sequence = 0;

  for (const platform of level.platforms) {
    for (const centerX of candidateXs(platform)) {
      if (tooCloseToLandmark(level, centerX, avoidedXs)) continue;
      result.push({
        id: `${world}-${sequence++}`,
        x: centerX - size.w / 2,
        y: platform.y - size.h,
        w: size.w,
        h: size.h,
        kind,
      });
    }
  }

  // Very short courses can have every candidate close to a flag. Keep at
  // least one snack near the starting area, but never directly on the spawn.
  if (result.length === 0 && level.platforms.length > 0) {
    const platform = level.platforms[0];
    result.push({
      id: `${world}-0`,
      x: Math.min(platform.x + platform.w - size.w - 24, platform.x + 170),
      y: platform.y - size.h,
      w: size.w,
      h: size.h,
      kind,
    });
  }

  return result.slice(0, 12);
}
