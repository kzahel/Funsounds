// Barrel Hop — Canvas 2D renderer. Bright, flat, friendly; cheap to draw so it
// holds 60fps on an old laptop. Background is drawn in screen space (parallax),
// the world in scaled world space. Colors come from the level's Theme; barrels
// and the character stay constant so they're always easy to read.

import type { Barrel, Consumable, Level, Particle, Platform, WorldLayer } from './types';
import type { Theme } from './themes';
import { GROUND_Y, PLAYER_H, PLAYER_W, VIRTUAL_H } from './modes';
import { BUDDY_LOOKS, type BuddyLook, type BuddySpecies } from './buddy-looks';

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
  species: BuddySpecies;
  alpha: number;
  scale?: number;
}

export type WeddingPhase = 'idle' | 'kiss' | 'sparkle' | 'baby';
export type WeddingPartnerKind = 'buddy' | 'fish';

export interface WeddingRender {
  partnerX: number;
  partnerY: number;
  partnerKind: WeddingPartnerKind;
  partnerColorIndex: number;
  near: boolean;
  phase: WeddingPhase;
  phaseT: number;
  colorIndex: number;
  babySpecies: BuddySpecies;
  babyBaseX: number;
  babyBaseY: number;
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
  dir: number;
}

export interface TarantulaRender {
  x: number;
  y: number;
  dir: number;
  t: number;
  emergeT: number;
  torchX: number;
}

export interface FishRender {
  x: number;
  y: number;
  dir: number;
  t: number;
  carrying: boolean;
  kind: 'fish' | 'lantern';
}

export interface UfoRender {
  x: number;
  platformY: number;
  t: number;
  active: boolean;
}

export type GatewayRenderKind = 'rocket' | 'vine' | 'dragonDoor' | 'shellGate';

export interface GatewayRender {
  x: number;
  platformY: number;
  kind: GatewayRenderKind;
  locked: boolean;
  active: boolean;
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
  worldBuddies: BuddyRender[];
  wedding?: WeddingRender;
  world: WorldLayer;
  skyRideT: number;
  atmosphereLiftT: number;
  undergroundLiftT: number;
  underwaterLiftT: number;
  consumables: Consumable[];
  ufo?: UfoRender;
  gateways: GatewayRender[];
  bird?: BirdRender;
  snake?: SnakeRender;
  tarantulas: TarantulaRender[];
  fish?: FishRender;
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
const WEDDING_KISS_DUR = 0.9;
const WEDDING_BABY_POP_DUR = 1.35;
const WEDDING_BABY_CRY_DUR = 3.2;
const WEDDING_BABY_START_SCALE = 0.38;
const BIRD_RENDER_W = 72;
const BIRD_RENDER_H = 42;
const TARANTULA_RENDER_W = 42;

// Distinct, friendly colors for the trailing buddies.
export const BUDDY_STYLES: CharStyle[] = [
  { body: '#5aa9ff', bodyDark: '#3a7fd0', belly: '#d2e9ff' }, // blue
  { body: '#c08bff', bodyDark: '#8f5fd0', belly: '#ecd9ff' }, // purple
  { body: '#ffb24d', bodyDark: '#d98a2b', belly: '#ffe6c2' }, // orange
  { body: '#ff8fc4', bodyDark: '#d65f9b', belly: '#ffd9ec' }, // pink
  { body: '#4fd0c4', bodyDark: '#2fa79b', belly: '#cdf3ee' }, // teal
  { body: '#ff6b6b', bodyDark: '#c94545', belly: '#ffd3d3' }, // red
  { body: '#ffd93d', bodyDark: '#d8a819', belly: '#fff2a8' }, // yellow
  { body: '#6c7dff', bodyDark: '#4558d1', belly: '#d9defe' }, // indigo
  { body: '#9be564', bodyDark: '#69ad39', belly: '#e5ffd0' }, // lime
  { body: '#ff7ad9', bodyDark: '#c64aa5', belly: '#ffd5f3' }, // magenta
];

export function render(view: View, scene: Scene): void {
  const { ctx, dpr } = view;
  const theme = scene.theme;
  const candyWorld = scene.world === 'candy';
  const upperAtmosphereWorld = scene.world === 'upperAtmosphere';
  const undergroundWorld = scene.world === 'cave';
  const underwaterWorld = scene.world === 'underwater';
  const deepSeaWorld = scene.world === 'deepSea';
  drawBackground(
    view,
    theme,
    scene.world,
    scene.skyRideT,
    scene.atmosphereLiftT,
    scene.undergroundLiftT,
    scene.underwaterLiftT,
  );

  // World space transform (scale + camera), folded with device pixel ratio.
  const s = view.scale * dpr;
  ctx.setTransform(s, 0, 0, s, -view.cameraX * s, 0);

  if (scene.ufo) drawUfo(ctx, scene.ufo);
  drawPlatforms(ctx, scene.level.platforms, theme, scene.world);
  for (const gateway of scene.gateways) drawGateway(ctx, gateway);
  if (scene.level.leftGoalX !== undefined) {
    drawEndpoint(ctx, scene.level.leftGoalX, view.time, 0, -1, candyWorld);
  }
  drawGoal(ctx, scene.level, view.time, scene.flagDown, candyWorld);
  if (scene.wedding) drawWeddingDecor(ctx, scene.level, scene.wedding, view.time);
  if (undergroundWorld) drawUndergroundDecor(ctx, scene.level, view.time);
  if (underwaterWorld) drawUnderwaterDecor(ctx, scene.level, view.time);
  if (deepSeaWorld) drawDeepSeaDecor(ctx, scene.level, view.time);
  if (scene.world === 'moonBase') drawMoonBaseDecor(ctx, scene.level, view.time);
  if (scene.world === 'dinosaurJungle') drawDinosaurJungleDecor(ctx, scene.level, view.time);
  if (scene.world === 'volcano') drawVolcanoDecor(ctx, scene.level, view.time);
  if (scene.world === 'sunkenCastle') drawSunkenCastleDecor(ctx, scene.level, view.time);
  for (const b of scene.level.barrels) {
    if (deepSeaWorld) drawDeepSeaObstacle(ctx, b);
    else if (underwaterWorld) drawUnderwaterObstacle(ctx, b);
    else if (undergroundWorld) drawCaveObstacle(ctx, b);
    else if (upperAtmosphereWorld) drawUpperAtmosphereObstacle(ctx, b);
    else if (candyWorld) drawCandyObstacle(ctx, b);
    else if (scene.world === 'moonBase') drawMoonBaseObstacle(ctx, b);
    else if (scene.world === 'dinosaurJungle') drawDinosaurJungleObstacle(ctx, b);
    else if (scene.world === 'volcano') drawVolcanoObstacle(ctx, b);
    else if (scene.world === 'sunkenCastle') drawSunkenCastleObstacle(ctx, b);
    else drawBarrel(ctx, b);
  }
  if (candyWorld) drawCandyBunnies(ctx, scene.level, view.time);
  if (undergroundWorld) {
    for (const tarantula of scene.tarantulas) drawTarantula(ctx, tarantula);
  }
  if (scene.snake) drawSnake(ctx, scene.snake);
  if (scene.fish) drawFish(ctx, scene.fish);
  drawConsumables(ctx, scene.consumables, view.time);
  drawParticles(ctx, scene.particles);
  if (scene.bird) drawBird(ctx, scene.bird);

  // Waiting buddies live in the current world; follower buddies trail behind.
  for (const bd of scene.worldBuddies) {
    drawBuddy(ctx, scene.level, bd, view.time);
  }

  // Draw the trail farthest-first so nearer ones overlap on top, then the
  // player on top of all.
  for (let i = scene.buddies.length - 1; i >= 0; i--) {
    drawBuddy(ctx, scene.level, scene.buddies[i], view.time);
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
  if (scene.world === 'surface') {
    drawWeather(view, theme);
  }
}

function drawBuddy(ctx: CanvasRenderingContext2D, level: Level, bd: BuddyRender, time: number): void {
  const style = BUDDY_STYLES[bd.colorIndex % BUDDY_STYLES.length];
  const look = BUDDY_LOOKS[bd.variantIndex % BUDDY_LOOKS.length];
  const buddyScale = (bd.scale ?? 1) * look.size;
  const buddyW = PLAYER_W * buddyScale * look.width;
  const buddyH = PLAYER_H * buddyScale * look.height;
  const bx = bd.x + (PLAYER_W - buddyW) / 2;
  const by = bd.y + PLAYER_H - buddyH;
  drawCharacter(
    ctx,
    level,
    bx,
    by,
    bd.vy,
    bd.grounded,
    bd.facing,
    time,
    style,
    bd.alpha,
    false,
    buddyScale,
    look,
    bd.species,
  );
}

function drawBackground(
  view: View,
  theme: Theme,
  world: WorldLayer,
  skyRideT: number,
  atmosphereLiftT: number,
  undergroundLiftT: number,
  underwaterLiftT: number,
): void {
  const { ctx, dpr, cssW, cssH } = view;
  const candyWorld = world === 'candy';
  const upperAtmosphereWorld = world === 'upperAtmosphere';
  const undergroundWorld = world === 'cave';
  const underwaterWorld = world === 'underwater';
  const deepSeaWorld = world === 'deepSea';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, cssH);
  if (world === 'sunkenCastle') {
    sky.addColorStop(0, '#041f45');
    sky.addColorStop(0.5, '#075780');
    sky.addColorStop(1, '#15829a');
  } else if (world === 'volcano') {
    sky.addColorStop(0, '#190b1b');
    sky.addColorStop(0.55, '#5b1820');
    sky.addColorStop(1, '#e24b20');
  } else if (world === 'dinosaurJungle') {
    sky.addColorStop(0, '#0c4c38');
    sky.addColorStop(0.48, '#258663');
    sky.addColorStop(1, '#8edc79');
  } else if (world === 'moonBase') {
    sky.addColorStop(0, '#01020d');
    sky.addColorStop(0.55, '#080c28');
    sky.addColorStop(1, '#14183c');
  } else if (upperAtmosphereWorld) {
    sky.addColorStop(0, '#050829');
    sky.addColorStop(0.5, '#15245f');
    sky.addColorStop(1, '#526bc7');
  } else if (deepSeaWorld) {
    sky.addColorStop(0, '#010717');
    sky.addColorStop(0.55, '#021224');
    sky.addColorStop(1, '#00030a');
  } else if (underwaterWorld) {
    sky.addColorStop(0, '#063b5b');
    sky.addColorStop(0.48, '#075c78');
    sky.addColorStop(1, '#0b263f');
  } else if (undergroundWorld) {
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

  if (world === 'sunkenCastle') drawSunkenCastleBackground(view);
  else if (world === 'volcano') drawVolcanoBackground(view);
  else if (world === 'dinosaurJungle') drawDinosaurJungleBackground(view);
  else if (world === 'moonBase') drawMoonBaseBackground(view);
  else if (upperAtmosphereWorld) drawUpperAtmosphereBackground(view);
  else if (deepSeaWorld) drawDeepSeaBackground(view);
  else if (underwaterWorld) drawUnderwaterBackground(view);
  else if (undergroundWorld) drawCaveBackground(view);
  if (world === 'surface' && theme.stars) drawStars(view);
  if ((world === 'surface' || candyWorld)) {
    if (!candyWorld) drawCelestial(view, theme);
    else drawCandySky(view);
  }

  // Drifting clouds (slow parallax).
  if (world === 'surface' || candyWorld) {
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
  if (world === 'sunkenCastle') {
    hills(ctx, view, '#0a4462', 0.18, groundScreenY + 14, 90, 250);
    hills(ctx, view, '#063247', 0.42, groundScreenY + 28, 65, 195);
  } else if (world === 'volcano') {
    hills(ctx, view, '#3b151d', 0.18, groundScreenY + 12, 120, 260);
    hills(ctx, view, '#211018', 0.42, groundScreenY + 28, 84, 205);
  } else if (world === 'dinosaurJungle') {
    hills(ctx, view, '#195a3f', 0.18, groundScreenY + 2, 130, 260);
    hills(ctx, view, '#123d2c', 0.42, groundScreenY + 20, 92, 210);
  } else if (world === 'moonBase') {
    hills(ctx, view, '#242747', 0.16, groundScreenY + 16, 72, 250);
    hills(ctx, view, '#14172f', 0.36, groundScreenY + 30, 52, 190);
  } else if (upperAtmosphereWorld) {
    // The glowing atmospheric limb is drawn by drawUpperAtmosphereBackground.
  } else if (deepSeaWorld) {
    hills(ctx, view, '#020815', 0.18, groundScreenY + 18, 92, 260);
    hills(ctx, view, '#01040b', 0.38, groundScreenY + 32, 68, 210);
  } else if (underwaterWorld) {
    hills(ctx, view, '#0a3650', 0.2, groundScreenY + 18, 72, 250);
    hills(ctx, view, '#063045', 0.42, groundScreenY + 30, 54, 190);
  } else if (undergroundWorld) {
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
  if (atmosphereLiftT > 0) drawUfoLift(view, atmosphereLiftT);
  if (undergroundLiftT > 0) drawCaveLift(view, undergroundLiftT);
  if (underwaterLiftT > 0) drawWaterLift(view, underwaterLiftT);
}

function drawUpperAtmosphereBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();

  // Dense twinkling stars make this feel higher than the ordinary night theme.
  for (let i = 0; i < 105; i++) {
    const x = (((i * 83 + 17) % 211) / 211) * cssW;
    const y = (((i * 137 + 31) % 173) / 173) * cssH * 0.78;
    const twinkle = 0.42 + 0.5 * Math.sin(view.time * (1.5 + (i % 4) * 0.18) + i * 1.9);
    ctx.globalAlpha = Math.max(0.18, twinkle);
    ctx.fillStyle = i % 11 === 0 ? '#ffe8a8' : i % 7 === 0 ? '#bcefff' : '#ffffff';
    if (i % 13 === 0) {
      star(ctx, x, y, 4.2, 1.7);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + (i % 4) * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A curved blue-white Earth limb peeks through below the playable clouds.
  ctx.globalAlpha = 1;
  const horizonY = cssH * 1.08;
  const glow = ctx.createRadialGradient(cssW / 2, horizonY, cssW * 0.34, cssW / 2, horizonY, cssW * 0.68);
  glow.addColorStop(0, 'rgba(190,240,255,0.9)');
  glow.addColorStop(0.52, 'rgba(86,165,255,0.44)');
  glow.addColorStop(1, 'rgba(60,100,210,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cssW / 2, horizonY, cssW * 0.72, cssH * 0.34, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(218,248,255,0.34)';
  for (let i = 0; i < 5; i++) {
    const x = ((i * 239 - view.cameraX * 0.06 + view.time * 4) % (cssW + 260)) - 110;
    cloud(ctx, x, cssH * (0.76 + (i % 2) * 0.08), 25 + (i % 3) * 7);
  }
  ctx.restore();
}

function drawMoonBaseBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();
  for (let i = 0; i < 92; i++) {
    const x = (((i * 97 + 29) % 223) / 223) * cssW;
    const y = (((i * 151 + 11) % 181) / 181) * cssH * 0.78;
    const glow = 0.42 + Math.sin(view.time * 1.7 + i * 2.1) * 0.25;
    ctx.globalAlpha = Math.max(0.2, glow);
    ctx.fillStyle = i % 9 === 0 ? '#b8ddff' : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 0.7 + (i % 4) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Earth hangs brightly over the quiet lunar horizon.
  ctx.globalAlpha = 1;
  const earthX = cssW * 0.79 - (view.cameraX * 0.025) % (cssW * 0.12);
  const earthY = cssH * 0.2;
  const earthGlow = ctx.createRadialGradient(earthX, earthY, 28, earthX, earthY, 70);
  earthGlow.addColorStop(0, 'rgba(130,205,255,0.5)');
  earthGlow.addColorStop(1, 'rgba(80,145,255,0)');
  ctx.fillStyle = earthGlow;
  ctx.beginPath();
  ctx.arc(earthX, earthY, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4fa9ef';
  ctx.beginPath();
  ctx.arc(earthX, earthY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8ee0a4';
  ctx.beginPath();
  ctx.ellipse(earthX - 8, earthY - 9, 13, 8, -0.4, 0, Math.PI * 2);
  ctx.ellipse(earthX + 10, earthY + 8, 11, 7, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.beginPath();
  ctx.arc(earthX - 8, earthY - 12, 29, 0.7 * Math.PI, 1.4 * Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

function drawDinosaurJungleBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();
  const sun = ctx.createRadialGradient(cssW * 0.18, cssH * 0.18, 8, cssW * 0.18, cssH * 0.18, 92);
  sun.addColorStop(0, 'rgba(255,243,154,0.7)');
  sun.addColorStop(1, 'rgba(255,243,154,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.fillStyle = 'rgba(6,54,35,0.62)';
  for (let i = 0; i < 14; i++) {
    const x = ((i * 97 - view.cameraX * 0.1) % (cssW + 160)) - 80;
    const sway = Math.sin(view.time * 0.8 + i) * 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 12 + sway, 90, x - 24 + sway, 145, x + 5, 215);
    ctx.lineWidth = 7 + (i % 3) * 2;
    ctx.strokeStyle = 'rgba(19,91,55,0.72)';
    ctx.stroke();
    ctx.fillStyle = i % 2 ? '#2d9360' : '#47aa67';
    ctx.beginPath();
    ctx.ellipse(x + 8 + sway, 102 + (i % 4) * 22, 27, 11, (i % 2 ? 1 : -1) * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  // A distant long-neck dinosaur gives the skyline a friendly silhouette.
  const dx = cssW * 0.76;
  const dy = cssH * 0.66;
  ctx.fillStyle = 'rgba(40,105,69,0.55)';
  ctx.beginPath();
  ctx.ellipse(dx, dy, 76, 34, 0, 0, Math.PI * 2);
  ctx.moveTo(dx + 45, dy - 12);
  ctx.quadraticCurveTo(dx + 76, dy - 104, dx + 95, dy - 117);
  ctx.quadraticCurveTo(dx + 119, dy - 126, dx + 122, dy - 105);
  ctx.quadraticCurveTo(dx + 88, dy - 93, dx + 72, dy);
  ctx.fill();
  ctx.restore();
}

function drawVolcanoBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();
  const glow = ctx.createRadialGradient(cssW * 0.5, cssH * 0.7, 10, cssW * 0.5, cssH * 0.7, cssW * 0.7);
  glow.addColorStop(0, 'rgba(255,115,34,0.55)');
  glow.addColorStop(1, 'rgba(255,65,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#160c13';
  ctx.beginPath();
  ctx.moveTo(cssW * 0.1, cssH * 0.74);
  ctx.lineTo(cssW * 0.32, cssH * 0.28);
  ctx.lineTo(cssW * 0.42, cssH * 0.7);
  ctx.lineTo(cssW * 0.63, cssH * 0.38);
  ctx.lineTo(cssW * 0.9, cssH * 0.74);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff6b24';
  ctx.beginPath();
  ctx.moveTo(cssW * 0.27, cssH * 0.39);
  ctx.lineTo(cssW * 0.32, cssH * 0.28);
  ctx.lineTo(cssW * 0.35, cssH * 0.42);
  ctx.quadraticCurveTo(cssW * 0.32, cssH * 0.36, cssW * 0.27, cssH * 0.39);
  ctx.fill();
  for (let i = 0; i < 34; i++) {
    const x = ((i * 79 - view.cameraX * 0.04) % (cssW + 60)) - 30;
    const y = cssH - ((view.time * (25 + i % 4 * 8) + i * 43) % (cssH * 0.78));
    ctx.globalAlpha = 0.25 + (i % 4) * 0.15;
    ctx.fillStyle = i % 3 === 0 ? '#ffe06a' : '#ff7a32';
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawSunkenCastleBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();
  // Watery light shafts and the silhouette of a distant many-towered castle.
  ctx.fillStyle = 'rgba(120,235,255,0.08)';
  for (let i = 0; i < 6; i++) {
    const x = ((i * 173 - view.cameraX * 0.04) % (cssW + 180)) - 90;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 45, 0);
    ctx.lineTo(x + 125, cssH);
    ctx.lineTo(x + 55, cssH);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(3,34,58,0.58)';
  const baseY = cssH * 0.74;
  ctx.fillRect(cssW * 0.55, baseY - 100, cssW * 0.4, 100);
  for (let i = 0; i < 4; i++) {
    const x = cssW * (0.57 + i * 0.105);
    const h = 128 + (i % 2) * 44;
    ctx.fillRect(x, baseY - h, 54, h);
    ctx.beginPath();
    ctx.moveTo(x - 8, baseY - h);
    ctx.lineTo(x + 27, baseY - h - 42);
    ctx.lineTo(x + 62, baseY - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(90,235,220,0.55)';
    ctx.fillRect(x + 22, baseY - h + 26, 10, 19);
    ctx.fillStyle = 'rgba(3,34,58,0.58)';
  }
  for (let i = 0; i < 28; i++) {
    const x = ((i * 83 + 21) % 227) / 227 * cssW;
    const y = cssH - ((view.time * (18 + i % 5 * 4) + i * 37) % (cssH + 40));
    ctx.strokeStyle = 'rgba(205,248,255,0.48)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 2 + (i % 4), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUfoLift(view: View, t: number): void {
  const { ctx, cssW, cssH } = view;
  const strength = Math.sin(Math.PI * clampNum(t, 0, 1));
  ctx.save();
  const beam = ctx.createLinearGradient(cssW * 0.5, 0, cssW * 0.5, cssH);
  beam.addColorStop(0, `rgba(190,255,245,${0.04 * strength})`);
  beam.addColorStop(0.55, `rgba(145,255,225,${0.2 * strength})`);
  beam.addColorStop(1, `rgba(255,248,170,${0.08 * strength})`);
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(cssW * 0.43, 0);
  ctx.lineTo(cssW * 0.25, cssH);
  ctx.lineTo(cssW * 0.75, cssH);
  ctx.lineTo(cssW * 0.57, 0);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 18; i++) {
    const y = cssH - ((t * 780 + i * 47) % (cssH + 80));
    const x = cssW * 0.5 + Math.sin(i * 2.3 + t * 12) * (28 + (i % 5) * 9);
    ctx.globalAlpha = strength * 0.75;
    ctx.fillStyle = i % 2 ? '#b7fff0' : '#fff2a8';
    star(ctx, x, y, 3 + (i % 3), 1.4);
  }
  ctx.restore();
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

  for (let i = 0; i < 18; i++) {
    const baseX = ((i * 137 - view.cameraX * 0.18) % (cssW + 120)) - 40;
    const x = baseX + Math.sin(view.time * 1.7 + i) * 18;
    const y = 84 + ((i * 59) % Math.max(1, cssH - 150)) + Math.cos(view.time * 1.3 + i) * 9;
    const glow = 0.38 + 0.28 * Math.sin(view.time * 5 + i * 1.9);
    ctx.fillStyle = `rgba(255,232,112,${glow})`;
    ctx.beginPath();
    ctx.arc(x, y, 3 + (i % 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,232,112,${glow * 0.18})`;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawUnderwaterBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();

  for (let i = 0; i < 5; i++) {
    const x = ((i * 233 - view.cameraX * 0.06) % (cssW + 260)) - 80;
    const ray = ctx.createLinearGradient(x, 0, x + 80, cssH);
    ray.addColorStop(0, 'rgba(150,230,255,0.22)');
    ray.addColorStop(1, 'rgba(150,230,255,0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 54, 0);
    ctx.lineTo(x + 136, cssH);
    ctx.lineTo(x + 24, cssH);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(190,245,255,0.42)';
  for (let i = 0; i < 36; i++) {
    const x = ((i * 89 - view.cameraX * 0.1) % (cssW + 120)) - 40;
    const y = cssH - ((view.time * (18 + (i % 5) * 6) + i * 47) % (cssH + 80));
    const r = 2 + (i % 4);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(210,250,255,0.6)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(5,38,48,0.46)';
  for (let x = -60 - ((view.cameraX * 0.22) % 90); x < cssW + 90; x += 90) {
    const base = cssH;
    const h = 74 + ((Math.floor(x) % 4 + 4) % 4) * 19;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.quadraticCurveTo(x + 18, base - h * 0.5, x + 4, base - h);
    ctx.quadraticCurveTo(x + 34, base - h * 0.45, x + 28, base);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawDeepSeaBackground(view: View): void {
  const { ctx, cssW, cssH } = view;
  ctx.save();

  for (let i = 0; i < 36; i++) {
    const x = ((i * 109 - view.cameraX * 0.07) % (cssW + 160)) - 60;
    const y = ((i * 71 + view.time * (5 + (i % 4))) % (cssH + 120)) - 60;
    const glow = 0.25 + 0.25 * Math.sin(view.time * 2.4 + i * 1.8);
    ctx.fillStyle = `rgba(100,230,255,${glow})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (i % 3) * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 5; i++) {
    const x = ((i * 251 - view.cameraX * 0.04) % (cssW + 300)) - 120;
    const y = cssH * (0.2 + (i % 4) * 0.16);
    const grad = ctx.createRadialGradient(x, y, 6, x, y, 140);
    grad.addColorStop(0, 'rgba(80,220,255,0.12)');
    grad.addColorStop(1, 'rgba(80,220,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, 140, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = -80 - ((view.cameraX * 0.2) % 120); x < cssW + 120; x += 120) {
    const h = 50 + ((Math.floor(x) % 5 + 5) % 5) * 18;
    ctx.beginPath();
    ctx.moveTo(x, cssH);
    ctx.quadraticCurveTo(x + 22, cssH - h * 0.7, x + 9, cssH - h);
    ctx.quadraticCurveTo(x + 46, cssH - h * 0.35, x + 38, cssH);
    ctx.closePath();
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

function drawWaterLift(view: View, t: number): void {
  const { ctx, cssW, cssH } = view;
  const a = Math.sin(Math.PI * clampNum(t, 0, 1));
  ctx.save();
  ctx.fillStyle = `rgba(170,245,255,${0.18 * a})`;
  ctx.beginPath();
  ctx.ellipse(cssW * 0.5, cssH * (0.58 - t * 0.45), cssW * 0.22, cssH * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 18; i++) {
    const x = ((i * 57) % cssW) + Math.sin(t * 10 + i) * 18;
    const y = cssH - ((t * 760 + i * 43) % (cssH + 80));
    ctx.strokeStyle = `rgba(210,250,255,${a * 0.7})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 3 + (i % 5), 0, Math.PI * 2);
    ctx.stroke();
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

function tinyPoof(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x - radius * 0.7, y + 3, radius * 0.62, 0, Math.PI * 2);
  ctx.arc(x, y - 2, radius, 0, Math.PI * 2);
  ctx.arc(x + radius * 0.78, y + 4, radius * 0.68, 0, Math.PI * 2);
  ctx.rect(x - radius * 1.3, y + 3, radius * 2.6, radius * 0.7);
  ctx.fill();
}

function drawUpperAtmospherePlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  // The playable ledge is a necklace of intentionally tiny, poofy clouds.
  const spacing = 34;
  const count = Math.max(2, Math.ceil(p.w / spacing));
  ctx.save();
  ctx.fillStyle = 'rgba(180,222,255,0.3)';
  roundRect(ctx, p.x, p.y + 6, p.w, Math.min(16, p.h), 8);
  ctx.fill();
  for (let i = 0; i <= count; i++) {
    const cx = p.x + (i / count) * p.w;
    const radius = 10 + ((i * 7) % 4);
    ctx.shadowColor = 'rgba(125,210,255,0.75)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = i % 4 === 0 ? '#e8f8ff' : '#ffffff';
    tinyPoof(ctx, cx, p.y + 3 + (i % 2) * 2, radius);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(153,215,255,0.5)';
  ctx.fillRect(p.x, p.y + 9, p.w, 5);
  ctx.restore();
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

function drawPlatforms(
  ctx: CanvasRenderingContext2D,
  platforms: Platform[],
  theme: Theme,
  world: WorldLayer,
): void {
  for (const p of platforms) {
    if (world === 'sunkenCastle') {
      drawSunkenCastlePlatform(ctx, p);
      continue;
    }
    if (world === 'volcano') {
      drawVolcanoPlatform(ctx, p);
      continue;
    }
    if (world === 'dinosaurJungle') {
      drawDinosaurJunglePlatform(ctx, p);
      continue;
    }
    if (world === 'moonBase') {
      drawMoonBasePlatform(ctx, p);
      continue;
    }
    if (world === 'upperAtmosphere') {
      drawUpperAtmospherePlatform(ctx, p);
      continue;
    }
    if (world === 'deepSea') {
      drawDeepSeaPlatform(ctx, p);
      continue;
    }
    if (world === 'underwater') {
      drawUnderwaterPlatform(ctx, p);
      continue;
    }
    if (world === 'cave') {
      drawCavePlatform(ctx, p);
      continue;
    }
    if (world === 'candy') {
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

function drawMoonBasePlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#777b91';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#505469';
    ctx.fillRect(p.x, p.y + p.h - 12, p.w, 12);
  } else {
    roundRect(ctx, p.x, p.y, p.w, p.h + 7, 10);
    ctx.fillStyle = '#74788d';
    ctx.fill();
  }
  ctx.fillStyle = '#aeb1c0';
  ctx.fillRect(p.x, p.y, p.w, 10);
  ctx.fillStyle = 'rgba(67,70,89,0.65)';
  for (let x = p.x + 26; x < p.x + p.w - 8; x += 74) {
    ctx.beginPath();
    ctx.ellipse(x, p.y + 6, 8 + (Math.floor(x) % 3), 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDinosaurJunglePlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#6c4b2d';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#432d20';
    ctx.fillRect(p.x, p.y + p.h - 11, p.w, 11);
  } else {
    roundRect(ctx, p.x, p.y, p.w, p.h + 8, 9);
    ctx.fillStyle = '#705034';
    ctx.fill();
  }
  ctx.fillStyle = '#3fad55';
  ctx.fillRect(p.x, p.y, p.w, 13);
  ctx.fillStyle = '#218743';
  for (let x = p.x + 8; x < p.x + p.w; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, p.y + 13);
    ctx.lineTo(x + 7, p.y + 21 + (Math.floor(x) % 3) * 3);
    ctx.lineTo(x + 12, p.y + 13);
    ctx.fill();
  }
}

function drawVolcanoPlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#291923';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#120b11';
    ctx.fillRect(p.x, p.y + p.h - 12, p.w, 12);
  } else {
    roundRect(ctx, p.x, p.y, p.w, p.h + 8, 8);
    ctx.fillStyle = '#2d1c25';
    ctx.fill();
  }
  ctx.fillStyle = '#4b2a2c';
  ctx.fillRect(p.x, p.y, p.w, 12);
  ctx.strokeStyle = '#ff662e';
  ctx.lineWidth = 3;
  for (let x = p.x + 28; x < p.x + p.w - 16; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x - 15, p.y + 5);
    ctx.lineTo(x, p.y + 9);
    ctx.lineTo(x + 12, p.y + 3);
    ctx.stroke();
  }
}

function drawSunkenCastlePlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#365e72';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#173d52';
    ctx.fillRect(p.x, p.y + p.h - 12, p.w, 12);
  } else {
    roundRect(ctx, p.x, p.y, p.w, p.h + 8, 5);
    ctx.fillStyle = '#426b79';
    ctx.fill();
  }
  ctx.strokeStyle = '#77b5b3';
  ctx.lineWidth = 2;
  const brickW = 42;
  for (let x = p.x; x < p.x + p.w; x += brickW) {
    ctx.strokeRect(x, p.y, Math.min(brickW, p.x + p.w - x), 14);
  }
  ctx.fillStyle = '#72d190';
  for (let x = p.x + 20; x < p.x + p.w; x += 110) {
    ctx.fillRect(x, p.y - 3, 30, 5);
  }
}

function drawDeepSeaPlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#061223';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#020711';
    ctx.fillRect(p.x, p.y + p.h - 12, p.w, 12);
  } else {
    roundRect(ctx, p.x, p.y, p.w, p.h + 8, 9);
    ctx.fillStyle = '#061223';
    ctx.fill();
  }

  ctx.fillStyle = '#143044';
  ctx.fillRect(p.x, p.y, p.w, 12);
  ctx.fillStyle = '#76fff0';
  for (let x = p.x + 28; x < p.x + p.w; x += 86) {
    const glow = 0.55 + ((Math.floor(x) % 3 + 3) % 3) * 0.13;
    ctx.globalAlpha = glow;
    ctx.beginPath();
    ctx.arc(x, p.y + 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawUnderwaterPlatform(ctx: CanvasRenderingContext2D, p: Platform): void {
  if (p.kind === 'ground') {
    ctx.fillStyle = '#0f5262';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#073240';
    ctx.fillRect(p.x, p.y + p.h - 12, p.w, 12);
  } else {
    roundRect(ctx, p.x, p.y, p.w, p.h + 8, 9);
    ctx.fillStyle = '#0f5262';
    ctx.fill();
  }

  ctx.fillStyle = '#2aa6a4';
  ctx.fillRect(p.x, p.y, p.w, 12);
  ctx.fillStyle = '#ffd3a2';
  for (let x = p.x + 20; x < p.x + p.w; x += 54) {
    ctx.beginPath();
    ctx.ellipse(x, p.y + 7, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ff7ab6';
  for (let x = p.x + 44; x < p.x + p.w - 20; x += 170) {
    ctx.beginPath();
    ctx.arc(x, p.y - 2, 9, Math.PI, 0);
    ctx.arc(x + 10, p.y - 2, 9, Math.PI, 0);
    ctx.arc(x + 20, p.y - 2, 9, Math.PI, 0);
    ctx.rect(x - 9, p.y - 2, 38, 10);
    ctx.fill();
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

function drawUpperAtmosphereObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  ctx.save();
  const rows = Math.max(1, Math.ceil(b.h / 24));
  for (let row = 0; row < rows; row++) {
    const y = b.y + b.h - 10 - row * 22;
    const offset = row % 2 === 0 ? 0 : 5;
    ctx.shadowColor = 'rgba(112,205,255,0.72)';
    ctx.shadowBlur = 7;
    ctx.fillStyle = row % 3 === 0 ? '#dff5ff' : '#ffffff';
    tinyPoof(ctx, b.x + b.w / 2 + offset, y, 12);
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(171,228,255,0.65)';
  ctx.lineWidth = 2;
  roundRect(ctx, b.x + 5, b.y + 4, b.w - 10, Math.max(12, b.h - 4), 12);
  ctx.stroke();
  ctx.restore();
}

function drawMoonBaseObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  ctx.save();
  if (b.id % 2 === 0) {
    ctx.fillStyle = '#d8dde8';
    roundRect(ctx, b.x + 4, b.y + 7, b.w - 8, b.h - 7, 8);
    ctx.fill();
    ctx.strokeStyle = '#687087';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#7ff0ff';
    ctx.fillRect(b.x + 12, b.y + 17, b.w - 24, 8);
    ctx.fillStyle = '#ff7aa8';
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + Math.min(40, b.h / 2), 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#565b71';
    ctx.beginPath();
    ctx.moveTo(b.x + 2, b.y + b.h);
    ctx.lineTo(b.x + 10, b.y + b.h * 0.38);
    ctx.lineTo(b.x + 24, b.y + 8);
    ctx.lineTo(b.x + b.w - 4, b.y + b.h * 0.35);
    ctx.lineTo(b.x + b.w - 1, b.y + b.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#80869a';
    ctx.beginPath();
    ctx.arc(b.x + 23, b.y + b.h * 0.55, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDinosaurJungleObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  ctx.save();
  if (b.id % 2 === 0) {
    // Mossy fallen log.
    roundRect(ctx, b.x + 2, b.y + 5, b.w - 4, b.h - 5, 13);
    ctx.fillStyle = '#754725';
    ctx.fill();
    ctx.strokeStyle = '#4b2d1e';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#3fae56';
    ctx.fillRect(b.x + 7, b.y + 6, b.w - 14, 9);
  } else {
    // A stack of bright, harmless dinosaur eggs.
    const rows = Math.max(1, Math.ceil(b.h / 26));
    for (let row = 0; row < rows; row++) {
      const cy = b.y + b.h - 13 - row * 24;
      ctx.fillStyle = row % 2 ? '#ffe38a' : '#dff5c5';
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, cy, 18, 13, row % 2 ? 0.2 : -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = row % 2 ? '#ff9f67' : '#65b97a';
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2 - 5, cy - 2, 3, 0, Math.PI * 2);
      ctx.arc(b.x + b.w / 2 + 6, cy + 4, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawVolcanoObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  ctx.save();
  ctx.fillStyle = '#1b1319';
  ctx.beginPath();
  ctx.moveTo(b.x + 2, b.y + b.h);
  ctx.lineTo(b.x + 8, b.y + b.h * 0.45);
  ctx.lineTo(b.x + 18, b.y + 7);
  ctx.lineTo(b.x + 29, b.y + b.h * 0.37);
  ctx.lineTo(b.x + b.w - 4, b.y + b.h * 0.2);
  ctx.lineTo(b.x + b.w - 1, b.y + b.h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ff5f2a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(b.x + 18, b.y + 8);
  ctx.lineTo(b.x + 25, b.y + b.h * 0.55);
  ctx.lineTo(b.x + 38, b.y + b.h * 0.72);
  ctx.stroke();
  ctx.restore();
}

function drawSunkenCastleObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  ctx.save();
  ctx.fillStyle = b.id % 2 === 0 ? '#547b86' : '#6b8f91';
  roundRect(ctx, b.x + 2, b.y + 3, b.w - 4, b.h - 3, 5);
  ctx.fill();
  ctx.strokeStyle = '#a3d5c9';
  ctx.lineWidth = 2;
  for (let y = b.y + 16; y < b.y + b.h; y += 23) {
    ctx.beginPath();
    ctx.moveTo(b.x + 4, y);
    ctx.lineTo(b.x + b.w - 4, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff8ebc';
  ctx.beginPath();
  ctx.arc(b.x + b.w / 2, b.y + 4, 9, Math.PI, 0);
  ctx.fill();
  ctx.restore();
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

function drawUnderwaterObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  if (b.id % 2 === 0) {
    ctx.fillStyle = '#ff7ab6';
    roundRect(ctx, b.x + 2, b.y + 8, b.w - 4, b.h - 8, 10);
    ctx.fill();
    ctx.fillStyle = '#ffb4d6';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(b.x + 10 + i * 10, b.y + 9 + (i % 2) * 6, 7, Math.PI, 0);
      ctx.fill();
    }
    ctx.fillStyle = '#b83278';
    ctx.fillRect(b.x + 8, b.y + b.h - 8, b.w - 16, 5);
  } else {
    ctx.fillStyle = '#f0d48a';
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h * 0.68, b.w * 0.44, b.h * 0.27, 0, Math.PI, 0);
    ctx.lineTo(b.x + b.w * 0.88, b.y + b.h * 0.7);
    ctx.quadraticCurveTo(b.x + b.w / 2, b.y + b.h * 0.28, b.x + b.w * 0.12, b.y + b.h * 0.7);
    ctx.fill();
    ctx.strokeStyle = '#b98f4b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff6d4';
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h * 0.56, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDeepSeaObstacle(ctx: CanvasRenderingContext2D, b: Barrel): void {
  if (b.id % 2 === 0) {
    ctx.fillStyle = '#10233a';
    roundRect(ctx, b.x + 2, b.y + 8, b.w - 4, b.h - 8, 9);
    ctx.fill();
    ctx.strokeStyle = '#2ef3e6';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = b.y + 14 + i * Math.max(8, b.h / 5);
      ctx.globalAlpha = 0.35 + i * 0.12;
      ctx.beginPath();
      ctx.moveTo(b.x + 9, y);
      ctx.quadraticCurveTo(b.x + b.w / 2, y - 8, b.x + b.w - 9, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#090d18';
    ctx.beginPath();
    ctx.moveTo(b.x + b.w * 0.12, b.y + b.h);
    ctx.lineTo(b.x + b.w * 0.3, b.y + b.h * 0.28);
    ctx.lineTo(b.x + b.w * 0.46, b.y + b.h);
    ctx.lineTo(b.x + b.w * 0.62, b.y + b.h * 0.18);
    ctx.lineTo(b.x + b.w * 0.86, b.y + b.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7dffdc';
    ctx.beginPath();
    ctx.arc(b.x + b.w * 0.48, b.y + b.h * 0.48, 4, 0, Math.PI * 2);
    ctx.arc(b.x + b.w * 0.64, b.y + b.h * 0.36, 3, 0, Math.PI * 2);
    ctx.fill();
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

function drawUnderwaterDecor(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  let drawn = 0;
  for (let i = 0; i < level.platforms.length; i++) {
    const p = level.platforms[i];
    if (p.w < 120) continue;
    for (let s = 0; s < Math.min(3, Math.floor(p.w / 170)); s++) {
      const x = p.x + 38 + ((i * 103 + s * 79) % Math.max(1, p.w - 80));
      drawSeaweed(ctx, x, p.y, time + i + s);
      drawn++;
      if (drawn > 16) return;
    }
    if (i % 2 === 1) {
      const x = p.x + 80 + ((i * 137) % Math.max(1, p.w - 120));
      drawTinyFish(ctx, x, p.y - 54 - (i % 3) * 18, time + i);
    }
  }
}

function drawDeepSeaDecor(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  let jelly = 0;
  let spiders = 0;
  for (let i = 0; i < level.platforms.length; i++) {
    const p = level.platforms[i];
    if (p.w < 120) continue;

    if (jelly < 9) {
      const slots = Math.min(2, Math.max(1, Math.floor(p.w / 320)));
      for (let s = 0; s < slots && jelly < 9; s++) {
        const x = p.x + 62 + ((i * 127 + s * 173) % Math.max(1, p.w - 124));
        const y = p.y - 118 - ((i + s) % 3) * 34 + Math.sin(time * 1.4 + i + s) * 9;
        drawJellyfish(ctx, x, y, time + i * 0.6 + s, jelly);
        jelly++;
      }
    }

    if (i % 2 === 0 && spiders < 4 && p.w >= 180) {
      const span = Math.max(1, p.w - 110);
      const crawl = (time * 23 + i * 61) % span;
      const x = p.x + 56 + crawl;
      drawDeepSeaSpider(ctx, x, p.y, time + i);
      spiders++;
    }
  }
}

function drawMoonBaseDecor(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  let rovers = 0;
  for (let i = 0; i < level.platforms.length && rovers < 4; i++) {
    const p = level.platforms[i];
    if (p.w < 190 || i % 2 !== 0) continue;
    const x = p.x + 70 + ((i * 137) % Math.max(1, p.w - 140));
    const y = p.y;
    const bob = Math.sin(time * 2 + i) * 1.5;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = '#e8edf7';
    roundRect(ctx, -27, -34, 54, 25, 7);
    ctx.fill();
    ctx.fillStyle = '#78dfff';
    ctx.fillRect(-17, -29, 34, 9);
    ctx.strokeStyle = '#c6cedd';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(0, -50);
    ctx.stroke();
    ctx.fillStyle = '#ff7aa8';
    ctx.beginPath();
    ctx.arc(0, -53, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#34394d';
    for (const dx of [-20, 20]) {
      ctx.beginPath();
      ctx.arc(dx, -7, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8991a7';
      ctx.beginPath();
      ctx.arc(dx, -7, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#34394d';
    }
    ctx.restore();
    rovers++;
  }
}

function drawDinosaurJungleDecor(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  let dinos = 0;
  for (let i = 0; i < level.platforms.length && dinos < 5; i++) {
    const p = level.platforms[i];
    if (p.w < 180 || i % 2 !== 1) continue;
    const x = p.x + 75 + ((i * 151) % Math.max(1, p.w - 150));
    const y = p.y - 2 - Math.max(0, Math.sin(time * 3 + i)) * 4;
    const dir = i % 4 < 2 ? 1 : -1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.fillStyle = dinos % 2 ? '#73c96b' : '#67b9d8';
    ctx.beginPath();
    ctx.ellipse(0, -18, 28, 18, 0, 0, Math.PI * 2);
    ctx.ellipse(24, -31, 15, 14, 0, 0, Math.PI * 2);
    ctx.moveTo(-22, -20);
    ctx.lineTo(-47, -34);
    ctx.lineTo(-29, -10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#355b42';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-13, -7);
    ctx.lineTo(-15, 0);
    ctx.moveTo(13, -7);
    ctx.lineTo(15, 0);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(29, -35, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#25352a';
    ctx.beginPath();
    ctx.arc(30, -34, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#355b42';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(31, -27, 6, 0.05 * Math.PI, 0.7 * Math.PI);
    ctx.stroke();
    ctx.restore();
    dinos++;
  }
}

function drawVolcanoDecor(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  const platform = level.platforms.find((p, index) => p.w >= 220 && index > 0) ?? level.platforms[0];
  if (!platform) return;
  const x = platform.x + Math.min(platform.w - 82, 112);
  const y = platform.y;
  const breathe = Math.sin(time * 2) * 2;
  ctx.save();
  ctx.translate(x, y + breathe);
  ctx.fillStyle = '#b54c68';
  ctx.beginPath();
  ctx.ellipse(0, -24, 46, 23, 0, 0, Math.PI * 2);
  ctx.ellipse(38, -34, 24, 19, 0, 0, Math.PI * 2);
  ctx.moveTo(-35, -28);
  ctx.lineTo(-70, -13);
  ctx.lineTo(-38, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e48262';
  ctx.beginPath();
  ctx.moveTo(-5, -38);
  ctx.lineTo(-25, -68);
  ctx.lineTo(8, -49);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4f2632';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(44, -39, 7, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = '#ffe06a';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText('z', 54, -60);
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText('z', 67, -72);
  ctx.restore();
}

function drawSunkenCastleDecor(ctx: CanvasRenderingContext2D, level: Level, time: number): void {
  let horses = 0;
  for (let i = 0; i < level.platforms.length && horses < 5; i++) {
    const p = level.platforms[i];
    if (p.w < 150 || i % 2 === 0) continue;
    const x = p.x + 65 + ((i * 139) % Math.max(1, p.w - 120));
    const y = p.y - 58 + Math.sin(time * 2.2 + i) * 7;
    const dir = i % 3 === 0 ? -1 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.strokeStyle = horses % 2 ? '#ffd05d' : '#ff91c6';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.quadraticCurveTo(-12, 2, 3, 20);
    ctx.quadraticCurveTo(17, 35, 20, 18);
    ctx.stroke();
    ctx.fillStyle = horses % 2 ? '#ffd05d' : '#ff91c6';
    ctx.beginPath();
    ctx.ellipse(7, -29, 12, 15, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2, -38);
    ctx.lineTo(-14, -30);
    ctx.lineTo(0, -26);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(11, -33, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#243844';
    ctx.beginPath();
    ctx.arc(12, -33, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    horses++;
  }
}

function drawJellyfish(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, colorIndex: number): void {
  const colors = ['#7dffdc', '#8fd6ff', '#ff8fc4'];
  const color = colors[colorIndex % colors.length];
  const pulse = 1 + Math.sin(time * 3.2) * 0.08;

  ctx.save();
  const glow = ctx.createRadialGradient(x, y, 4, x, y, 46);
  glow.addColorStop(0, color);
  glow.addColorStop(1, 'rgba(80,220,255,0)');
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 46, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.86;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, 20 * pulse, 14 * pulse, 0, Math.PI, 0);
  ctx.lineTo(x + 20 * pulse, y + 8);
  ctx.quadraticCurveTo(x, y + 18, x - 20 * pulse, y + 8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    const sway = Math.sin(time * 2.4 + i) * 8;
    ctx.beginPath();
    ctx.moveTo(x + i * 7, y + 9);
    ctx.quadraticCurveTo(x + i * 7 + sway, y + 28, x + i * 4 - sway * 0.4, y + 49);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDeepSeaSpider(ctx: CanvasRenderingContext2D, x: number, groundY: number, time: number): void {
  const step = Math.sin(time * 8);
  ctx.save();
  ctx.translate(x, groundY - 5);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(0, 4, 28, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#24364a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = -18 + i * 7;
      const reach = 24 + i * 5;
      const lift = step * (i % 2 === 0 ? 3 : -3);
      ctx.beginPath();
      ctx.moveTo(side * 8, y);
      ctx.quadraticCurveTo(side * 26, y - 16 + lift, side * reach, y + 7);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#111b2d';
  ctx.strokeStyle = '#52f4ff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, -14, 18, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(12, -23, 9, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#b8fff4';
  for (const eye of [8, 14]) {
    ctx.beginPath();
    ctx.arc(eye, -26, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSeaweed(ctx: CanvasRenderingContext2D, x: number, groundY: number, time: number): void {
  ctx.save();
  ctx.strokeStyle = '#31c98d';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const h = 28 + i * 8;
    const sway = Math.sin(time * 2.2 + i) * 8;
    ctx.beginPath();
    ctx.moveTo(x + i * 7, groundY);
    ctx.quadraticCurveTo(x + i * 7 + sway, groundY - h * 0.55, x + i * 7 - sway * 0.4, groundY - h);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTinyFish(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const dir = Math.sin(time) >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 3) * 4);
  ctx.scale(dir, 1);
  ctx.fillStyle = '#ffd86f';
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(-26, -9);
  ctx.lineTo(-26, 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.arc(7, -2, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

function drawTarantula(ctx: CanvasRenderingContext2D, tarantula: TarantulaRender): void {
  const emerge = smoothstep(clampNum(tarantula.emergeT, 0, 1));
  const crawlCx = tarantula.x + TARANTULA_RENDER_W / 2;
  const cx = lerpNum(tarantula.torchX, crawlCx, emerge);
  const cy = lerpNum(tarantula.y - 35, tarantula.y - 12, emerge) + Math.sin(tarantula.t * 9) * 1.4 * emerge;
  const legStep = Math.sin(tarantula.t * 11);

  ctx.save();
  ctx.globalAlpha = clampNum(0.35 + emerge * 0.65, 0, 1);
  if (emerge < 1) {
    ctx.strokeStyle = 'rgba(230,230,210,0.62)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tarantula.torchX, tarantula.y - 34);
    ctx.lineTo(cx, cy - 5);
    ctx.stroke();
  }

  ctx.translate(cx, cy);
  ctx.scale(tarantula.dir >= 0 ? 1 : -1, 1);

  ctx.strokeStyle = '#140c0a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = -5 + i * 4.2;
      const reach = 17 + (i % 2) * 4;
      const lift = legStep * (i % 2 === 0 ? 2.4 : -2.4);
      ctx.beginPath();
      ctx.moveTo(-4 + i * 2, y);
      ctx.quadraticCurveTo(side * 12, y - 9 + lift, side * reach, y - 4 + lift);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#2a1410';
  ctx.strokeStyle = '#080403';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(-7, 1, 15, 11, 0, 0, Math.PI * 2);
  ctx.ellipse(10, -2, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#7a3d25';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 6; i++) {
    const a = -0.7 + i * 0.28;
    ctx.beginPath();
    ctx.moveTo(-16 + i * 3.2, -8);
    ctx.lineTo(-18 + i * 3.2 + Math.cos(a) * 4, -14 + Math.sin(a) * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffb347';
  for (const eye of [6, 11]) {
    ctx.beginPath();
    ctx.arc(eye, -6, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: SnakeRender): void {
  if (snake.kind === 'trampoline') {
    drawTrampoline(ctx, snake);
    return;
  }

  const wave = Math.sin(snake.t * 5) * 3;
  ctx.save();
  ctx.translate(snake.x + 43, snake.y);
  ctx.scale(snake.dir >= 0 ? 1 : -1, 1);
  const x = -43;
  const y = 0;
  ctx.fillStyle = '#5bd66c';
  ctx.strokeStyle = '#2f8a3b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x + 36, y + 18 + wave, 34, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 66, y + 13 - wave * 0.4, 18, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe277';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(x + 15 + i * 12, y + 14 + Math.sin(snake.t * 4 + i) * 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + 72, y + 8, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.arc(x + 73, y + 8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff6b8a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 83, y + 14);
  ctx.lineTo(x + 94, y + 12);
  ctx.moveTo(x + 90, y + 12);
  ctx.lineTo(x + 96, y + 8);
  ctx.moveTo(x + 90, y + 12);
  ctx.lineTo(x + 97, y + 16);
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

function drawFish(ctx: CanvasRenderingContext2D, fish: FishRender, style: CharStyle | null = null): void {
  const swim = Math.sin(fish.t);
  if (fish.kind === 'lantern') {
    drawLanternFish(ctx, fish, swim);
    return;
  }

  ctx.save();
  ctx.translate(fish.x + 41, fish.y + 17);
  ctx.scale(fish.dir, 1);

  ctx.fillStyle = style?.body ?? '#ffb347';
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = style?.bodyDark ?? '#ff7ab6';
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(-52, -16 + swim * 4);
  ctx.lineTo(-48, 0);
  ctx.lineTo(-52, 16 - swim * 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = style?.belly ?? '#ffd86f';
  ctx.beginPath();
  ctx.ellipse(-2, -16, 14, 8, -0.3 + swim * 0.12, 0, Math.PI * 2);
  ctx.ellipse(-5, 16, 13, 7, 0.25 - swim * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(19, -5, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#23351f';
  ctx.beginPath();
  ctx.arc(21, -4, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#23351f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(24, 5, 7, 0.1 * Math.PI, 0.65 * Math.PI);
  ctx.stroke();

  if (fish.carrying) {
    ctx.strokeStyle = 'rgba(210,250,255,0.82)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 5, 33, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
  }

  ctx.restore();
}

function drawLanternFish(ctx: CanvasRenderingContext2D, fish: FishRender, swim: number): void {
  ctx.save();

  const glowX = fish.x + (fish.dir > 0 ? 78 : 4);
  const glowY = fish.y + 6 + swim * 2;
  const glow = ctx.createRadialGradient(glowX, glowY, 2, glowX, glowY, 70);
  glow.addColorStop(0, 'rgba(190,255,180,0.85)');
  glow.addColorStop(0.35, 'rgba(125,255,220,0.25)');
  glow.addColorStop(1, 'rgba(125,255,220,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(glowX, glowY, 70, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(fish.x + 41, fish.y + 17);
  ctx.scale(fish.dir, 1);

  ctx.fillStyle = '#111b32';
  ctx.strokeStyle = '#55f6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 35, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#24364f';
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(-54, -18 + swim * 5);
  ctx.lineTo(-46, 0);
  ctx.lineTo(-54, 18 - swim * 5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#7dffdc';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(16, -13);
  ctx.quadraticCurveTo(30, -34 + swim * 2, 43, -23 + swim * 3);
  ctx.stroke();
  ctx.fillStyle = '#d7ff8a';
  ctx.beginPath();
  ctx.arc(46, -23 + swim * 3, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(19, -4, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0d12';
  ctx.beginPath();
  ctx.arc(21, -4, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#7dffdc';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-8 + i * 6, -12);
    ctx.lineTo(-16 + i * 5, 11);
    ctx.stroke();
  }

  if (fish.carrying) {
    ctx.strokeStyle = 'rgba(125,255,220,0.82)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 5, 33, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
  }

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
  const partnerStyle = BUDDY_STYLES[wedding.partnerColorIndex % BUDDY_STYLES.length];

  if (wedding.partnerKind === 'fish') {
    drawWeddingFishPartner(ctx, wedding.partnerX, wedding.partnerY - partnerBounce, partnerFacing, time, partnerStyle);
  } else {
    drawCharacter(
      ctx,
      level,
      wedding.partnerX,
      wedding.partnerY - partnerBounce,
      0,
      true,
      partnerFacing,
      time,
      partnerStyle,
      1,
      false,
    );
  }

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
    x: wedding.partnerKind === 'fish'
      ? wedding.partnerX + PLAYER_W / 2 + partnerFacing * 35
      : wedding.partnerX + PLAYER_W / 2 + partnerFacing * PLAYER_W * 0.18,
    y: wedding.partnerKind === 'fish' ? wedding.partnerY + PLAYER_H * 0.58 : wedding.partnerY + PLAYER_H * 0.42,
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
  _playerX: number,
  time: number,
): void {
  const pop = smoothstep(clampNum(wedding.phaseT / WEDDING_BABY_POP_DUR, 0, 1));
  const scale = 0.32 + (WEDDING_BABY_START_SCALE - 0.32) * pop;
  const midX = wedding.babyBaseX + PLAYER_W / 2;
  const popHop = Math.max(0, Math.sin(time * 9)) * (16 - 4 * pop);
  const cradleHop = Math.max(0, Math.sin(time * 7)) * 3;
  const hop = wedding.phaseT < WEDDING_BABY_POP_DUR ? popHop : cradleHop;
  const topX = midX - (PLAYER_W * scale) / 2;
  const topY = wedding.babyBaseY + PLAYER_H - PLAYER_H * scale - hop;
  const style = BUDDY_STYLES[wedding.colorIndex % BUDDY_STYLES.length];
  const crying = wedding.phaseT < WEDDING_BABY_CRY_DUR;

  if (!crying) drawHeart(ctx, midX, topY - 20, 8 + 5 * Math.sin(time * 6) ** 2, '#ff5a9a');
  drawCharacter(ctx, level, topX, topY, hop > 1 ? -180 : 0, hop <= 1, 1, time, style, 1, false, scale, null, wedding.babySpecies);
  if (crying) drawCryingBabyOverlay(ctx, topX, topY, scale, time);
}

function drawWeddingFishPartner(
  ctx: CanvasRenderingContext2D,
  partnerX: number,
  partnerY: number,
  partnerFacing: number,
  time: number,
  style: CharStyle,
): void {
  const fishX = partnerX + PLAYER_W / 2 - 41;
  const fishY = partnerY + 13 + Math.sin(time * 3.2) * 3;
  drawFish(ctx, {
    x: fishX,
    y: fishY,
    dir: partnerFacing,
    t: time * 3.4,
    carrying: false,
    kind: 'fish',
  }, style);

  ctx.save();
  ctx.translate(partnerX + PLAYER_W / 2, fishY + 8);
  ctx.fillStyle = style.body;
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(-24, -8);
  ctx.lineTo(-22, 9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(8, -8);
  ctx.lineTo(9, 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = style.belly;
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

function drawGateway(ctx: CanvasRenderingContext2D, gateway: GatewayRender): void {
  if (gateway.kind === 'shellGate') {
    drawShellGateGateway(ctx, gateway);
    return;
  }
  if (gateway.kind === 'dragonDoor') {
    drawDragonDoorGateway(ctx, gateway);
    return;
  }
  if (gateway.kind === 'vine') {
    drawVineGateway(ctx, gateway);
    return;
  }
  const bob = Math.sin(gateway.t * 2.4) * 2;
  const baseY = gateway.platformY - 2 + bob;
  ctx.save();
  ctx.translate(gateway.x, baseY);
  ctx.shadowColor = gateway.locked ? '#9ca1b2' : '#78e8ff';
  ctx.shadowBlur = gateway.active ? 28 : 13;
  ctx.fillStyle = gateway.locked ? '#8c91a0' : '#f6f7fb';
  ctx.beginPath();
  ctx.moveTo(0, -118);
  ctx.quadraticCurveTo(31, -91, 27, -34);
  ctx.lineTo(-27, -34);
  ctx.quadraticCurveTo(-31, -91, 0, -118);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = gateway.locked ? '#696e7d' : '#ff668c';
  ctx.beginPath();
  ctx.moveTo(-27, -52);
  ctx.lineTo(-45, -18);
  ctx.lineTo(-20, -30);
  ctx.lineTo(20, -30);
  ctx.lineTo(45, -18);
  ctx.lineTo(27, -52);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = gateway.locked ? '#737887' : '#6cceff';
  ctx.beginPath();
  ctx.arc(0, -76, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#39435b';
  ctx.lineWidth = 3;
  ctx.stroke();
  const flame = gateway.active ? 25 + Math.sin(gateway.t * 18) * 6 : 10;
  ctx.fillStyle = gateway.locked ? '#777b88' : '#ffd65a';
  ctx.beginPath();
  ctx.moveTo(-10, -29);
  ctx.lineTo(0, flame);
  ctx.lineTo(10, -29);
  ctx.closePath();
  ctx.fill();
  if (gateway.locked) {
    ctx.fillStyle = '#f6e39a';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔒', 0, -57);
  }
  ctx.restore();
}

function drawShellGateGateway(ctx: CanvasRenderingContext2D, gateway: GatewayRender): void {
  const pulse = 1 + Math.sin(gateway.t * 2.7) * 0.04;
  ctx.save();
  ctx.translate(gateway.x, gateway.platformY);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = gateway.locked ? '#879899' : '#8ff5ff';
  ctx.shadowBlur = gateway.active ? 28 : 12;
  ctx.fillStyle = gateway.locked ? '#82898d' : '#efb2d5';
  ctx.beginPath();
  ctx.ellipse(0, -48, 52, 45, 0, Math.PI, 0);
  ctx.lineTo(52, -8);
  ctx.quadraticCurveTo(0, -33, -52, -8);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = gateway.locked ? '#a2aaad' : '#fff2c8';
  ctx.lineWidth = 4;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(0, -46);
    ctx.lineTo(i * 14, -82 + Math.abs(i) * 5);
    ctx.stroke();
  }
  ctx.fillStyle = gateway.locked ? '#a8adb0' : '#fff4c2';
  ctx.beginPath();
  ctx.arc(0, -35, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4b5968';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gateway.locked ? '🔒' : '🏰', 0, -29);
  ctx.restore();
}

function drawDragonDoorGateway(ctx: CanvasRenderingContext2D, gateway: GatewayRender): void {
  const glow = 0.75 + Math.sin(gateway.t * 3) * 0.2;
  ctx.save();
  ctx.translate(gateway.x, gateway.platformY);
  ctx.shadowColor = gateway.locked ? '#777' : '#ff7138';
  ctx.shadowBlur = gateway.active ? 28 : 14;
  ctx.fillStyle = gateway.locked ? '#55515a' : '#3d2430';
  ctx.beginPath();
  ctx.moveTo(-42, 0);
  ctx.lineTo(-42, -67);
  ctx.quadraticCurveTo(-42, -116, 0, -126);
  ctx.quadraticCurveTo(42, -116, 42, -67);
  ctx.lineTo(42, 0);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = gateway.locked ? '#7d7782' : '#f18a4c';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.globalAlpha = gateway.locked ? 0.35 : glow;
  ctx.fillStyle = '#ff5b2d';
  ctx.beginPath();
  ctx.moveTo(-25, -5);
  ctx.quadraticCurveTo(-35, -55, 0, -106);
  ctx.quadraticCurveTo(35, -55, 25, -5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffcf64';
  ctx.beginPath();
  ctx.moveTo(-36, -105);
  ctx.lineTo(-52, -130);
  ctx.lineTo(-25, -117);
  ctx.moveTo(36, -105);
  ctx.lineTo(52, -130);
  ctx.lineTo(25, -117);
  ctx.fill();
  ctx.fillStyle = '#f6e39a';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gateway.locked ? '🔒' : '🐉', 0, -67);
  ctx.restore();
}

function drawVineGateway(ctx: CanvasRenderingContext2D, gateway: GatewayRender): void {
  const sway = Math.sin(gateway.t * 1.8) * 5;
  ctx.save();
  ctx.translate(gateway.x, gateway.platformY);
  ctx.shadowColor = gateway.locked ? '#738176' : '#8cff8a';
  ctx.shadowBlur = gateway.active ? 24 : 10;
  ctx.strokeStyle = gateway.locked ? '#657169' : '#2d9b4d';
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-18 + sway, -45, 20 + sway, -86, sway, -142);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 4;
  ctx.strokeStyle = gateway.locked ? '#8b938d' : '#a9ed6d';
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const y = -18 - i * 18;
    const side = i % 2 === 0 ? -1 : 1;
    const x = Math.sin(i * 1.7) * 8 + sway * (i / 7);
    ctx.fillStyle = gateway.locked ? '#7b857e' : i % 3 === 0 ? '#64d46d' : '#42b95b';
    ctx.beginPath();
    ctx.ellipse(x + side * 14, y, 15, 7, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = gateway.locked ? '#9da5a0' : '#ffe066';
  ctx.font = 'bold 21px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gateway.locked ? '🔒' : '🦕', sway, -150);
  ctx.restore();
}

function drawUfo(ctx: CanvasRenderingContext2D, ufo: UfoRender): void {
  const hover = Math.sin(ufo.t * 2.3) * 5;
  const shipY = ufo.platformY - 132 + hover;
  ctx.save();

  const beam = ctx.createLinearGradient(ufo.x, shipY + 28, ufo.x, ufo.platformY);
  beam.addColorStop(0, ufo.active ? 'rgba(163,255,224,0.58)' : 'rgba(163,255,224,0.28)');
  beam.addColorStop(1, 'rgba(255,245,164,0.04)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(ufo.x - 31, shipY + 20);
  ctx.lineTo(ufo.x - 62, ufo.platformY);
  ctx.lineTo(ufo.x + 62, ufo.platformY);
  ctx.lineTo(ufo.x + 31, shipY + 20);
  ctx.closePath();
  ctx.fill();

  ctx.shadowColor = '#8dffe7';
  ctx.shadowBlur = ufo.active ? 22 : 12;
  ctx.fillStyle = '#8e9bd8';
  ctx.beginPath();
  ctx.ellipse(ufo.x, shipY + 12, 58, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9e0ff';
  ctx.beginPath();
  ctx.ellipse(ufo.x, shipY + 5, 44, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(160,244,255,0.78)';
  ctx.beginPath();
  ctx.arc(ufo.x, shipY - 7, 25, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // A tiny friendly alien waves from the dome.
  ctx.fillStyle = '#8eea72';
  ctx.beginPath();
  ctx.ellipse(ufo.x, shipY - 6, 11, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#17203e';
  ctx.beginPath();
  ctx.ellipse(ufo.x - 4, shipY - 8, 2.5, 3.5, -0.2, 0, Math.PI * 2);
  ctx.ellipse(ufo.x + 4, shipY - 8, 2.5, 3.5, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#35542e';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ufo.x, shipY - 3, 4, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  const lights = ['#ff78c8', '#7fffea', '#ffe66d', '#8ab7ff', '#ff78c8'];
  for (let i = 0; i < lights.length; i++) {
    ctx.fillStyle = lights[i];
    ctx.beginPath();
    ctx.arc(ufo.x - 34 + i * 17, shipY + 16, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawConsumables(ctx: CanvasRenderingContext2D, consumables: Consumable[], time: number): void {
  for (let i = 0; i < consumables.length; i++) {
    const food = consumables[i];
    const x = food.x + food.w / 2;
    const y = food.y + food.h / 2 + (food.kind === 'croissant' ? 3 : Math.sin(time * 3 + i * 1.7) * 1.5);
    ctx.save();
    ctx.shadowColor = 'rgba(255,236,145,0.58)';
    ctx.shadowBlur = 7;
    switch (food.kind) {
      case 'croissant':
        drawCroissant(ctx, x, y + 1, 21, -0.14);
        break;
      case 'strawberry':
        ctx.fillStyle = '#f34f62';
        ctx.beginPath();
        ctx.moveTo(x, y + 14);
        ctx.bezierCurveTo(x - 19, y - 3, x - 10, y - 13, x, y - 9);
        ctx.bezierCurveTo(x + 10, y - 13, x + 19, y - 3, x, y + 14);
        ctx.fill();
        ctx.fillStyle = '#69bd54';
        for (let leaf = -1; leaf <= 1; leaf++) {
          ctx.beginPath();
          ctx.ellipse(x + leaf * 7, y - 10, 7, 3.5, leaf * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#fff3a5';
        for (const [dx, dy] of [[-7, -1], [6, 1], [-3, 7], [2, -5]]) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'apple':
        ctx.fillStyle = '#ef4e55';
        ctx.beginPath();
        ctx.arc(x - 6, y + 3, 11, 0, Math.PI * 2);
        ctx.arc(x + 6, y + 3, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#714428';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 2, y - 15);
        ctx.stroke();
        ctx.fillStyle = '#64b957';
        ctx.beginPath();
        ctx.ellipse(x + 8, y - 12, 7, 3.5, -0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'cookie':
      case 'starCookie':
        ctx.fillStyle = food.kind === 'cookie' ? '#f6e8d0' : '#ffd872';
        if (food.kind === 'cookie') {
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#b9d9ee';
          ctx.lineWidth = 2;
          for (let arm = 0; arm < 6; arm++) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(arm * Math.PI / 3) * 10, y + Math.sin(arm * Math.PI / 3) * 10);
            ctx.stroke();
          }
        } else {
          star(ctx, x, y, 16, 7.5);
          ctx.fillStyle = '#fff3b1';
          ctx.beginPath();
          ctx.arc(x - 4, y - 2, 1.5, 0, Math.PI * 2);
          ctx.arc(x + 5, y + 3, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'orange':
        ctx.fillStyle = '#ff9c35';
        ctx.beginPath();
        ctx.arc(x, y + 2, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#60ae4f';
        ctx.beginPath();
        ctx.ellipse(x + 5, y - 12, 8, 3.5, -0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'gumdrop':
        ctx.fillStyle = i % 2 === 0 ? '#ff75bf' : '#8a78ff';
        ctx.beginPath();
        ctx.moveTo(x - 15, y + 12);
        ctx.quadraticCurveTo(x - 12, y - 13, x, y - 13);
        ctx.quadraticCurveTo(x + 12, y - 13, x + 15, y + 12);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (const [dx, dy] of [[-7, 3], [2, -5], [7, 5], [-3, 8]]) {
          ctx.fillRect(x + dx, y + dy, 2, 2);
        }
        break;
      case 'cheese':
        ctx.fillStyle = '#ffd65a';
        ctx.beginPath();
        ctx.moveTo(x - 17, y + 12);
        ctx.lineTo(x + 17, y + 12);
        ctx.lineTo(x + 10, y - 12);
        ctx.lineTo(x - 14, y - 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#d9a52d';
        for (const [dx, dy, r] of [[-7, 3, 3], [7, 5, 2.5], [4, -4, 2]]) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'moonCheese':
        ctx.fillStyle = '#fff08a';
        ctx.beginPath();
        ctx.arc(x, y, 16, 0.35 * Math.PI, 1.65 * Math.PI);
        ctx.arc(x + 8, y, 12, 1.55 * Math.PI, 0.45 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#d9b94e';
        for (const [dx, dy, r] of [[-7, -6, 2.5], [-8, 7, 3], [1, 10, 2]]) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'banana':
        ctx.fillStyle = '#ffe15a';
        ctx.strokeStyle = '#d3a92f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x - 1, y - 5, 18, 0.08 * Math.PI, 0.88 * Math.PI);
        ctx.arc(x + 3, y - 5, 12, 0.9 * Math.PI, 0.05 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#77552b';
        ctx.fillRect(x + 14, y - 9, 4, 6);
        break;
      case 'toastedMarshmallow':
        ctx.strokeStyle = '#8a5b35';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 15, y + 16);
        ctx.lineTo(x + 15, y - 15);
        ctx.stroke();
        ctx.save();
        ctx.translate(x + 4, y - 4);
        ctx.rotate(-0.75);
        roundRect(ctx, -11, -13, 22, 26, 8);
        ctx.fillStyle = '#fff0d2';
        ctx.fill();
        ctx.fillStyle = '#c97a43';
        ctx.fillRect(-11, 2, 22, 7);
        ctx.restore();
        break;
      case 'pearlCandy': {
        const pearlGlow = ctx.createRadialGradient(x - 5, y - 6, 2, x, y, 16);
        pearlGlow.addColorStop(0, '#ffffff');
        pearlGlow.addColorStop(0.45, '#ffe8fa');
        pearlGlow.addColorStop(1, '#b7dfff');
        ctx.fillStyle = pearlGlow;
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#efb2d5';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'kelp':
        ctx.strokeStyle = '#6fe08c';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y + 16);
        ctx.bezierCurveTo(x - 13, y + 5, x + 14, y - 4, x, y - 17);
        ctx.stroke();
        ctx.strokeStyle = '#c2f58e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 7, y + 12);
        ctx.quadraticCurveTo(x + 11, y + 2, x - 3, y - 12);
        ctx.stroke();
        break;
      case 'starfruit':
        ctx.fillStyle = '#b9ff73';
        star(ctx, x, y, 17, 8);
        ctx.fillStyle = '#f2ffaf';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    ctx.restore();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    if (p.kind === 'spark') {
      star(ctx, p.x, p.y, p.size, p.size * 0.45);
    } else if (p.kind === 'croissant') {
      drawCroissant(ctx, p.x, p.y, p.size, p.angle ?? 0);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawCroissant(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(size / 22, size / 22);

  ctx.fillStyle = '#d9902f';
  ctx.beginPath();
  ctx.ellipse(0, 2, 20, 12, 0, 0.12 * Math.PI, 0.88 * Math.PI);
  ctx.lineTo(-10, 5);
  ctx.quadraticCurveTo(0, 10, 10, 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f5bd58';
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 8, 0, 0.14 * Math.PI, 0.86 * Math.PI);
  ctx.lineTo(-7, 4);
  ctx.quadraticCurveTo(0, 6, 7, 4);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(128,75,20,0.45)';
  ctx.lineWidth = 2;
  for (const xMark of [-8, 0, 8]) {
    ctx.beginPath();
    ctx.moveTo(xMark - 3, -5);
    ctx.quadraticCurveTo(xMark, 0, xMark + 2, 6);
    ctx.stroke();
  }

  ctx.fillStyle = '#8d561d';
  for (const sx of [-6, 5, 12]) {
    ctx.beginPath();
    ctx.arc(sx, -3 + (sx % 2), 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
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
  species: BuddySpecies = 'buddy',
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

  if (species === 'fishBuddy') {
    drawFishBuddyTail(ctx, cx, y, w, h, facing, scale, time, style);
  } else {
    ctx.fillStyle = style.bodyDark;
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.22, feetY - 3 * scale, w * 0.2, 6 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + w * 0.22, feetY - 3 * scale, w * 0.2, 6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  roundRect(ctx, x, y, w, h, w * 0.42);
  ctx.fillStyle = style.body;
  ctx.fill();
  ctx.lineWidth = 2.5 * scale;
  ctx.strokeStyle = style.bodyDark;
  ctx.stroke();

  if (species === 'fishBuddy') drawFishBuddyFins(ctx, cx, y, w, h, facing, scale);

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

function drawFishBuddyTail(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  h: number,
  facing: number,
  scale: number,
  time: number,
  style: CharStyle,
): void {
  const tailX = cx - facing * w * 0.42;
  const tailY = y + h * 0.58;
  const flick = Math.sin(time * 7) * h * 0.04;
  ctx.save();
  ctx.fillStyle = '#42d6d9';
  ctx.strokeStyle = style.bodyDark;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(tailX, tailY);
  ctx.lineTo(tailX - facing * w * 0.35, tailY - h * 0.18 + flick);
  ctx.lineTo(tailX - facing * w * 0.24, tailY + flick * 0.2);
  ctx.lineTo(tailX - facing * w * 0.35, tailY + h * 0.18 - flick);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFishBuddyFins(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  h: number,
  facing: number,
  scale: number,
): void {
  ctx.save();
  ctx.fillStyle = '#7ff0ff';
  ctx.strokeStyle = '#2fa79b';
  ctx.lineWidth = 1.8 * scale;

  const frontX = cx + facing * w * 0.26;
  const sideY = y + h * 0.55;
  ctx.beginPath();
  ctx.moveTo(frontX, sideY);
  ctx.quadraticCurveTo(frontX + facing * w * 0.2, sideY + h * 0.03, frontX + facing * w * 0.12, sideY + h * 0.24);
  ctx.quadraticCurveTo(frontX - facing * w * 0.02, sideY + h * 0.14, frontX, sideY);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#2fa79b';
  ctx.lineWidth = 1.4 * scale;
  for (let i = 0; i < 3; i++) {
    const gx = cx - w * 0.07 + i * w * 0.07;
    ctx.beginPath();
    ctx.moveTo(gx, y + h * 0.33);
    ctx.lineTo(gx - facing * w * 0.07, y + h * 0.42);
    ctx.stroke();
  }
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
