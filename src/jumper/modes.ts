// Barrel Hop — world constants + data-driven mode/level generation.
//
// Adding a new mode is just a new ModeConfig in MODES; the controller and
// renderer stay untouched. Levels grow gently with the level number.

import type { Barrel, Checkpoint, Level, ModeConfig, Platform } from './types';

// Virtual world: one screen tall, scrolls horizontally. The renderer scales
// these units to the real canvas, so gameplay is identical on any screen.
export const VIRTUAL_H = 540;
export const GROUND_Y = 470; // top surface of the ground
export const GROUND_H = VIRTUAL_H - GROUND_Y;

export const PLAYER_W = 38;
export const PLAYER_H = 52;
export const SPAWN_Y = GROUND_Y - PLAYER_H;

export const BARREL_W = 48;
export const BARREL_OVER_H = 40; // short enough to clear with a decent hold

const NO_PIT_KILL_Y = VIRTUAL_H + 4000;
const PIT_KILL_Y = VIRTUAL_H + 70;

let barrelSeq = 0;
function nextBarrelId(): number {
  return ++barrelSeq;
}

function ground(x: number, w: number): Platform {
  return { x, y: GROUND_Y, w, h: GROUND_H, kind: 'ground' };
}

function floatPlatform(x: number, y: number, w: number): Platform {
  return { x, y, w, h: 22, kind: 'float' };
}

function overBarrel(x: number): Barrel {
  return { id: nextBarrelId(), x, y: GROUND_Y - BARREL_OVER_H, w: BARREL_W, h: BARREL_OVER_H };
}

/** A pillar barrel standing in a pit; the top is the landing surface. */
function pillarBarrel(x: number, topOffset: number): Barrel {
  const y = GROUND_Y - 46 - topOffset;
  return { id: nextBarrelId(), x, y, w: BARREL_W, h: GROUND_Y - y };
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Practice: flat, safe, an assortment to experiment with -----------------

function buildPractice(): Level {
  const width = 2900;
  const platforms: Platform[] = [ground(0, width)];
  const barrels: Barrel[] = [
    overBarrel(470),
    overBarrel(770),
    pillarBarrel(1140, 0),
    pillarBarrel(1320, 28),
    overBarrel(2080),
    overBarrel(2330),
    overBarrel(2560),
  ];
  // A little staircase of floating platforms to hop across.
  platforms.push(floatPlatform(1560, 360, 150));
  platforms.push(floatPlatform(1800, 300, 150));
  const checkpoints: Checkpoint[] = [
    { x: 1000, y: SPAWN_Y },
    { x: 2000, y: SPAWN_Y },
  ];
  return {
    width,
    startX: 70,
    startY: SPAWN_Y,
    goalX: width - 130,
    platforms,
    barrels,
    checkpoints,
    killY: NO_PIT_KILL_Y,
  };
}

// --- Easy: continuous ground, jump OVER barrels -----------------------------

function buildEasy(levelNum: number): Level {
  const count = 7 + levelNum;
  const spacing = Math.max(300, 470 - levelNum * 14);
  const barrels: Barrel[] = [];
  const checkpoints: Checkpoint[] = [];

  let x = 520;
  for (let i = 0; i < count; i++) {
    barrels.push(overBarrel(x));
    // From level 3 on, occasionally a wider double obstacle.
    if (levelNum >= 3 && i > 0 && Math.random() < 0.25) {
      barrels.push(overBarrel(x + BARREL_W + 8));
    }
    if (i > 0 && i % 3 === 0) checkpoints.push({ x: x - spacing * 0.5, y: SPAWN_Y });
    x += spacing + randBetween(-30, 40);
  }

  const goalX = x + 280;
  const width = goalX + 220;
  return {
    width,
    startX: 70,
    startY: SPAWN_Y,
    goalX,
    platforms: [ground(0, width)],
    barrels,
    checkpoints,
    killY: NO_PIT_KILL_Y,
  };
}

// --- Hard: pits bridged by barrels, land ON the tops -------------------------

function buildHard(levelNum: number): Level {
  const platforms: Platform[] = [];
  const barrels: Barrel[] = [];
  const checkpoints: Checkpoint[] = [];

  const startW = 360;
  platforms.push(ground(0, startW));
  checkpoints.push({ x: 120, y: SPAWN_Y });

  const groups = 5 + levelNum;
  const edgeGap = Math.min(118, 80 + levelNum * 4);
  let x = startW;

  for (let g = 0; g < groups; g++) {
    const inGroup = g % 3 === 2 ? 2 : 1; // every third group has two barrels
    let bx = x + edgeGap;
    for (let i = 0; i < inGroup; i++) {
      barrels.push(pillarBarrel(bx, pick([0, 26, 50])));
      bx += BARREL_W + edgeGap;
    }
    const ledgeW = 180;
    platforms.push(ground(bx, ledgeW));
    checkpoints.push({ x: bx + 40, y: SPAWN_Y });
    x = bx + ledgeW;
  }

  const goalX = x - 70;
  const width = x + 200;
  return {
    width,
    startX: 70,
    startY: SPAWN_Y,
    goalX,
    platforms,
    barrels,
    checkpoints,
    killY: PIT_KILL_Y,
  };
}

export const MODES: Record<string, ModeConfig> = {
  practice: {
    id: 'practice',
    name: 'Practice',
    emoji: '🌳',
    intro: 'Practice time! Jump around and have fun.',
    canFail: false,
    scoreBy: 'either',
    build: () => buildPractice(),
  },
  easy: {
    id: 'easy',
    name: 'Jump Over',
    emoji: '🛢️',
    intro: 'Jump over the barrels!',
    canFail: true,
    scoreBy: 'over',
    build: (levelNum) => buildEasy(levelNum),
  },
  hard: {
    id: 'hard',
    name: 'Jump On',
    emoji: '⭐',
    intro: 'Land on top of the barrels!',
    canFail: true,
    scoreBy: 'on',
    build: (levelNum) => buildHard(levelNum),
  },
};

export const MODE_ORDER: Array<keyof typeof MODES> = ['practice', 'easy', 'hard'];
