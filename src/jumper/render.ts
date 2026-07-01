// Barrel Hop — Canvas 2D renderer. Bright, flat, friendly; cheap to draw so it
// holds 60fps on an old laptop. Background is drawn in screen space (parallax),
// the world in scaled world space. Colors come from the level's Theme; barrels
// and the character stay constant so they're always easy to read.

import type { Barrel, Level, Particle, Platform } from './types';
import type { Theme } from './themes';
import { GROUND_Y, PLAYER_H, PLAYER_W, VIRTUAL_H } from './modes';

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
const WEDDING_BABY_START_SCALE = 0.38;

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
  drawBackground(view, theme);

  // World space transform (scale + camera), folded with device pixel ratio.
  const s = view.scale * dpr;
  ctx.setTransform(s, 0, 0, s, -view.cameraX * s, 0);

  drawPlatforms(ctx, scene.level.platforms, theme);
  if (scene.level.leftGoalX !== undefined) {
    drawFlag(ctx, scene.level.leftGoalX, view.time, 0, -1);
  }
  drawGoal(ctx, scene.level, view.time, scene.flagDown);
  if (scene.wedding) drawWeddingDecor(ctx, scene.level, scene.wedding, view.time);
  for (const b of scene.level.barrels) drawBarrel(ctx, b);
  drawParticles(ctx, scene.particles);

  // Buddies trail behind; draw farthest-first so nearer ones overlap on top,
  // then the player on top of all.
  for (let i = scene.buddies.length - 1; i >= 0; i--) {
    const bd = scene.buddies[i];
    const style = BUDDY_STYLES[bd.colorIndex % BUDDY_STYLES.length];
    const buddyScale = bd.scale ?? 1;
    const bx = bd.x + (PLAYER_W * (1 - buddyScale)) / 2;
    const by = bd.y + PLAYER_H * (1 - buddyScale);
    drawCharacter(ctx, scene.level, bx, by, bd.vy, bd.grounded, bd.facing, view.time, style, bd.alpha, false, buddyScale);
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

function drawBackground(view: View, theme: Theme): void {
  const { ctx, dpr, cssW, cssH } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, cssH);
  sky.addColorStop(0, theme.skyTop);
  sky.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cssW, cssH);

  if (theme.stars) drawStars(view);
  drawCelestial(view, theme);

  // Drifting clouds (slow parallax).
  const cloudShift = (view.cameraX * 0.15 + view.time * 8) % (cssW + 240);
  ctx.fillStyle = theme.cloud;
  for (let i = 0; i < 4; i++) {
    const cx = ((i * (cssW / 3) - cloudShift + cssW + 240) % (cssW + 240)) - 120;
    const cy = 70 + (i % 2) * 60;
    cloud(ctx, cx, cy, 50 + (i % 3) * 12);
  }

  // Rolling hills (two parallax layers), anchored to the ground line.
  const groundScreenY = GROUND_Y * view.scale;
  hills(ctx, view, theme.hillFar, 0.3, groundScreenY + 6, 120, 320);
  hills(ctx, view, theme.hillNear, 0.5, groundScreenY + 14, 90, 240);
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

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.8, y + 6, r * 0.7, 0, Math.PI * 2);
  ctx.arc(x - r * 0.8, y + 8, r * 0.6, 0, Math.PI * 2);
  ctx.arc(x, y + 12, r * 0.9, 0, Math.PI * 2);
  ctx.fill();
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

function drawPlatforms(ctx: CanvasRenderingContext2D, platforms: Platform[], theme: Theme): void {
  for (const p of platforms) {
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

function drawGoal(ctx: CanvasRenderingContext2D, level: Level, time: number, flagDown: number): void {
  drawFlag(ctx, level.goalX, time, flagDown, 1);
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
  const hop = Math.max(0, Math.sin(time * 9)) * (16 - 4 * pop);
  const topX = midX - (PLAYER_W * scale) / 2;
  const topY = GROUND_Y - PLAYER_H * scale - hop;
  const style = BUDDY_STYLES[wedding.colorIndex % BUDDY_STYLES.length];

  drawHeart(ctx, midX, topY - 20, 8 + 5 * Math.sin(time * 6) ** 2, '#ff5a9a');
  drawCharacter(ctx, level, topX, topY, hop > 1 ? -180 : 0, hop <= 1, 1, time, style, 1, false, scale);
}

function kissBounce(t: number): number {
  return Math.max(0, Math.sin(clampNum(t / WEDDING_KISS_DUR, 0, 1) * Math.PI * 4)) * 4;
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
): void {
  const charW = PLAYER_W * scale;
  const charH = PLAYER_H * scale;
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

  ctx.fillStyle = style.belly;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.66, w * 0.26, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  const ex = facing * w * 0.12;
  const eyeY = y + h * 0.26;
  for (const side of [-1, 1]) {
    const px = cx + side * w * 0.22 + ex * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, eyeY, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#23351f';
    ctx.beginPath();
    ctx.arc(px + ex, eyeY + 1, w * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = '#23351f';
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.arc(cx + ex * 0.4, y + h * 0.46, w * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
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
