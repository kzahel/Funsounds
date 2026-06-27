// Barrel Hop — game controller. Wires DOM + canvas + audio to the platformer
// core and the data-driven modes. Forgiving by design: hearts + instant respawn
// at the last checkpoint, no dead-end game-over.

import {
  isMobile,
  enterFullscreen,
  exitFullscreen,
  setupEscapeHold,
  setupFullscreenExit,
  preventContextMenu,
  speakText,
  shouldIgnoreGameKey,
  spawnConfetti,
  playCheer,
} from '../utils';
import {
  createLoop,
  makeBody,
  stepBody,
  clamp,
  lerp,
  DEFAULT_TUNING,
  type Body,
  type Loop,
  type MoveInput,
  type Solid,
  type Tuning,
} from './core';
import { MODES, MODE_ORDER, PLAYER_W, PLAYER_H, VIRTUAL_H } from './modes';
import { render, type Scene, type View } from './render';
import type { Barrel, Checkpoint, Level, ModeConfig, Particle } from './types';

const HEART_MAX = 3;
const INVULN_MS = 1100;
const MAX_PARTICLES = 200;
const tuning: Tuning = DEFAULT_TUNING;

let gameActive = false;
let mode: ModeConfig = MODES.easy;
let levelNum = 1;
let level: Level;
let solids: Solid[] = [];
let body: Body;

let score = 0;
let best = 0;
let hearts = HEART_MAX;
let combo = 0;
let invulnUntil = 0;
let lastCheckpoint: Checkpoint = { x: 0, y: 0 };
const scored = new Set<number>();
let particles: Particle[] = [];
let cameraX = 0;
let facing = 1;
let startTime = 0;
let toastTimer = 0;

// Input.
const moveCodes = new Set<string>();
const jumpCodes = new Set<string>();
let jumpEdge = false;

let loop: Loop;
let actx: AudioContext | null = null;

// DOM.
let screenEl: HTMLElement;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let modeChipEl: HTMLElement;
let scoreEl: HTMLElement;
let bestEl: HTMLElement;
let heartsEl: HTMLElement;
let statusEl: HTMLElement;
let toastEl: HTMLElement;

// --- audio ------------------------------------------------------------------

function ensureAudio(): void {
  if (actx) return;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    actx = new Ctor();
  } catch {
    actx = null;
  }
}

function tone(f0: number, f1: number, dur: number, type: OscillatorType, gain: number): void {
  if (!actx) return;
  const t = actx.currentTime;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(actx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const sfx = {
  jump: () => tone(380, 720, 0.16, 'square', 0.16),
  land: () => tone(240, 130, 0.09, 'sine', 0.14),
  score: () => tone(760, 1080, 0.18, 'triangle', 0.18),
  hurt: () => tone(320, 130, 0.26, 'sawtooth', 0.16),
};

// --- best score persistence -------------------------------------------------

function bestKey(id: string): string {
  return `barrelhop.best.${id}`;
}
function loadBest(id: string): number {
  const v = localStorage.getItem(bestKey(id));
  return v ? parseInt(v, 10) || 0 : 0;
}
function saveBest(id: string, value: number): void {
  try {
    localStorage.setItem(bestKey(id), String(value));
  } catch {
    /* ignore quota / private mode */
  }
}

// --- particles --------------------------------------------------------------

function spawnDust(x: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 160,
      vy: -Math.random() * 120,
      life: 0.4 + Math.random() * 0.2,
      maxLife: 0.6,
      size: 4 + Math.random() * 4,
      color: 'rgba(210,190,150,0.9)',
      kind: 'dust',
    });
  }
  capParticles();
}

function spawnSparks(x: number, y: number, count: number): void {
  const colors = ['#ffd23f', '#ffe98a', '#fff3b0', '#ffb347'];
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 260,
      vy: -100 - Math.random() * 220,
      life: 0.5 + Math.random() * 0.3,
      maxLife: 0.8,
      size: 6 + Math.random() * 5,
      color: colors[i % colors.length],
      kind: 'spark',
    });
  }
  capParticles();
}

function capParticles(): void {
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
}

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 900 * dt;
  }
}

// --- HUD --------------------------------------------------------------------

function updateHud(): void {
  modeChipEl.textContent = `${mode.emoji} ${mode.name}`;
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  if (mode.canFail) {
    heartsEl.textContent = '❤️'.repeat(hearts) + '🤍'.repeat(Math.max(0, HEART_MAX - hearts));
  } else {
    heartsEl.textContent = '∞';
  }
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function showToast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('visible'), 1600);
}

// --- level / run setup ------------------------------------------------------

function buildLevel(): void {
  level = mode.build(levelNum);
  solids = [
    ...level.platforms.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    ...level.barrels.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, ref: b })),
  ];
  body = makeBody(level.startX, level.startY, PLAYER_W, PLAYER_H);
  lastCheckpoint = { x: level.startX, y: level.startY };
  scored.clear();
  particles = [];
  cameraX = 0;
  invulnUntil = 0;
  facing = 1;
}

function respawn(cp: Checkpoint): void {
  body.x = cp.x;
  body.y = cp.y;
  body.prevX = cp.x;
  body.prevY = cp.y;
  body.vx = 0;
  body.vy = 0;
  body.grounded = false;
  body.jumping = false;
  body.coyote = 0;
  body.buffer = 0;
  // Let barrels ahead of the checkpoint be earned again on the retry.
  for (const b of level.barrels) {
    if (b.x + b.w > cp.x) scored.delete(b.id);
  }
  invulnUntil = performance.now() + INVULN_MS;
}

function loseHeart(): void {
  if (!mode.canFail) {
    respawn(lastCheckpoint);
    return;
  }
  const now = performance.now();
  if (now < invulnUntil) return;
  hearts--;
  combo = 0;
  sfx.hurt();
  spawnDust(body.x + PLAYER_W / 2, body.y + PLAYER_H, 8);
  if (hearts <= 0) {
    hearts = HEART_MAX;
    showToast("Let's try again! 💪");
  }
  respawn(lastCheckpoint);
  updateHud();
}

function addScore(points: number, x: number, y: number): void {
  score += points;
  combo++;
  if (score > best) {
    best = score;
    saveBest(mode.id, best);
  }
  sfx.score();
  spawnSparks(x, y, 8);
  if (combo >= 3) setStatus(`Combo x${combo}! 🔥`);
  updateHud();
}

function isBarrel(ref: unknown): ref is Barrel {
  return !!ref && typeof ref === 'object' && 'id' in (ref as object);
}

function nextLevel(): void {
  playCheer();
  spawnConfetti(screenEl);
  spawnSparks(body.x + PLAYER_W / 2, body.y, 16);
  if (score > best) {
    best = score;
    saveBest(mode.id, best);
  }
  showToast(`Level ${levelNum} done! ⭐`);
  levelNum++;
  hearts = HEART_MAX;
  buildLevel();
  updateHud();
}

// --- main loop --------------------------------------------------------------

function update(dt: number): void {
  if (!gameActive) return;

  const left = moveCodes.has('ArrowLeft') || moveCodes.has('KeyA');
  const right = moveCodes.has('ArrowRight') || moveCodes.has('KeyD');
  const input: MoveInput = {
    left,
    right,
    jumpHeld: jumpCodes.size > 0,
    jumpPressed: jumpEdge,
  };
  jumpEdge = false;
  if (right && !left) facing = 1;
  else if (left && !right) facing = -1;

  const res = stepBody(body, solids, input, tuning, dt);

  if (res.startedJump) {
    sfx.jump();
    spawnDust(body.x + PLAYER_W / 2, body.y + PLAYER_H, 5);
  }
  if (res.landed) {
    sfx.land();
    spawnDust(body.x + PLAYER_W / 2, body.y + PLAYER_H, 5);
  }

  // Scoring.
  const landedRef = res.landedOn?.ref;
  if (mode.scoreBy === 'on' || mode.scoreBy === 'either') {
    if (isBarrel(landedRef) && !scored.has(landedRef.id)) {
      scored.add(landedRef.id);
      addScore(1, body.x + PLAYER_W / 2, body.y);
    }
  }
  if (mode.scoreBy === 'over' || mode.scoreBy === 'either') {
    for (const b of level.barrels) {
      if (!scored.has(b.id) && body.x > b.x + b.w) {
        scored.add(b.id);
        addScore(1, b.x + b.w / 2, b.y);
      }
    }
  }

  // Bumping a barrel from the side is a miss in "jump over" mode.
  if (mode.id === 'easy' && res.wallHits.some((s) => isBarrel(s.ref))) {
    loseHeart();
  }

  // Falling into a pit.
  if (body.y > level.killY) {
    loseHeart();
  }

  // Advance checkpoints.
  for (const cp of level.checkpoints) {
    if (body.x > cp.x && cp.x > lastCheckpoint.x) lastCheckpoint = cp;
  }

  // Reached the flag.
  if (body.x + body.w / 2 > level.goalX) {
    nextLevel();
  }

  updateParticles(dt);
}

function renderFrame(alpha: number): void {
  if (!gameActive) return;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssH <= 0 || cssW <= 0) return;

  const scale = cssH / VIRTUAL_H;
  const viewW = cssW / scale;
  const px = lerp(body.prevX, body.x, alpha);
  const py = lerp(body.prevY, body.y, alpha);
  const maxCam = Math.max(0, level.width - viewW);
  cameraX = clamp(px + PLAYER_W / 2 - viewW * 0.4, 0, maxCam);

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const view: View = {
    ctx,
    dpr,
    cssW,
    cssH,
    scale,
    cameraX,
    viewW,
    time: (performance.now() - startTime) / 1000,
  };
  const scene: Scene = {
    level,
    px,
    py,
    vx: body.vx,
    vy: body.vy,
    grounded: body.grounded,
    facing,
    invuln: performance.now() < invulnUntil,
    particles,
  };
  render(view, scene);
}

// --- canvas sizing ----------------------------------------------------------

function resizeCanvas(): void {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
}

// --- run lifecycle ----------------------------------------------------------

async function startGame(modeId: string): Promise<void> {
  ensureAudio();
  if (isMobile) await enterFullscreen();

  mode = MODES[modeId] ?? MODES.easy;
  levelNum = 1;
  score = 0;
  hearts = HEART_MAX;
  combo = 0;
  best = loadBest(mode.id);

  document.getElementById('start-screen')!.style.display = 'none';
  screenEl.style.display = 'block';
  gameActive = true;

  startTime = performance.now();
  buildLevel();
  resizeCanvas();
  clearInput();
  updateHud();
  setStatus('Arrows move • hold Up to jump higher');
  speakText(mode.intro, { rate: 1, pitch: 1.2 });
  loop.start();
}

function stopGame(): void {
  loop.stop();
  gameActive = false;
  clearInput();
  toastEl.classList.remove('visible');
  screenEl.style.display = 'none';
  document.getElementById('start-screen')!.style.display = 'block';
}

function switchMode(modeId: string): void {
  if (!gameActive) return;
  startGame(modeId);
}

function clearInput(): void {
  moveCodes.clear();
  jumpCodes.clear();
  jumpEdge = false;
}

// --- input ------------------------------------------------------------------

const MOVE_CODES = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
const JUMP_CODES = new Set(['ArrowUp', 'Space', 'KeyW']);

function onKeyDown(event: KeyboardEvent): void {
  if (!gameActive) return;
  if (shouldIgnoreGameKey(event)) return;
  const code = event.code;

  if (code === 'Digit1') return void switchMode('practice');
  if (code === 'Digit2') return void switchMode('easy');
  if (code === 'Digit3') return void switchMode('hard');

  if (MOVE_CODES.has(code)) {
    event.preventDefault();
    moveCodes.add(code);
  } else if (JUMP_CODES.has(code)) {
    event.preventDefault();
    if (!event.repeat && !jumpCodes.has(code)) jumpEdge = true;
    jumpCodes.add(code);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (!gameActive) return;
  const code = event.code;
  if (MOVE_CODES.has(code)) {
    event.preventDefault();
    moveCodes.delete(code);
  } else if (JUMP_CODES.has(code)) {
    event.preventDefault();
    jumpCodes.delete(code);
  }
}

function bindTouchControls(): void {
  document.querySelectorAll<HTMLElement>('[data-jp-dir]').forEach((btn) => {
    const code = btn.dataset.jpDir!;
    const press = (e: Event) => {
      e.preventDefault();
      moveCodes.add(code);
    };
    const release = (e: Event) => {
      e.preventDefault();
      moveCodes.delete(code);
    };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  });

  document.querySelectorAll<HTMLElement>('[data-jp-jump]').forEach((btn) => {
    const press = (e: Event) => {
      e.preventDefault();
      if (!jumpCodes.has('Touch')) jumpEdge = true;
      jumpCodes.add('Touch');
    };
    const release = (e: Event) => {
      e.preventDefault();
      jumpCodes.delete('Touch');
    };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  });
}

// --- init -------------------------------------------------------------------

export async function initJumper(): Promise<void> {
  screenEl = document.getElementById('jumper-screen')!;
  canvas = document.getElementById('jp-canvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d')!;
  modeChipEl = document.getElementById('jp-mode')!;
  scoreEl = document.getElementById('jp-score')!;
  bestEl = document.getElementById('jp-best')!;
  heartsEl = document.getElementById('jp-hearts')!;
  statusEl = document.getElementById('jp-status')!;
  toastEl = document.getElementById('jp-toast')!;

  loop = createLoop(update, renderFrame);

  document.querySelectorAll<HTMLElement>('[data-jp-mode]').forEach((btn) => {
    btn.addEventListener('click', () => startGame(btn.dataset.jpMode!));
  });
  modeChipEl.addEventListener('click', () => {
    if (!gameActive) return;
    const i = MODE_ORDER.indexOf(mode.id);
    switchMode(String(MODE_ORDER[(i + 1) % MODE_ORDER.length]));
  });

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  bindTouchControls();

  window.addEventListener('blur', clearInput);
  window.addEventListener('resize', () => {
    if (gameActive) resizeCanvas();
  });

  setupEscapeHold(
    () => gameActive,
    () => {
      if (isMobile) exitFullscreen();
      stopGame();
    },
  );
  setupFullscreenExit(
    () => gameActive,
    () => stopGame(),
  );
  preventContextMenu(() => gameActive);
}
