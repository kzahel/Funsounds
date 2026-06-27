// Barrel Hop — Canvas 2D renderer. Bright, flat, friendly; cheap to draw so it
// holds 60fps on an old laptop. Background is drawn in screen space (parallax),
// the world in scaled world space.

import type { Barrel, Level, Particle, Platform } from './types';
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

export interface Scene {
  level: Level;
  px: number; // interpolated player top-left
  py: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: number; // 1 right, -1 left
  invuln: boolean;
  particles: Particle[];
}

const COLORS = {
  skyTop: '#8fd6ff',
  skyBottom: '#dff4ff',
  sun: '#fff4b0',
  hillFar: '#bfe89a',
  hillNear: '#9bdc79',
  grass: '#5fbe4a',
  grassDark: '#43a233',
  dirt: '#9c6a3c',
  dirtDark: '#7c5230',
  plank: '#caa15f',
  plankDark: '#a07b3f',
  barrel: '#cf8a3e',
  barrelLight: '#e0a85b',
  barrelDark: '#9c5f25',
  hoop: '#5f3a17',
  body: '#57c777',
  bodyDark: '#3da75d',
  belly: '#bdf0c5',
};

export function render(view: View, scene: Scene): void {
  const { ctx, dpr } = view;
  drawBackground(view);

  // World space transform (scale + camera), folded with device pixel ratio.
  const s = view.scale * dpr;
  ctx.setTransform(s, 0, 0, s, -view.cameraX * s, 0);

  drawPlatforms(ctx, scene.level.platforms);
  drawGoal(ctx, scene.level, view.time);
  for (const b of scene.level.barrels) drawBarrel(ctx, b);
  drawParticles(ctx, scene.particles);
  drawPlayer(ctx, scene, view.time);
}

function drawBackground(view: View): void {
  const { ctx, dpr, cssW, cssH } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, cssH);
  sky.addColorStop(0, COLORS.skyTop);
  sky.addColorStop(1, COLORS.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cssW, cssH);

  // Sun, top-right.
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.sun;
  ctx.beginPath();
  ctx.arc(cssW - 90, 90, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(cssW - 90, 90, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Drifting clouds (slow parallax).
  const cloudShift = (view.cameraX * 0.15 + view.time * 8) % (cssW + 240);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (let i = 0; i < 4; i++) {
    const cx = ((i * (cssW / 3) - cloudShift + cssW + 240) % (cssW + 240)) - 120;
    const cy = 70 + (i % 2) * 60;
    cloud(ctx, cx, cy, 50 + (i % 3) * 12);
  }

  // Rolling hills (two parallax layers), anchored to the ground line.
  const groundScreenY = GROUND_Y * view.scale;
  hills(ctx, view, COLORS.hillFar, 0.3, groundScreenY + 6, 120, 320);
  hills(ctx, view, COLORS.hillNear, 0.5, groundScreenY + 14, 90, 240);
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

function drawPlatforms(ctx: CanvasRenderingContext2D, platforms: Platform[]): void {
  for (const p of platforms) {
    if (p.kind === 'ground') {
      ctx.fillStyle = COLORS.dirt;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = COLORS.dirtDark;
      ctx.fillRect(p.x, p.y + p.h - 10, p.w, 10);
      ctx.fillStyle = COLORS.grass;
      ctx.fillRect(p.x, p.y, p.w, 14);
      ctx.fillStyle = COLORS.grassDark;
      ctx.fillRect(p.x, p.y + 13, p.w, 4);
    } else {
      roundRect(ctx, p.x, p.y, p.w, p.h + 6, 7);
      ctx.fillStyle = COLORS.plankDark;
      ctx.fill();
      roundRect(ctx, p.x, p.y, p.w, 12, 6);
      ctx.fillStyle = COLORS.grass;
      ctx.fill();
    }
  }
}

function drawBarrel(ctx: CanvasRenderingContext2D, b: Barrel): void {
  // Body.
  roundRect(ctx, b.x, b.y, b.w, b.h, 9);
  ctx.fillStyle = COLORS.barrel;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, b.x, b.y, b.w, b.h, 9);
  ctx.clip();

  // Vertical staves.
  const staves = 4;
  for (let i = 0; i < staves; i++) {
    ctx.fillStyle = i % 2 === 0 ? COLORS.barrelLight : COLORS.barrel;
    ctx.fillRect(b.x + (i * b.w) / staves, b.y, b.w / staves - 1.5, b.h);
  }
  // Hoops.
  ctx.fillStyle = COLORS.hoop;
  const hoopH = Math.max(4, b.h * 0.08);
  ctx.fillRect(b.x, b.y + b.h * 0.16, b.w, hoopH);
  ctx.fillRect(b.x, b.y + b.h * 0.74, b.w, hoopH);
  // Rim highlight on top.
  ctx.fillStyle = COLORS.barrelLight;
  ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, 4);
  ctx.restore();

  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.barrelDark;
  roundRect(ctx, b.x, b.y, b.w, b.h, 9);
  ctx.stroke();
}

function drawGoal(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  const x = level.goalX;
  const top = GROUND_Y - 130;
  ctx.fillStyle = '#cfd6df';
  ctx.fillRect(x - 3, top, 6, 130);
  ctx.fillStyle = '#8a929c';
  ctx.fillRect(x - 3, top, 3, 130);
  // Wavy flag.
  const wave = Math.sin(time * 4) * 4;
  ctx.fillStyle = '#ff5a5f';
  ctx.beginPath();
  ctx.moveTo(x + 3, top + 4);
  ctx.lineTo(x + 62, top + 16 + wave);
  ctx.lineTo(x + 3, top + 30);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(x - 3, top, 6, 0, Math.PI * 2);
  ctx.fill();
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

function drawPlayer(ctx: CanvasRenderingContext2D, scene: Scene, time: number): void {
  const cx = scene.px + PLAYER_W / 2;
  const feetY = scene.py + PLAYER_H;

  // Soft shadow on the ground line below the player.
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#1d3a1d';
  ctx.beginPath();
  ctx.ellipse(cx, GROUND_Y - 2, PLAYER_W * 0.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Squash & stretch from vertical speed; anchored at the feet.
  let sy = 1;
  if (!scene.grounded) sy = clampNum(1 + -scene.vy / 4200, 0.9, 1.16);
  const sx = 2 - sy;
  const w = PLAYER_W * sx;
  const h = PLAYER_H * sy;
  const x = cx - w / 2;
  const y = feetY - h;

  ctx.save();
  if (scene.invuln && Math.floor(time * 12) % 2 === 0) ctx.globalAlpha = 0.45;

  // Feet.
  ctx.fillStyle = COLORS.bodyDark;
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.22, feetY - 3, w * 0.2, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + w * 0.22, feetY - 3, w * 0.2, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body.
  roundRect(ctx, x, y, w, h, w * 0.42);
  ctx.fillStyle = COLORS.body;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = COLORS.bodyDark;
  ctx.stroke();

  // Belly.
  ctx.fillStyle = COLORS.belly;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.66, w * 0.26, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes (big, friendly), nudged toward facing.
  const ex = scene.facing * w * 0.12;
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

  // Smile.
  ctx.strokeStyle = '#23351f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx + ex * 0.4, y + h * 0.46, w * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

// --- small helpers ----------------------------------------------------------

function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
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
