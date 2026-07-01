// Barrel Hop — Canvas 2D renderer. Bright, flat, friendly; cheap to draw so it
// holds 60fps on an old laptop. Background is drawn in screen space (parallax),
// the world in scaled world space. Colors come from the level's Theme; barrels
// and the character stay constant so they're always easy to read.

import type { Barrel, Level, Particle, Platform } from './types';
import type { Theme } from './themes';
import { GROUND_Y, PLAYER_H, PLAYER_W, VIRTUAL_H } from './modes';
import { BUDDY_LOOKS, type BuddyLook } from './buddy-looks';

export interface View {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  cssW: number;
  cssH: number;
  scale: number; // cssH / VIRTUAL_H
  cameraX: number;
  viewW: number; // visible world width in world units
  time: number; // seconds
}

export interface BuddyRender {
  x: number; // top-left, world units
  y: number;
  vy: number;
  facing: number;
  grounded: boolean;
  colorIndex: number;
  variantIndex: number;
  alpha: number;
  scale?: number;
}

export type WeddingPhase = 'idle' | 'kiss' | 'sparkle' | 'baby';

export interface WeddingRender {
  partnerX: number;
  partnerY: number;
  near: boolean;
  phase: WeddingPhase;
  phaseT: number;
  colorIndex: number;
}

export interface BirdRender {
  x: number;
  y: number;
  dir: number;
  wingT: number;
  carrying: boolean;
}

export interface SnakeRender {
  x: number;
  y: number;
  kind: 'snake' | 'trampoline';
  t: number;
}

export interface Scene {
  level: Level;
  theme: Theme;
  px: number; // interpolated player top-left
  py: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: number; // 1 right, -1 left
  invuln: boolean;
  /** 0 = flag up, 1 = flag fully lowered (level-clear celebration). */
  flagDown: number;
  buddies: BuddyRender[];
  wedding?: WeddingRender;
  candyWorld: boolean;
  skyRideT: number;
  undergroundWorld: boolean;
  undergroundLiftT: number;
  bird?: BirdRender;
  snake?: SnakeRender;
  particles: Particle[];
}

interface CharStyle {
  body: string;
  bodyDark: string;
  belly: string;
}

// Constant (non-themed) colors: wooden barrels + the character.
const FIXED = {
  plankDark: '#a07b3f',
  barrel: '#cf8a3e',
  barrelLight: '#e0a85b',
  barrelDark: '#9c5f25',
  hoop: '#5f3a17',
  body: '#57c777',
  bodyDark: '#3da75d',
  belly: '#bdf0c5',
};

const PLAYER_STYLE: CharStyle = { body: FIXED.body, bodyDark: FIXED.bodyDark, belly: FIXED.belly };
const PARTNER_STYLE: CharStyle = { body: '#ff8fc4', bodyDark: '#d65f9b', belly: '#ffd9ec' };
const WEDDING_KISS_DUR = 0.9;
const WEDDING_BABY_POP_DUR = 1.35;
const WEDDING_BABY_CRY_DUR = 3.2;
const WEDDING_BABY_START_SCALE = 0.38;
const BIRD_RENDER_W = 72;
const BIRD_RENDER_H = 42;

// Distinct, friendly colors for the trailing buddies.
export const BUDDY_STYLES: CharStyle[] = [
  { body: '#5aa9ff', bodyDark: '#3a7fd0', belly: '#d2e9ff' }, // blue
  { body: '#c08bff', bodyDark: '#8f5fd0', belly: '#ecd9ff' }, // purple
  { body: '#ffb24d', bodyDark: '#d98a2b', belly: '#ffe6c2' }, // orange
  { body: '#ff8fc4', bodyDark: '#d65f9b', belly: '#ffd9ec' }, // pink
  { body: '#4fd0c4', bodyDark: '#2fa79b', belly: '#cdf3ee' }, // teal
];

export function render(view: View, scene: Scene): void {
  const { ctx, dpr } = view;
  const theme = scene.theme;
  drawBackground(view, theme, scene.candyWorld, scene.skyRideT, scene.undergroundWorld, scene.undergroundLiftT);

  // World space transform (scale + camera), folded with device pixel ratio.
  const s = view.scale * dpr;
  ctx.setTransform(s, 0, 0, s, -view.cameraX * s, 0);

  drawPlatforms(ctx, scene.level.platforms, theme, scene.candyWorld, scene.undergroundWorld);
  if (scene.level.leftGoalX !== undefined) {
    drawEndpoint(ctx, scene.level.leftGoalX, view.time, 0, -1, scene.candyWorld);
  }
  drawGoal(ctx, scene.level, view.time, scene.flagDown, scene.candyWorld);
  if (scene.wedding) drawWeddingDecor(ctx, scene.level, scene.wedding, view.time);
  if (scene.undergroundWorld) drawUndergroundDecor(ctx, scene.level, view.time);
  for (const b of scene.level.barrels) {
    if (scene.undergroundWorld) drawCaveObstacle(ctx, b);
    else if (scene.candyWorld) drawCandyObstacle(ctx, b);
    else drawBarrel(ctx, b);
  }
  if (scene.candyWorld) drawCandyBunnies(ctx, scene.level, view.time);
  if (scene.snake) drawSnake(ctx, scene.snake);
  drawParticles(ctx, scene.particles);
  if (scene.bird) drawBird(ctx, scene.bird);

  // Buddies trail behind; draw farthest-first so nearer ones overlap on top,
  // then the player on top of all.
  for (let i = scene.buddies.length - 1; i >= 0; i--) {
    const bd = scene.buddies[i];
    const style = BUDDY_STYLES[bd.colorIndex % BUDDY_STYLES.length];
    const look = BUDDY_LOOKS[bd.variantIndex % BUDDY_LOOKS.length];
    const buddyScale = (bd.scale ?? 1) * look.size;
    const buddyW = PLAYER_W * buddyScale * look.width;
    const buddyH = PLAYER_H * buddyScale * look.height;
    const bx = bd.x + (PLAYER_W - buddyW) / 2;
    const by = bd.y + PLAYER_H - buddyH;
    drawCharacter(ctx, scene.level, bx, by, bd.vy, bd.grounded, bd.facing, view.time, style, bd.alpha, false, buddyScale, look);
  }
  if (scene.wedding) {
    drawWeddingPartnerAndEffects(ctx, scene.level, scene.wedding, scene.px, scene.py, view.time);
  }
  let weddingFacing = scene.facing;
  if (scene.wedding && scene.wedding.phase !== 'idle') {
    weddingFacing = scene.px + PLAYER_W / 2 <= scene.wedding.partnerX + PLAYER_W / 2 ? 1 : -1;
  }
  const playerBounce = scene.wedding?.phase === 'kiss' ? kissBounce(scene.wedding.phaseT) : 0;
  drawCharacter(
    ctx,
    scene.level,
    scene.px,
    scene.py - playerBounce,
    scene.vy,
    scene.grounded,
    weddingFacing,
    view.time,
    PLAYER_STYLE,
    1,
    scene.invuln,
  );

  // Ambient weather overlays the whole scene (screen space).
  drawWeather(view, theme);
}

function drawBackground(
  view: View,
  theme: Theme,
  candyWorld: boolean,
  skyRideT: number,
  undergroundWorld: boolean,
  undergroundLiftT: number,
): void {
  const { ctx, dpr, cssW, cssH } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, cssH);
  if (undergroundWorld) {
    sky.addColorStop(0, '#10131f');
    sky.addColorStop(0.5, '#1c1a27');
    sky.addColorStop(1, '#31273a');
  } else if (candyWorld) {
    sky.addColorStop(0, '#bdefff');
    sky.addColorStop(0.55, '#f5ecff');
    sky.addColorStop(1, '#fff8cf');
  } else {
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(1, theme.skyBottom);
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cssW, cssH);

  if (undergroundWorld) drawCaveBackground(view);
  if (!candyWorld && !undergroundWorld && theme.stars) drawStars(view);
  if (!undergroundWorld) {
    if (!candyWorld) drawCelestial(view, theme);
    else drawCandySky(view);
  }

  // Drifting clouds (slow parallax).
  if (!undergroundWorld) {
    const cloudShift = (view.cameraX * 0.15 + view.time * 8) % (cssW + 240);
    ctx.fillStyle = candyWorld ? 'rgba(255,255,255,0.96)' : theme.cloud;
    const cloudCount = candyWorld ? 7 : 4;
    for (let i = 0; i < cloudCount; i++) {
      const cx = ((i * (cssW / 3) - cloudShift + cssW + 240) % (cssW + 240)) - 120;
      const cy = candyWorld ? 58 + (i % 3) * 64 : 70 + (i % 2) * 60;
      cloud(ctx, cx, cy, candyWorld ? 42 + (i % 4) * 10 : 50 + (i % 3) * 12);
    }
  }

  // Rolling hills (two parallax layers), anchored to the ground line.
  const groundScreenY = GROUND_Y * view.scale;
  if (undergroundWorld) {
    hills(ctx, view, '#211f2d', 0.2, groundScreenY + 18, 88, 260);
    hills(ctx, view, '#302843', 0.42, groundScreenY + 28, 66, 210);
  } else if (candyWorld) {
    hills(ctx, view, '#f7d7ff', 0.22, groundScreenY + 24, 90, 280);
    hills(ctx, view, '#d7f7ff', 0.4, groundScreenY + 30, 70, 220);
  } else {
    hills(ctx, view, theme.hillFar, 0.3, groundScreenY + 6, 120, 320);
    hills(ctx, view, theme.hillNear, 0.5, groundScreenY + 14, 90, 240);
  }
  if (skyRideT > 0) drawLiftClouds(view, skyRideT);
  if (undergroundLiftT > 0) drawCaveLift(view, undergroundLiftT);
}

function drawStars(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 60; i++) {
    const x = (((i * 73) % 100) / 100) * cssW;
    const y = (((i * 131) % 60) / 100) * cssH * 0.9;
    const tw = 0.45 + 0.45 * Math.sin(view.time * 2 + i * 1.7);
    ctx.globalAlpha = tw;
    ctx.beginPath();
    ctx.arc(x, y, i % 7 === 0 ? 1.8 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCelestial(view: View, theme: Theme): void {
  const { ctx, cssW } = view;
  const x = cssW - 90;
  const y = 90;

  ctx.save();
  // Soft glow.
  ctx.globalAlpha = theme.celestial === 'moon' ? 0.18 : 0.25;
  ctx.fillStyle = theme.celestialColor;
  ctx.beginPath();
  ctx.arc(x, y, 72, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = theme.celestial === 'moon' ? 0.95 : 0.9;
  ctx.beginPath();
  ctx.arc(x, y, 46, 0, Math.PI * 2);
  ctx.fill();

  if (theme.celestial === 'moon') {
    // A couple of soft craters.
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#5a5a4a';
    ctx.beginPath();
    ctx.arc(x - 14, y - 10, 8, 0, Math.PI * 2);
    ctx.arc(x + 12, y + 8, 11, 0, Math.PI * 2);
    ctx.arc(x + 4, y - 16, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCandySky(view: View): void {
  const { ctx, cssW } = view;
  const cx = cssW - 96;
  const cy = 92;
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#fff2a8';
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff8fc4';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 1.45);
  ctx.stroke();
  ctx.strokeStyle = '#8fd6ff';
  ctx.beginPath();
  ctx.arc(cx, cy, 13, Math.PI * 0.2, Math.PI * 1.8);
  ctx.stroke();
  ctx.restore();
}

function drawCaveBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();

  for (let i = 0; i < 7; i++) {
    const cx = ((i * 211 - view.cameraX * 0.08) % (cssW + 280)) - 120;
    const cy = 72 + (i % 3) * 86;
    ctx.fillStyle = i % 2 === 0 ? '#070a12' : '#14111d';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 78 + (i % 2) * 24, 34 + (i % 4) * 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#292535';
  for (let x = -80 - ((view.cameraX * 0.18) % 160); x < cssW + 160; x += 160) {
    const h = 46 + ((Math.floor(x) % 5 + 5) % 5) * 13;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 42, h);
    ctx.lineTo(x + 86, 0);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 5; i++) {
    const gx = ((i * 197 - view.cameraX * 0.12) % (cssW + 240)) - 80;
    const gy = cssH * (0.22 + (i % 3) * 0.14);
    const grad = ctx.createRadialGradient(gx, gy, 4, gx, gy, 95);
    grad.addColorStop(0, 'rgba(255,216,132,0.26)');
    grad.addColorStop(1, 'rgba(255,216,132,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, gy, 95, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCaveLift(view: View, t: number): void {
  const { ctx, cssW, cssH } = view;
  const a = Math.sin(Math.PI * clampNum(t, 0, 1));
  ctx.save();
  const shaft = ctx.createLinearGradient(cssW * 0.5, cssH, cssW * 0.5, 0);
  shaft.addColorStop(0, `rgba(150,220,255,${0.3 * a})`);
  shaft.addColorStop(0.55, `rgba(255,245,180,${0.18 * a})`);
  shaft.addColorStop(1, `rgba(255,255,255,${0.02 * a})`);
  ctx.fillStyle = shaft;
  ctx.beginPath();
  ctx.moveTo(cssW * 0.38, cssH);
  ctx.lineTo(cssW * 0.46, 0);
  ctx.lineTo(cssW * 0.58, 0);
  ctx.lineTo(cssW * 0.68, cssH);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 12; i++) {
    ctx.globalAlpha = a * (0.18 + (i % 4) * 0.04);
    ctx.fillStyle = i % 2 ? '#9de7ff' : '#fff0a8';
    ctx.beginPath();
    ctx.arc((i * 73) % cssW, cssH - ((t * 720 + i * 61) % (cssH + 80)), 3 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLiftClouds(view: View, t: number): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();
  const travel = t * (cssH + 260);
  for (let i = 0; i < 12; i++) {
    const x = ((i * 173) % Math.max(1, cssW + 240)) - 120;
    const y = cssH + 80 - ((travel + i * 92) % (cssH + 220));
    const r = 36 + (i % 4) * 14;
    ctx.globalAlpha = 0.35 + 0.45 * Math.sin(Math.PI * t);
    ctx.fillStyle = i % 3 === 0 ? '#ffeaf7' : '#ffffff';
    cloud(ctx, x, y, r);
  }
  ctx.restore();
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.8, y + 6, r * 0.7, 0, Math.PI * 2);
  ctx.arc(x - r * 0.8, y + 8, r * 0.6, 0, Math.PI * 2);
  ctx.arc(x, y + 12, r * 0.9, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloudPlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#b8ecff';
    ctx.fillRect(p.x, p.y + 22, p.w, p.h);
    ctx.fillStyle = '#86d7f0';
    ctx.fillRect(p.x, p.y + p.h - 10, p.w, 10);
  } else {
    ctx.fillStyle = '#aee9ff';
    roundRect(ctx, p.x, p.y + 12, p.w, p.h + 8, 10);
    ctx.fill();
  }

  ctx.fillStyle = '#ffffff';
  const spacing = 38;
  const count = Math.max(3, Math.ceil(p.w / spacing));
  for (let i = 0; i <= count; i++) {
    const cx = p.x + (i / count) * p.w;
    const r = p.kind === 'ground' ? 28 + (i % 3) * 8 : 20 + (i % 2) * 6;
    ctx.beginPath();
    ctx.arc(cx, p.y + 18, r, Math.PI, 0);
    ctx.rect(cx - r, p.y + 18, r * 2, Math.max(18, p.h * 0.55));
    ctx.fill();
  }

  ctx.fillStyle = '#f5fbff';
  ctx.fillRect(p.x, p.y + 10, p.w, 16);
}

function hills(
  ctx: CanvasRenderingContext2D,
  view: View,
  color: string,
  parallax: number,
  baseY: number,
  height: number,
  spacing: number,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, view.cssH);
  const shift = (view.cameraX * parallax) % spacing;
  for (let x = -shift - spacing; x < view.cssW + spacing; x += spacing) {
    ctx.moveTo(x, baseY);
    ctx.arc(x + spacing / 2, baseY, height, Math.PI, 0, false);
  }
  ctx.rect(0, baseY, view.cssW, view.cssH - baseY);
  ctx.fill();
}

function drawPlatforms(ctx: CanvasRenderingContext2D, platforms: Platform[], theme: Theme, candyWorld: boolean, undergroundWorld: boolean): void {
  for (const p of platforms) {
    if (undergroundWorld) {
      drawCavePlatform(ctx, p);
      continue;
    }
    if (candyWorld) {
      drawCloudPlatform(ctx, p);
      continue;
    }
    if (p.kind === 'ground') {
      ctx.fillStyle = theme.dirt;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = theme.dirtDark;
      ctx.fillRect(p.x, p.y + p.h - 10, p.w, 10);
      ctx.fillStyle = theme.grass;
      ctx.fillRect(p.x, p.y, p.w, 14);
      ctx.fillStyle = theme.grassDark;
      ctx.fillRect(p.x, p.y + 13, p.w, 4);
    } else {
      roundRect(ctx, p.x, p.y, p.w, p.h + 6, 7);
      ctx.fillStyle = FIXED.plankDark;
      ctx.fill();
      roundRect(ctx, p.x, p.y, p.w, 12, 6);
      ctx.fillStyle = theme.grass;
      ctx.fill();
    }
  }
}

function drawCavePlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#3b3446';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#211c2b';
    ctx.fillRect(p.x, p.y + p.h - 12, p.w, 12);
  } else {
    roundRect(ctx, p.x, p.y, p.w, p.h + 8, 8);
    ctx.fillStyle = '#3b3446';
    ctx.fill();
  }

  ctx.fillStyle = '#5c536a';
  ctx.fillRect(p.x, p.y, p.w, 12);
  ctx.fillStyle = '#272233';
  for (let x = p.x + 18; x < p.x + p.w; x += 42) {
    ctx.beginPath();
    ctx.arc(x, p.y + 16 + (x % 3) * 4, 7 + (x % 2) * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#7ff0ff';
  for (let x = p.x + 36; x < p.x + p.w - 18; x += 180) {
    ctx.beginPath();
    ctx.moveTo(x, p.y + 2);
    ctx.lineTo(x + 10, p.y - 16);
    ctx.lineTo(x + 19, p.y + 2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBarrel(ctx: CanvasRenderingContext2D, b: Barrel): void {
  roundRect(ctx, b.x, b.y, b.w, b.h, 9);
  ctx.fillStyle = FIXED.barrel;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, b.x, b.y, b.w, b.h, 9);
  ctx.clip();

  const staves = 4;
  for (let i = 0; i < staves; i++) {
    ctx.fillStyle = i % 2 === 0 ? FIXED.barrelLight : FIXED.barrel;
    ctx.fillRect(b.x + (i * b.w) / staves, b.y, b.w / staves - 1.5, b.h);
  }
  ctx.fillStyle = FIXED.hoop;
  const hoopH = Math.max(4, b.h * 0.08);
  ctx.fillRect(b.x, b.y + b.h * 0.16, b.w, hoopH);
  ctx.fillRect(b.x, b.y + b.h * 0.74, b.w, hoopH);
  ctx.fillStyle = FIXED.barrelLight;
  ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, 4);
  ctx.restore();

  ctx.lineWidth = 2;
  ctx.strokeStyle = FIXED.barrelDark;
  roundRect(ctx, b.x, b.y, b.w, b.h, 9);
  ctx.stroke();
}

function drawCandyObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  if (b.id % 2 === 0) {
    drawChocolateBar(ctx, b);
  } else {
    drawMarshmallow(ctx, b);
  }
}

function drawCaveObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  if (b.id % 3 === 0) {
    ctx.fillStyle = '#5b5268';
    roundRect(ctx, b.x + 2, b.y + 7, b.w - 4, b.h - 7, 7);
    ctx.fill();
    ctx.fillStyle = '#30293a';
    ctx.beginPath();
    ctx.moveTo(b.x + 8, b.y + b.h);
    ctx.lineTo(b.x + 18, b.y + 15);
    ctx.lineTo(b.x + 30, b.y + b.h);
    ctx.lineTo(b.x + 40, b.y + 13);
    ctx.lineTo(b.x + b.w - 4, b.y + b.h);
    ctx.closePath();
    ctx.fill();
  } else {
    const colors = b.id % 2 === 0 ? ['#8ef7ff', '#35b8ff'] : ['#ffd86f', '#ff9f4a'];
    ctx.fillStyle = '#342c3f';
    roundRect(ctx, b.x + 2, b.y + b.h * 0.36, b.w - 4, b.h * 0.64, 8);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      const cx = b.x + 10 + i * 14;
      const top = b.y + 6 + (i % 2) * 8;
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + 9, top + 16);
      ctx.lineTo(cx + 4, b.y + b.h - 5);
      ctx.lineTo(cx - 8, top + 18);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawMarshmallow(ctx: CanvasRenderingContext2D, b: Barrel): void {
  roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(16, b.w * 0.35));
  ctx.fillStyle = '#fff8fb';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffb6d5';
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(16, b.w * 0.35));
  ctx.clip();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#ffd6e8';
  ctx.fillRect(b.x, b.y + b.h * 0.22, b.w, Math.max(7, b.h * 0.14));
  ctx.fillStyle = '#c7f4ff';
  ctx.fillRect(b.x, b.y + b.h * 0.58, b.w, Math.max(7, b.h * 0.14));
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(b.x + 7, b.y + 7, Math.max(10, b.w - 18), 4);
}

function drawChocolateBar(ctx: CanvasRenderingContext2D, b: Barrel): void {
  roundRect(ctx, b.x, b.y, b.w, b.h, 7);
  ctx.fillStyle = '#8a4b2a';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#5a2e19';
  ctx.stroke();

  const rows = Math.max(2, Math.floor(b.h / 30));
  const cols = 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pad = 5;
      const cellW = (b.w - pad * 2) / cols;
      const cellH = (b.h - pad * 2) / rows;
      roundRect(ctx, b.x + pad + c * cellW + 2, b.y + pad + r * cellH + 2, cellW - 4, cellH - 4, 4);
      ctx.fillStyle = '#b56b3d';
      ctx.fill();
    }
  }
}

/** Highest solid surface beneath the player's footprint, or null over a gap. */
function floorBelow(level: Level, left: number, right: number, footY: number): number | null {
  let best: number | null = null;
  const consider = (sx: number, sw: number, sy: number) => {
    if (sx < right && sx + sw > left && sy >= footY - 1) {
      if (best === null || sy < best) best = sy;
    }
  };
  for (const p of level.platforms) consider(p.x, p.w, p.y);
  for (const b of level.barrels) consider(b.x, b.w, b.y);
  return best;
}

function drawGoal(ctx: CanvasRenderingContext2D, level: Level, time: number, flagDown: number, candyWorld: boolean): void {
  drawEndpoint(ctx, level.goalX, time, flagDown, 1, candyWorld);
}

function drawEndpoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  time: number,
  flagDown: number,
  dir: number,
  candyWorld: boolean,
): void {
  if (candyWorld) drawLollipop(ctx, x, time, dir);
  else drawFlag(ctx, x, time, flagDown, dir);
}

/** A flag on a pole. `dir` = 1 points the pennant right, -1 points it left. */
function drawFlag(ctx: CanvasRenderingContext2D, x: number, time: number, flagDown: number, dir: number): void {
  const top = GROUND_Y - 130;
  const px = dir > 0 ? x - 3 : x + 3; // pole edge the flag attaches to
  ctx.fillStyle = '#cfd6df';
  ctx.fillRect(x - 3, top, 6, 130);
  ctx.fillStyle = '#8a929c';
  ctx.fillRect(dir > 0 ? x - 3 : x, top, 3, 130);

  // The flag slides down the pole during the level-clear celebration.
  const wave = Math.sin(time * 4) * 4 * (1 - flagDown);
  const flagY = top + 4 + flagDown * 92;
  ctx.fillStyle = dir > 0 ? '#ff5a5f' : '#4d96ff';
  ctx.beginPath();
  ctx.moveTo(px, flagY);
  ctx.lineTo(px + dir * 59, flagY + 12 + wave);
  ctx.lineTo(px, flagY + 26);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(x, top, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawLollipop(ctx: CanvasRenderingContext2D, x: number, _time: number, dir: number): void {
  const stickTop = GROUND_Y - 122;
  const candyY = stickTop - 4;
  const stripeOffset = dir > 0 ? 0 : 10;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(x, GROUND_Y);
  ctx.lineTo(x, candyY + 34);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 8, candyY + 30, 16, GROUND_Y - candyY - 30);
  ctx.clip();
  ctx.strokeStyle = '#ff8fc4';
  ctx.lineWidth = 3;
  for (let y = candyY + 22 - stripeOffset; y < GROUND_Y + 24; y += 18) {
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 11);
    ctx.lineTo(x + 11, y - 11);
    ctx.stroke();
  }
  ctx.restore();

  const cx = x;
  const cy = candyY;
  ctx.fillStyle = '#ff8fc4';
  ctx.beginPath();
  ctx.arc(cx, cy, 38, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, 27, -0.05 * Math.PI, 1.25 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0.1 * Math.PI, 1.7 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = '#7fdcff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, -0.3 * Math.PI, 1.35 * Math.PI);
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - 13, cy - 14, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawCandyBunnies(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  let drawn = 0;
  for (let i = 0; i < level.platforms.length && drawn < 7; i++) {
    const p = level.platforms[i];
    if (p.w < 120) continue;
    const slots = Math.min(2, Math.max(1, Math.floor(p.w / 360)));
    for (let s = 0; s < slots && drawn < 7; s++) {
      const span = Math.max(1, p.w - 120);
      const x = p.x + 60 + ((i * 137 + s * 181) % span);
      const hop = Math.max(0, Math.sin(time * 4.2 + i * 1.7 + s)) * 12;
      const color = (i + s) % 3;
      drawBunny(ctx, x, p.y - 8 - hop, color, s % 2 === 0 ? 1 : -1);
      drawn++;
    }
  }
}

function drawBunny(ctx: CanvasRenderingContext2D, x: number, footY: number, colorIndex: number, dir: number): void {
  const colors = [
    ['#ffffff', '#e5f6ff'],
    ['#ffdff0', '#ffb6d5'],
    ['#d6f7ff', '#aee9ff'],
  ];
  const [body, shade] = colors[colorIndex % colors.length];
  ctx.save();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(x - 8, footY - 2, 9, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 10, footY - 2, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(x, footY - 16, 17, 13, 0, 0, Math.PI * 2);
  ctx.ellipse(x + dir * 10, footY - 30, 13, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = body;
  for (const off of [-5, 4]) {
    ctx.save();
    ctx.translate(x + dir * (7 + off * 0.2), footY - 42);
    ctx.rotate(dir * (0.15 + off * 0.02));
    ctx.beginPath();
    ctx.ellipse(off, -6, 4, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb6d5';
    ctx.beginPath();
    ctx.ellipse(off, -5, 2, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.arc(x + dir * 14, footY - 31, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#23351f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + dir * 17, footY - 27, 4, 0.1 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawUndergroundDecor(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  let torches = 0;
  let dwarves = 0;
  for (let i = 0; i < level.platforms.length; i++) {
    const p = level.platforms[i];
    if (p.w < 120) continue;
    if (torches < 10) {
      const x = p.x + 42 + ((i * 149) % Math.max(1, p.w - 84));
      drawTorch(ctx, x, p.y, time + i * 0.7);
      torches++;
    }
    if (i % 2 === 0 && dwarves < 5 && p.w >= 180) {
      const x = p.x + 88 + ((i * 211) % Math.max(1, p.w - 140));
      drawDwarf(ctx, x, p.y, time + i);
      dwarves++;
    }
    for (let d = 0; d < Math.min(3, Math.floor(p.w / 220)); d++) {
      const x = p.x + 70 + ((i * 97 + d * 131) % Math.max(1, p.w - 120));
      drawDiamond(ctx, x, p.y + 28 + (d % 2) * 18, d);
    }
  }
}

function drawTorch(ctx: CanvasRenderingContext2D, x: number, groundY: number, time: number): void {
  const flameY = groundY - 34;
  ctx.save();
  const glow = ctx.createRadialGradient(x, flameY, 2, x, flameY, 58);
  glow.addColorStop(0, 'rgba(255,190,84,0.42)');
  glow.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, flameY, 58, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#704527';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x, groundY - 2);
  ctx.lineTo(x, groundY - 30);
  ctx.stroke();

  const flicker = 1 + Math.sin(time * 9) * 0.12;
  ctx.fillStyle = '#ff8f2f';
  ctx.beginPath();
  ctx.ellipse(x, flameY, 8 * flicker, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe277';
  ctx.beginPath();
  ctx.ellipse(x, flameY + 3, 4.5, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, colorIndex: number): void {
  const fill = colorIndex % 2 === 0 ? '#7ff0ff' : '#ffd86f';
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x + 12, y);
  ctx.lineTo(x, y + 18);
  ctx.lineTo(x - 12, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 8);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x - 1, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDwarf(ctx: CanvasRenderingContext2D, x: number, groundY: number, time: number): void {
  const swing = Math.sin(time * 5) * 0.55;
  ctx.save();
  ctx.translate(x, groundY - 5);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#3a7fd0';
  roundRect(ctx, -12, -34, 24, 24, 7);
  ctx.fill();
  ctx.fillStyle = '#f1b070';
  ctx.beginPath();
  ctx.arc(0, -43, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d66d2f';
  ctx.beginPath();
  ctx.moveTo(-13, -48);
  ctx.lineTo(0, -68);
  ctx.lineTo(14, -48);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffcb7a';
  ctx.beginPath();
  ctx.ellipse(0, -34, 10, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(14, -39);
  ctx.rotate(-0.9 + swing);
  ctx.strokeStyle = '#5c321d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(26, -12);
  ctx.stroke();
  ctx.strokeStyle = '#cdd2d9';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(18, -19);
  ctx.lineTo(32, -6);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: SnakeRender): void {
  if (snake.kind === 'trampoline') {
    drawTrampoline(ctx, snake);
    return;
  }

  const wave = Math.sin(snake.t * 5) * 3;
  ctx.save();
  ctx.fillStyle = '#5bd66c';
  ctx.strokeStyle = '#2f8a3b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(snake.x + 36, snake.y + 18 + wave, 34, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(snake.x + 66, snake.y + 13 - wave * 0.4, 18, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe277';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(snake.x + 15 + i * 12, snake.y + 14 + Math.sin(snake.t * 4 + i) * 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(snake.x + 72, snake.y + 8, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.arc(snake.x + 73, snake.y + 8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff6b8a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(snake.x + 83, snake.y + 14);
  ctx.lineTo(snake.x + 94, snake.y + 12);
  ctx.moveTo(snake.x + 90, snake.y + 12);
  ctx.lineTo(snake.x + 96, snake.y + 8);
  ctx.moveTo(snake.x + 90, snake.y + 12);
  ctx.lineTo(snake.x + 97, snake.y + 16);
  ctx.stroke();
  ctx.restore();
}

function drawTrampoline(ctx: CanvasRenderingContext2D, snake: SnakeRender): void {
  const bounce = Math.sin(snake.t * 8) * 2;
  ctx.save();
  ctx.strokeStyle = '#cdd2d9';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(snake.x + 12, snake.y + 22);
  ctx.lineTo(snake.x + 2, snake.y + 42);
  ctx.moveTo(snake.x + 70, snake.y + 22);
  ctx.lineTo(snake.x + 82, snake.y + 42);
  ctx.stroke();
  roundRect(ctx, snake.x, snake.y + bounce, 82, 18, 8);
  ctx.fillStyle = '#35b8ff';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#7ff0ff';
  ctx.fillRect(snake.x + 12, snake.y + 7 + bounce, 58, 4);
  ctx.restore();
}

function drawWeddingDecor(ctx: CanvasRenderingContext2D, level: Level, wedding: WeddingRender, time: number): void {
  const partnerCx = wedding.partnerX + PLAYER_W / 2;
  const partyStart = level.goalX + 18;
  const partyEnd = partnerCx + 96;
  const lineY = GROUND_Y - 158;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(partyStart, lineY);
  ctx.quadraticCurveTo((partyStart + partyEnd) / 2, lineY + 24, partyEnd, lineY);
  ctx.stroke();

  const pennants = ['#ff8fc4', '#ffd23f', '#4d96ff', '#6bcb77'];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const x = partyStart + (partyEnd - partyStart) * t;
    const y = lineY + Math.sin(t * Math.PI) * 24;
    ctx.fillStyle = pennants[i % pennants.length];
    ctx.beginPath();
    ctx.moveTo(x - 9, y + 2);
    ctx.lineTo(x + 9, y + 2);
    ctx.lineTo(x, y + 22);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,245,250,0.95)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(partnerCx - 52, GROUND_Y - 2);
  ctx.bezierCurveTo(partnerCx - 48, GROUND_Y - 116, partnerCx + 48, GROUND_Y - 116, partnerCx + 52, GROUND_Y - 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,143,196,0.85)';
  ctx.stroke();

  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + (i / 6) * Math.PI;
    const x = partnerCx + Math.cos(a) * 50;
    const y = GROUND_Y - 4 + Math.sin(a) * 108;
    ctx.fillStyle = i % 2 === 0 ? '#ff8fc4' : '#ffd23f';
    ctx.beginPath();
    ctx.arc(x, y, 5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(partnerCx - 10, GROUND_Y - 2, 78, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  if (wedding.near && wedding.phase === 'idle') {
    const pulse = 1 + Math.sin(time * 6) * 0.12;
    ctx.globalAlpha = 0.88;
    drawHeart(ctx, partnerCx, GROUND_Y - 158, 16 * pulse, '#ff5a9a');
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawWeddingPartnerAndEffects(
  ctx: CanvasRenderingContext2D,
  level: Level,
  wedding: WeddingRender,
  playerX: number,
  playerY: number,
  time: number,
): void {
  const playerCx = playerX + PLAYER_W / 2;
  const partnerCx = wedding.partnerX + PLAYER_W / 2;
  const playerFacingPartner = playerCx <= partnerCx ? 1 : -1;
  const partnerFacing = -playerFacingPartner;
  const partnerBounce = wedding.phase === 'kiss' ? kissBounce(wedding.phaseT) : 0;

  drawCharacter(
    ctx,
    level,
    wedding.partnerX,
    wedding.partnerY - partnerBounce,
    0,
    true,
    partnerFacing,
    time,
    PARTNER_STYLE,
    1,
    false,
  );

  if (wedding.phase === 'kiss' || wedding.phase === 'sparkle') {
    drawKissHearts(ctx, wedding, playerX, playerY, playerFacingPartner);
  }
  if (wedding.phase === 'baby') {
    drawGrowingBaby(ctx, level, wedding, playerX, time);
  }
}

function drawKissHearts(
  ctx: CanvasRenderingContext2D,
  wedding: WeddingRender,
  playerX: number,
  playerY: number,
  playerFacing: number,
): void {
  const partnerFacing = -playerFacing;
  const playerMouth = {
    x: playerX + PLAYER_W / 2 + playerFacing * PLAYER_W * 0.18,
    y: playerY + PLAYER_H * 0.42,
  };
  const partnerMouth = {
    x: wedding.partnerX + PLAYER_W / 2 + partnerFacing * PLAYER_W * 0.18,
    y: wedding.partnerY + PLAYER_H * 0.42,
  };
  const centerX = (playerMouth.x + partnerMouth.x) / 2;
  const centerY = (playerMouth.y + partnerMouth.y) / 2 - 8;

  ctx.save();
  if (wedding.phase === 'kiss') {
    const t = clampNum(wedding.phaseT / WEDDING_KISS_DUR, 0, 1);
    const lift = Math.sin(t * Math.PI) * 18;
    drawHeart(ctx, lerpNum(playerMouth.x, centerX, t), lerpNum(playerMouth.y, centerY, t) - lift, 12, '#ff5a9a');
    drawHeart(ctx, lerpNum(partnerMouth.x, centerX, t), lerpNum(partnerMouth.y, centerY, t) - lift, 12, '#ff8fc4');
    drawHeart(ctx, centerX, centerY - 20 * t, 8 + 13 * t, '#ffd1e6');
  } else {
    const t = wedding.phaseT;
    for (let i = 0; i < 6; i++) {
      const a = t * 3 + i * (Math.PI * 2 / 6);
      const r = 14 + i * 4 + t * 18;
      ctx.globalAlpha = clampNum(1 - t * 0.75, 0, 1);
      drawHeart(ctx, centerX + Math.cos(a) * r, centerY - 12 + Math.sin(a) * r * 0.55, 8, i % 2 ? '#ff8fc4' : '#ffd23f');
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawGrowingBaby(
  ctx: CanvasRenderingContext2D,
  level: Level,
  wedding: WeddingRender,
  playerX: number,
  time: number,
): void {
  const pop = smoothstep(clampNum(wedding.phaseT / WEDDING_BABY_POP_DUR, 0, 1));
  const scale = 0.32 + (WEDDING_BABY_START_SCALE - 0.32) * pop;
  const midX = (playerX + PLAYER_W / 2 + wedding.partnerX + PLAYER_W / 2) / 2;
  const popHop = Math.max(0, Math.sin(time * 9)) * (16 - 4 * pop);
  const cradleHop = Math.max(0, Math.sin(time * 7)) * 3;
  const hop = wedding.phaseT < WEDDING_BABY_POP_DUR ? popHop : cradleHop;
  const topX = midX - (PLAYER_W * scale) / 2;
  const topY = GROUND_Y - PLAYER_H * scale - hop;
  const style = BUDDY_STYLES[wedding.colorIndex % BUDDY_STYLES.length];
  const crying = wedding.phaseT < WEDDING_BABY_CRY_DUR;

  if (!crying) drawHeart(ctx, midX, topY - 20, 8 + 5 * Math.sin(time * 6) ** 2, '#ff5a9a');
  drawCharacter(ctx, level, topX, topY, hop > 1 ? -180 : 0, hop <= 1, 1, time, style, 1, false, scale);
  if (crying) drawCryingBabyOverlay(ctx, topX, topY, scale, time);
}

function drawCryingBabyOverlay(ctx: CanvasRenderingContext2D, topX: number, topY: number, scale: number, time: number): void {
  const w = PLAYER_W * scale;
  const h = PLAYER_H * scale;
  const cx = topX + w / 2;
  const eyeY = topY + h * 0.26;
  const mouthY = topY + h * 0.49;
  const bob = Math.sin(time * 18) * scale;

  ctx.save();
  ctx.fillStyle = '#4da7ff';
  for (const side of [-1, 1]) {
    const tx = cx + side * w * 0.18;
    ctx.beginPath();
    ctx.ellipse(tx, eyeY + h * 0.18 + bob, w * 0.055, h * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, w * 0.16, h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff8ca8';
  ctx.beginPath();
  ctx.ellipse(cx, mouthY + h * 0.05, w * 0.08, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#23351f';
  ctx.lineWidth = 1.6 * scale;
  ctx.beginPath();
  ctx.arc(cx - w * 0.22, eyeY - h * 0.03, w * 0.1, 1.15 * Math.PI, 1.85 * Math.PI);
  ctx.arc(cx + w * 0.22, eyeY - h * 0.03, w * 0.1, 1.15 * Math.PI, 1.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function kissBounce(t: number): number {
  return Math.max(0, Math.sin(clampNum(t / WEDDING_KISS_DUR, 0, 1) * Math.PI * 4)) * 4;
}

function drawBird(ctx: CanvasRenderingContext2D, bird: BirdRender): void {
  const cx = bird.x + BIRD_RENDER_W / 2;
  const cy = bird.y + BIRD_RENDER_H / 2;
  const flap = Math.sin(bird.wingT);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(bird.dir, 1);

  ctx.fillStyle = '#5aa9ff';
  ctx.beginPath();
  ctx.ellipse(0, 4, BIRD_RENDER_W * 0.28, BIRD_RENDER_H * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#3a7fd0';
  ctx.beginPath();
  ctx.ellipse(-8, 2 + flap * 4, BIRD_RENDER_W * 0.2, BIRD_RENDER_H * 0.12, -0.6 - flap * 0.35, 0, Math.PI * 2);
  ctx.ellipse(10, 2 - flap * 5, BIRD_RENDER_W * 0.24, BIRD_RENDER_H * 0.13, 0.7 + flap * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#7fc8ff';
  ctx.beginPath();
  ctx.arc(BIRD_RENDER_W * 0.22, -3, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.moveTo(BIRD_RENDER_W * 0.34, -4);
  ctx.lineTo(BIRD_RENDER_W * 0.51, 1);
  ctx.lineTo(BIRD_RENDER_W * 0.34, 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(BIRD_RENDER_W * 0.25, -7, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.arc(BIRD_RENDER_W * 0.28, -6, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#23351f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-7, BIRD_RENDER_H * 0.25);
  ctx.lineTo(-10, BIRD_RENDER_H * 0.38);
  ctx.moveTo(5, BIRD_RENDER_H * 0.25);
  ctx.lineTo(8, BIRD_RENDER_H * 0.38);
  ctx.stroke();

  if (bird.carrying) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 8, BIRD_RENDER_W * 0.33, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    if (p.kind === 'spark') {
      star(ctx, p.x, p.y, p.size, p.size * 0.45);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// Draws a frog character (player or buddy). `style` recolors the body; `alpha`
// fades buddies in; `invuln` makes the player flicker after a hit.
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  level: Level,
  topX: number,
  topY: number,
  vy: number,
  grounded: boolean,
  facing: number,
  time: number,
  style: CharStyle,
  alpha: number,
  invuln: boolean,
  scale = 1,
  look: BuddyLook | null = null,
): void {
  const widthScale = look?.width ?? 1;
  const heightScale = look?.height ?? 1;
  const charW = PLAYER_W * scale * widthScale;
  const charH = PLAYER_H * scale * heightScale;
  const cx = topX + charW / 2;
  const feetY = topY + charH;

  // Shadow falls on the surface directly below — and not at all over a chasm.
  const floorY = floorBelow(level, topX, topX + charW, feetY);
  if (floorY !== null) {
    const drop = floorY - feetY; // >= 0
    const t = clampNum(1 - drop / 320, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha * (0.06 + 0.16 * t);
    ctx.fillStyle = '#1d3a1d';
    ctx.beginPath();
    ctx.ellipse(cx, floorY - 2, charW * (0.32 + 0.18 * t), 6 * scale * (0.6 + 0.4 * t), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  let sy = 1;
  if (!grounded) sy = clampNum(1 + -vy / 4200, 0.9, 1.16);
  const sx = 2 - sy;
  const w = charW * sx;
  const h = charH * sy;
  const x = cx - w / 2;
  const y = feetY - h;

  ctx.save();
  ctx.globalAlpha = alpha * (invuln && Math.floor(time * 12) % 2 === 0 ? 0.45 : 1);

  ctx.fillStyle = style.bodyDark;
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.22, feetY - 3 * scale, w * 0.2, 6 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + w * 0.22, feetY - 3 * scale, w * 0.2, 6 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  roundRect(ctx, x, y, w, h, w * 0.42);
  ctx.fillStyle = style.body;
  ctx.fill();
  ctx.lineWidth = 2.5 * scale;
  ctx.strokeStyle = style.bodyDark;
  ctx.stroke();

  drawBuddyHair(ctx, cx, y, w, h, scale, style, look);
  drawBuddyHeadAccessory(ctx, cx, y, w, h, scale, look);

  ctx.fillStyle = style.belly;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.66, w * 0.26, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  const ex = facing * w * 0.12;
  const eyeY = y + h * 0.26;
  for (const side of [-1, 1]) {
    const px = cx + side * w * 0.22 + ex * 0.3;
    drawBuddyEye(ctx, px, eyeY, w, h, ex, side, scale, look);
  }
  drawBuddyFaceAccessory(ctx, cx, eyeY, w, ex, scale, look);

  drawBuddyMouth(ctx, cx + ex * 0.4, y + h * 0.46, w, h, scale, look);

  ctx.restore();
}

function drawBuddyEye(
  ctx: CanvasRenderingContext2D,
  px: number,
  eyeY: number,
  w: number,
  h: number,
  ex: number,
  side: number,
  scale: number,
  look: BuddyLook | null,
): void {
  const eyes = look?.eyes ?? 'normal';
  if (eyes === 'sleepy') {
    ctx.strokeStyle = '#23351f';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.arc(px + ex * 0.3, eyeY + h * 0.02, w * 0.12, 0.08 * Math.PI, 0.92 * Math.PI);
    ctx.stroke();
    return;
  }

  const eyeR = w * (eyes === 'wide' ? 0.18 : 0.16);
  const pupilR = w * (eyes === 'wide' ? 0.08 : 0.07);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.arc(px + ex, eyeY + 1, pupilR, 0, Math.PI * 2);
  ctx.fill();

  if (eyes === 'grumpy') {
    ctx.strokeStyle = '#23351f';
    ctx.lineWidth = 2.1 * scale;
    ctx.beginPath();
    ctx.moveTo(px - side * w * 0.1, eyeY - h * 0.18);
    ctx.lineTo(px + side * w * 0.1, eyeY - h * 0.1);
    ctx.stroke();
  }
}

function drawBuddyMouth(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  w: number,
  h: number,
  scale: number,
  look: BuddyLook | null,
): void {
  const mouth = look?.mouth ?? 'smile';
  ctx.strokeStyle = '#23351f';
  ctx.fillStyle = '#23351f';
  ctx.lineWidth = 2 * scale;

  if (mouth === 'grumpy') {
    ctx.beginPath();
    ctx.arc(mx, my + h * 0.13, w * 0.15, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
    return;
  }

  if (mouth === 'toothy') {
    roundRect(ctx, mx - w * 0.15, my - h * 0.02, w * 0.3, h * 0.12, 3 * scale);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#23351f';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx, my - h * 0.015);
    ctx.lineTo(mx, my + h * 0.09);
    ctx.stroke();
    return;
  }

  if (mouth === 'open') {
    ctx.beginPath();
    ctx.ellipse(mx, my + h * 0.03, w * 0.13, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8ca8';
    ctx.beginPath();
    ctx.ellipse(mx, my + h * 0.08, w * 0.07, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (mouth === 'sleepy') {
    ctx.beginPath();
    ctx.moveTo(mx - w * 0.11, my + h * 0.03);
    ctx.lineTo(mx + w * 0.11, my + h * 0.03);
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.arc(mx, my, w * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function drawBuddyHair(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  style: CharStyle,
  look: BuddyLook | null,
): void {
  if (!look || look.hair === 'none') return;
  ctx.save();
  ctx.strokeStyle = style.bodyDark;
  ctx.fillStyle = style.bodyDark;
  ctx.lineWidth = 3 * scale;
  ctx.lineCap = 'round';

  if (look.hair === 'tuft') {
    for (const dx of [-0.09, 0, 0.09]) {
      ctx.beginPath();
      ctx.moveTo(cx, y + h * 0.04);
      ctx.quadraticCurveTo(cx + w * dx, y - h * 0.14, cx + w * dx * 1.7, y - h * 0.04);
      ctx.stroke();
    }
  } else if (look.hair === 'curls') {
    for (const dx of [-0.18, 0, 0.18]) {
      ctx.beginPath();
      ctx.arc(cx + w * dx, y + h * 0.03, w * 0.085, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (look.hair === 'mohawk') {
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * w * 0.08 - w * 0.045, y + h * 0.07);
      ctx.lineTo(cx + i * w * 0.08, y - h * 0.13);
      ctx.lineTo(cx + i * w * 0.08 + w * 0.045, y + h * 0.07);
      ctx.closePath();
      ctx.fill();
    }
  } else if (look.hair === 'swoop') {
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.24, y + h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.05, y - h * 0.12, cx + w * 0.28, y - h * 0.02, cx + w * 0.12, y + h * 0.16);
    ctx.quadraticCurveTo(cx - w * 0.03, y + h * 0.1, cx - w * 0.24, y + h * 0.12);
    ctx.fill();
  } else if (look.hair === 'sprout') {
    ctx.strokeStyle = '#2f8f4c';
    ctx.beginPath();
    ctx.moveTo(cx, y + h * 0.03);
    ctx.lineTo(cx, y - h * 0.13);
    ctx.stroke();
    ctx.fillStyle = '#6bcb77';
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.08, y - h * 0.1, w * 0.09, h * 0.045, -0.6, 0, Math.PI * 2);
    ctx.ellipse(cx + w * 0.08, y - h * 0.1, w * 0.09, h * 0.045, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBuddyHeadAccessory(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  look: BuddyLook | null,
): void {
  if (!look || look.accessory === 'none' || look.accessory === 'glasses') return;
  ctx.save();
  ctx.lineWidth = 2 * scale;

  if (look.accessory === 'cap') {
    ctx.fillStyle = '#264653';
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.07, w * 0.31, h * 0.11, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - w * 0.28, y + h * 0.07, w * 0.5, h * 0.08);
    ctx.fillStyle = '#f4a261';
    ctx.fillRect(cx + w * 0.12, y + h * 0.1, w * 0.26, h * 0.035);
  } else if (look.accessory === 'partyHat') {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.18, y + h * 0.05);
    ctx.lineTo(cx, y - h * 0.28);
    ctx.lineTo(cx + w * 0.18, y + h * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d65f9b';
    ctx.stroke();
    ctx.fillStyle = '#ff5a9a';
    ctx.beginPath();
    ctx.arc(cx, y - h * 0.29, 4 * scale, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.accessory === 'bow') {
    ctx.fillStyle = '#ff5a9a';
    const bx = cx + w * 0.26;
    const by = y + h * 0.13;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - w * 0.16, by - h * 0.08);
    ctx.lineTo(bx - w * 0.14, by + h * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + w * 0.16, by - h * 0.08);
    ctx.lineTo(bx + w * 0.14, by + h * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd1e6';
    ctx.beginPath();
    ctx.arc(bx, by, 3.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.accessory === 'crown') {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.24, y + h * 0.03);
    ctx.lineTo(cx - w * 0.17, y - h * 0.15);
    ctx.lineTo(cx, y - h * 0.03);
    ctx.lineTo(cx + w * 0.17, y - h * 0.15);
    ctx.lineTo(cx + w * 0.24, y + h * 0.03);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b98500';
    ctx.stroke();
  } else if (look.accessory === 'propeller') {
    ctx.strokeStyle = '#23351f';
    ctx.beginPath();
    ctx.moveTo(cx, y + h * 0.02);
    ctx.lineTo(cx, y - h * 0.16);
    ctx.stroke();
    ctx.fillStyle = '#4d96ff';
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.12, y - h * 0.17, w * 0.16, h * 0.035, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + w * 0.12, y - h * 0.17, w * 0.16, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBuddyFaceAccessory(
  ctx: CanvasRenderingContext2D,
  cx: number,
  eyeY: number,
  w: number,
  ex: number,
  scale: number,
  look: BuddyLook | null,
): void {
  if (look?.accessory !== 'glasses') return;
  ctx.save();
  ctx.strokeStyle = '#23351f';
  ctx.lineWidth = 1.8 * scale;
  const r = w * 0.17;
  const lx = cx - w * 0.22 + ex * 0.3;
  const rx = cx + w * 0.22 + ex * 0.3;
  ctx.beginPath();
  ctx.arc(lx, eyeY, r, 0, Math.PI * 2);
  ctx.arc(rx, eyeY, r, 0, Math.PI * 2);
  ctx.moveTo(lx + r, eyeY);
  ctx.lineTo(rx - r, eyeY);
  ctx.stroke();
  ctx.restore();
}

function drawWeather(view: View, theme: Theme): void {
  if (theme.weather === 'none') return;
  const { ctx, dpr, cssW, cssH } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cycleH = cssH + 60;
  const count = theme.weather === 'snow' ? 44 : 28;
  const leafColors = ['#e07b39', '#d2a23c', '#c4502e', '#e6a04d'];

  for (let i = 0; i < count; i++) {
    const speed = 26 + (i % 5) * 12;
    const y = (((view.time * speed + i * 53) % cycleH) + cycleH) % cycleH - 30;
    const baseX = (((i * 97) % 100) / 100) * cssW;
    const sway = Math.sin(view.time * 1.3 + i) * (theme.weather === 'snow' ? 14 : 26);
    const x = baseX + sway;

    if (theme.weather === 'snow') {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, i % 4 === 0 ? 3.4 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (theme.weather === 'leaves') {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = leafColors[i % leafColors.length];
      drawLeaf(ctx, x, y, 6, view.time * 2 + i);
    } else {
      // petals
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = i % 2 === 0 ? '#ffd1e6' : '#ffb6d5';
      drawPetal(ctx, x, y, 5, view.time * 1.6 + i);
    }
  }
  ctx.globalAlpha = 1;
}

function drawLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPetal(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- small helpers ----------------------------------------------------------

function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 16, size / 16);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.bezierCurveTo(-11, -2, -8, -12, 0, -6);
  ctx.bezierCurveTo(8, -12, 11, -2, 0, 5);
  ctx.fill();
  ctx.restore();
}
