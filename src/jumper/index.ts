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
import { MODES, MODE_ORDER, GROUND_Y, PLAYER_W, PLAYER_H, VIRTUAL_H } from './modes';
import { render, type Scene, type View } from './render';
import { BuddyChain } from './buddies';
import { themeForLevel, type Theme } from './themes';
import type { Barrel, Checkpoint, Level, ModeConfig, Particle } from './types';

const HEART_MAX = 3;
const INVULN_MS = 1100;
const MAX_PARTICLES = 200;
const CELEBRATE_DUR = 1.7; // total celebration before advancing
const FLAG_DUR = 1.0; // time for the flag to slide all the way down
const LOOK_FRAC_RIGHT = 0.4;
const LOOK_FRAC_LEFT = 0.6;
const LOOK_FRAC_SHIFT_PER_SEC = 0.7; // full left/right bias change in ~0.3s
const WEDDING_INTERACT_DIST = 82;
const WEDDING_KISS_DUR = 0.9;
const WEDDING_BABY_WAIT = 0.9;
const WEDDING_BABY_POP_DUR = 1.35;
const WEDDING_BABY_START_SCALE = 0.38;
const WEDDING_BABY_GROW_DUR = 60;
const tuning: Tuning = DEFAULT_TUNING;
const NEUTRAL_INPUT: MoveInput = { left: false, right: false, jumpHeld: false, jumpPressed: false };

type WeddingEventPhase = 'kiss' | 'sparkle' | 'baby';
interface WeddingEvent {
  phase: WeddingEventPhase;
  t: number;
  colorIndex: number;
}

let gameActive = false;
let mode: ModeConfig = MODES.easy;
let levelNum = 1;
let level: Level;
let theme: Theme = themeForLevel(1);
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
let cameraLookFrac = LOOK_FRAC_RIGHT;
let facing = 1;
let startTime = 0;
let toastTimer = 0;
let phase: 'playing' | 'celebrating' = 'playing';
let celebrateT = 0;

// Buddy mode state.
let buddyDir = 1; // +1 heading to the right flag, -1 to the left flag
const chain = new BuddyChain();
let lastSafe = { x: 0, y: 0 }; // last ground-ledge stance, for respawns
let buddyReachedRightPlatform = false; // unlocks first-buddy collection at the start flag
let weddingReadyForSmooch = true;
let weddingEvent: WeddingEvent | null = null;

// Input.
const moveCodes = new Set<string>();
const jumpCodes = new Set<string>();
let jumpEdge = false;
let interactEdge = false;

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
let buddiesPillEl: HTMLElement;
let buddiesLabelEl: HTMLElement;
let buddiesEl: HTMLElement;
let statusEl: HTMLElement;
let toastEl: HTMLElement;
let touchInteractEl: HTMLElement;

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
  smooch: () => tone(660, 460, 0.18, 'sine', 0.13),
  baby: () => tone(760, 1180, 0.2, 'triangle', 0.15),
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

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return target;
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
  if (hasBuddyChain()) {
    buddiesPillEl.style.display = '';
    buddiesLabelEl.textContent = isWeddingMode() ? 'Mini buddies' : 'Buddies';
    buddiesEl.textContent = isWeddingMode() ? String(chain.count) : `${chain.count}/${mode.buddies}`;
  } else {
    buddiesPillEl.style.display = 'none';
  }
  touchInteractEl.classList.toggle('visible', isWeddingMode());
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

function startStatus(): string {
  return isWeddingMode() ? 'Reach the flag, then meet your partner.' : 'Arrows move • hold Up to jump higher';
}

// --- level / run setup ------------------------------------------------------

function buildLevel(): void {
  level = mode.build(levelNum);
  theme = themeForLevel(levelNum);
  solids = [
    ...level.platforms.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    ...level.barrels.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, ref: b })),
  ];
  body = makeBody(level.startX, level.startY, PLAYER_W, PLAYER_H);
  lastCheckpoint = { x: level.startX, y: level.startY };
  scored.clear();
  particles = [];
  cameraX = 0;
  cameraLookFrac = LOOK_FRAC_RIGHT;
  invulnUntil = 0;
  facing = 1;
  phase = 'playing';
  celebrateT = 0;
  buddyDir = 1;
  lastSafe = { x: level.startX, y: level.startY };
  buddyReachedRightPlatform = false;
  weddingReadyForSmooch = true;
  weddingEvent = null;
  chain.reset(level.startX, level.startY);
}

function isBuddyChallenge(): boolean {
  return mode.buddies !== undefined;
}

function isWeddingMode(): boolean {
  return mode.wedding === true;
}

function hasBuddyChain(): boolean {
  return isBuddyChallenge() || isWeddingMode();
}

function isRightGoalPlatform(solid: Solid | null | undefined): boolean {
  return !!solid && !isBarrel(solid.ref) && solid.x <= level.goalX && solid.x + solid.w >= level.goalX;
}

function weddingPartnerCenter(): { x: number; y: number } | null {
  if (level.partnerX === undefined) return null;
  return {
    x: level.partnerX + PLAYER_W / 2,
    y: (level.partnerY ?? GROUND_Y - PLAYER_H) + PLAYER_H / 2,
  };
}

function isNearWeddingPartner(): boolean {
  const partner = weddingPartnerCenter();
  if (!partner) return false;
  const cx = body.x + body.w / 2;
  const cy = body.y + body.h / 2;
  return Math.hypot(cx - partner.x, cy - partner.y) <= WEDDING_INTERACT_DIST;
}

function weddingInteractHint(): string {
  if (!weddingReadyForSmooch) return 'Return to the left flag first.';
  return isNearWeddingPartner() ? 'Press Down by your partner.' : 'Stand next to your partner after the flag.';
}

function maybeReadyWeddingSmooch(cx: number): boolean {
  if (!isWeddingMode() || weddingReadyForSmooch || weddingEvent || level.leftGoalX === undefined || cx >= level.leftGoalX) {
    return false;
  }
  weddingReadyForSmooch = true;
  showToast('Ready for another smoochie!');
  speakText('Ready for another smoochie!', { rate: 1.05, pitch: 1.3 });
  setStatus('Ready for another smoochie! Run to your partner.');
  return true;
}

function startWeddingSmooch(): boolean {
  if (!isWeddingMode() || weddingEvent || !weddingReadyForSmooch || !isNearWeddingPartner()) return false;
  const partner = weddingPartnerCenter();
  if (!partner) return false;

  body.vx = 0;
  body.vy = 0;
  body.jumping = false;
  facing = body.x + body.w / 2 <= partner.x ? 1 : -1;
  weddingReadyForSmooch = false;
  weddingEvent = { phase: 'kiss', t: 0, colorIndex: chain.count % 5 };
  sfx.smooch();
  spawnSparks((body.x + body.w / 2 + partner.x) / 2, body.y + 14, 10);
  showToast('Smooch! ♥');
  speakText('Smooch!', { rate: 1.05, pitch: 1.3 });
  setStatus('Smooch!');
  return true;
}

function updateWeddingEvent(dt: number): void {
  if (!weddingEvent) return;
  weddingEvent.t += dt;

  if (weddingEvent.phase === 'kiss' && weddingEvent.t >= WEDDING_KISS_DUR) {
    weddingEvent = { ...weddingEvent, phase: 'sparkle', t: 0 };
    return;
  }

  if (weddingEvent.phase === 'sparkle' && weddingEvent.t >= WEDDING_BABY_WAIT) {
    weddingEvent = { ...weddingEvent, phase: 'baby', t: 0 };
    sfx.baby();
    spawnSparks(body.x + PLAYER_W / 2 + 22 * facing, body.y + 6, 16);
    showToast('Tiny buddy!');
    speakText('Tiny buddy!', { rate: 1.05, pitch: 1.35 });
    return;
  }

  if (weddingEvent.phase === 'baby' && weddingEvent.t >= WEDDING_BABY_POP_DUR) {
    const colorIndex = weddingEvent.colorIndex;
    weddingEvent = null;
    chain.add(colorIndex, facing, performance.now(), body.x, body.y, {
      startScale: WEDDING_BABY_START_SCALE,
      duration: WEDDING_BABY_GROW_DUR,
    });
    sfx.score();
    spawnSparks(body.x + PLAYER_W / 2, body.y, 14);
    setStatus('Return to the left flag to get ready again.');
    updateHud();
  }
}

function collectBuddy(flagDir: number): void {
  chain.add(chain.count % 5, flagDir, performance.now(), body.x, body.y);
  sfx.score();
  spawnSparks(body.x + PLAYER_W / 2, body.y, 14);
  buddyReachedRightPlatform = false;
  if (score > best) {
    best = score;
    saveBest(mode.id, best);
  }
  const target = mode.buddies ?? 5;
  if (chain.count >= target) {
    finalizeBuddies();
  } else {
    buddyDir = flagDir > 0 ? -1 : 1;
    const word = chain.count === 1 ? 'buddy' : 'buddies';
    showToast(`${chain.count} ${word}! 👫`);
    speakText(`${chain.count} ${word}`, { rate: 1, pitch: 1.25 });
    setStatus(buddyDir > 0 ? 'Run to the right flag →' : '← Run to the left flag');
  }
  updateHud();
}

function finalizeBuddies(): void {
  phase = 'celebrating';
  celebrateT = 0;
  body.vy = -540;
  body.grounded = false;
  body.jumping = false;
  playCheer();
  spawnConfetti(screenEl);
  spawnSparks(level.goalX, GROUND_Y - 120, 20);
  showToast('Five buddies! 🎉');
  speakText('Five buddies! Yay!', { rate: 1, pitch: 1.25 });
  setStatus('All buddies! 🎉');
  updateHud();
}

function respawnTo(pos: { x: number; y: number }): void {
  body.x = pos.x;
  body.y = pos.y;
  body.prevX = pos.x;
  body.prevY = pos.y;
  body.vx = 0;
  body.vy = 0;
  body.grounded = false;
  body.jumping = false;
  body.coyote = 0;
  body.buffer = 0;
  // Let barrels ahead of the respawn be earned again on the retry.
  for (const b of level.barrels) {
    if (b.x + b.w > pos.x) scored.delete(b.id);
  }
  invulnUntil = performance.now() + INVULN_MS;
  // Buddies regroup at the respawn point, then spread out again as you move.
  if (hasBuddyChain()) chain.regroup(pos.x, pos.y);
}

function loseHeart(): void {
  // Follower modes may travel back and forth near hazards, so respawn at the
  // last safe ledge rather than a forward-only checkpoint.
  const target = hasBuddyChain() ? lastSafe : lastCheckpoint;
  if (!mode.canFail) {
    respawnTo(target);
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
  respawnTo(target);
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

// Player touched the flag: kick off the celebration (flag lowers, confetti,
// a happy hop) before the next level loads.
function reachGoal(): void {
  if (phase === 'celebrating') return;
  phase = 'celebrating';
  celebrateT = 0;
  body.vy = -540; // little victory hop
  body.grounded = false;
  body.jumping = false;
  if (score > best) {
    best = score;
    saveBest(mode.id, best);
  }
  playCheer();
  spawnConfetti(screenEl);
  spawnSparks(level.goalX, GROUND_Y - 120, 18);
  setStatus('You made it! 🎉');
  updateHud();
}

function advanceLevel(): void {
  levelNum++;
  hearts = HEART_MAX;
  buildLevel();
  showToast(`Level ${levelNum}: ${theme.name} ${theme.emoji}`);
  speakText(theme.name, { rate: 1, pitch: 1.2 });
  setStatus(startStatus());
  updateHud();
}

// --- main loop --------------------------------------------------------------

function update(dt: number): void {
  if (!gameActive) return;

  // During the level-clear celebration the player just settles from the victory
  // hop; no input, scoring or hazards until the next level loads.
  if (phase === 'celebrating') {
    celebrateT += dt;
    jumpEdge = false;
    interactEdge = false;
    stepBody(body, solids, NEUTRAL_INPUT, tuning, dt);
    if (hasBuddyChain()) chain.step(dt, body.x, body.y);
    updateParticles(dt);
    if (celebrateT >= CELEBRATE_DUR) advanceLevel();
    return;
  }

  const left = moveCodes.has('ArrowLeft') || moveCodes.has('KeyA');
  const right = moveCodes.has('ArrowRight') || moveCodes.has('KeyD');
  const pressedInteract = interactEdge;
  interactEdge = false;
  if (pressedInteract && isWeddingMode() && !startWeddingSmooch()) {
    setStatus(weddingInteractHint());
  }

  const lockForWeddingEvent = weddingEvent !== null;
  const input: MoveInput = {
    left: lockForWeddingEvent ? false : left,
    right: lockForWeddingEvent ? false : right,
    jumpHeld: lockForWeddingEvent ? false : jumpCodes.size > 0,
    jumpPressed: lockForWeddingEvent ? false : jumpEdge,
  };
  jumpEdge = false;
  if (lockForWeddingEvent) {
    body.vx = 0;
  } else if (right && !left) facing = 1;
  else if (left && !right) facing = -1;
  cameraLookFrac = approach(
    cameraLookFrac,
    facing > 0 ? LOOK_FRAC_RIGHT : LOOK_FRAC_LEFT,
    LOOK_FRAC_SHIFT_PER_SEC * dt,
  );

  const res = stepBody(body, solids, input, tuning, dt);

  if (res.startedJump) {
    sfx.jump();
    spawnDust(body.x + PLAYER_W / 2, body.y + PLAYER_H, 5);
  }
  if (res.landed) {
    sfx.land();
    spawnDust(body.x + PLAYER_W / 2, body.y + PLAYER_H, 5);
  }

  // Remember the last safe ground-ledge stance (for follower-mode respawns).
  if (body.grounded && res.landedOn && !isBarrel(res.landedOn.ref)) {
    lastSafe = { x: body.x, y: body.y };
  }
  if (
    isBuddyChallenge()
    && chain.count === 0
    && buddyDir > 0
    && !buddyReachedRightPlatform
    && body.grounded
    && isRightGoalPlatform(res.landedOn)
  ) {
    buddyReachedRightPlatform = true;
    setStatus('Return to the left flag, or touch the right flag.');
  }
  if (hasBuddyChain()) {
    chain.record(body.grounded, body.x, body.y);
    chain.step(dt, body.x, body.y);
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

  // Endpoints.
  if (isBuddyChallenge()) {
    const cx = body.x + body.w / 2;
    if (buddyDir > 0 && cx > level.goalX) collectBuddy(1);
    else if (buddyDir < 0 && level.leftGoalX !== undefined && cx < level.leftGoalX) collectBuddy(-1);
    else if (
      chain.count === 0
      && buddyDir > 0
      && buddyReachedRightPlatform
      && level.leftGoalX !== undefined
      && cx < level.leftGoalX
    ) {
      collectBuddy(-1);
    }
  } else if (!isWeddingMode() && body.x + body.w / 2 > level.goalX) {
    reachGoal();
  }

  if (isWeddingMode()) {
    updateWeddingEvent(dt);
    if (!weddingEvent) {
      const cx = body.x + body.w / 2;
      if (!maybeReadyWeddingSmooch(cx)) {
        if (!weddingReadyForSmooch) setStatus('Return to the left flag to get ready again.');
        else if (isNearWeddingPartner()) setStatus('Press Down by your partner.');
        else if (cx > level.goalX) setStatus('Find your partner after the flag.');
      }
    }
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
  cameraX = clamp(px + PLAYER_W / 2 - viewW * cameraLookFrac, 0, maxCam);

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
    theme,
    px,
    py,
    vx: body.vx,
    vy: body.vy,
    grounded: body.grounded,
    facing,
    invuln: performance.now() < invulnUntil,
    flagDown: phase === 'celebrating' ? clamp(celebrateT / FLAG_DUR, 0, 1) : 0,
    buddies: hasBuddyChain() ? chain.renders(performance.now()) : [],
    wedding: isWeddingMode() && level.partnerX !== undefined ? {
      partnerX: level.partnerX,
      partnerY: level.partnerY ?? GROUND_Y - PLAYER_H,
      near: isNearWeddingPartner(),
      phase: weddingEvent?.phase ?? 'idle',
      phaseT: weddingEvent?.t ?? 0,
      colorIndex: weddingEvent?.colorIndex ?? chain.count % 5,
    } : undefined,
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
  setStatus(startStatus());
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
  interactEdge = false;
}

// --- input ------------------------------------------------------------------

const MOVE_CODES = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
const JUMP_CODES = new Set(['ArrowUp', 'Space', 'KeyW']);
const INTERACT_CODES = new Set(['ArrowDown', 'KeyS']);

function onKeyDown(event: KeyboardEvent): void {
  if (!gameActive) return;
  if (shouldIgnoreGameKey(event)) return;
  const code = event.code;

  if (code === 'Digit1') return void switchMode('practice');
  if (code === 'Digit2') return void switchMode('easy');
  if (code === 'Digit3') return void switchMode('hard');
  if (code === 'Digit4') return void switchMode('buddy');
  if (code === 'Digit5') return void switchMode('wedding');

  if (MOVE_CODES.has(code)) {
    event.preventDefault();
    moveCodes.add(code);
  } else if (JUMP_CODES.has(code)) {
    event.preventDefault();
    if (!event.repeat && !jumpCodes.has(code)) jumpEdge = true;
    jumpCodes.add(code);
  } else if (INTERACT_CODES.has(code)) {
    event.preventDefault();
    if (!event.repeat) interactEdge = true;
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
  } else if (INTERACT_CODES.has(code)) {
    event.preventDefault();
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

  document.querySelectorAll<HTMLElement>('[data-jp-interact]').forEach((btn) => {
    const press = (e: Event) => {
      e.preventDefault();
      interactEdge = true;
    };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('mousedown', press);
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
  buddiesPillEl = document.getElementById('jp-buddies-pill')!;
  buddiesLabelEl = document.getElementById('jp-buddies-label')!;
  buddiesEl = document.getElementById('jp-buddies')!;
  statusEl = document.getElementById('jp-status')!;
  toastEl = document.getElementById('jp-toast')!;
  touchInteractEl = document.getElementById('jp-touch-interact')!;

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
