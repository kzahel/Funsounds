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
  type StepResult,
  type Solid,
  type Tuning,
} from './core';
import { MODES, MODE_ORDER, GROUND_Y, PLAYER_W, PLAYER_H, VIRTUAL_H } from './modes';
import { BUDDY_STYLES, render, type BuddyRender, type Scene, type View, type WeddingPartnerKind } from './render';
import { BuddyChain, type Buddy } from './buddies';
import type { BuddySpecies } from './buddy-looks';
import { buildConsumables, CONSUMABLE_LABELS } from './consumables';
import { themeForLevel, type Theme } from './themes';
import type { Barrel, Checkpoint, Consumable, Level, ModeConfig, Particle, WorldLayer } from './types';

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
const WEDDING_MOVEMENT_LOCK_DUR = 0.35;
const WEDDING_BABY_WAIT = 0.9;
const WEDDING_BABY_POP_DUR = 1.35;
const WEDDING_BABY_CRADLE_DUR = 10;
const WEDDING_BABY_START_SCALE = 0.38;
const WEDDING_BABY_GROW_DUR = 60;
const WEDDING_BABY_JOIN_DUR = 1.15;
const BUDDY_COLOR_COUNT = BUDDY_STYLES.length;
const WEDDING_CROISSANT_RAIN_DUR = 8;
const WEDDING_CROISSANTS_PER_SEC = 30;
const EXPLORED_WORLDS_KEY = 'barrelhop.worlds.explored';
const WORLD_LAYERS: readonly WorldLayer[] = ['surface', 'candy', 'upperAtmosphere', 'cave', 'underwater', 'deepSea'];
const EAT_DISTANCE = 76;
const UFO_RIDE_DUR = 2.4;
const UFO_USE_DISTANCE = 74;
const UFO_REUSE_DELAY = 1.1;
const BIRD_SPEED = 58;
const BIRD_W = 72;
const BIRD_H = 42;
const BIRD_RIDE_DUR = 3.2;
const BIRD_TRIP_START_BUFFER = 150;
const SNAKE_W = 86;
const SNAKE_H = 28;
const TRAMPOLINE_W = 82;
const TRAMPOLINE_H = 24;
const UNDERGROUND_RETURN_DUR = 2.15;
const SNAKE_SPEED = 42;
const TARANTULA_MAX = 4;
const TARANTULA_W = 42;
const TARANTULA_SPEED = 34;
const TARANTULA_EMERGE_DUR = 0.9;
const FISH_W = 82;
const FISH_H = 34;
const FISH_SPEED = 76;
const UNDERWATER_RETURN_DUR = 2.4;
const LANTERN_FISH_SPEED = 62;
const SWIM_ACCEL = 920;
const SWIM_DRAG = 5.4;
const SWIM_MAX_X = 230;
const SWIM_MAX_Y = 210;
const SWIM_SINK_ACCEL = 260;
const SWIM_SINK_MAX_Y = 72;
const tuning: Tuning = DEFAULT_TUNING;
const NEUTRAL_INPUT: MoveInput = { left: false, right: false, jumpHeld: false, jumpPressed: false };

type WeddingEventPhase = 'kiss' | 'sparkle' | 'baby';
type BirdTripSide = 'left' | 'right';
type SnakeKind = 'snake' | 'trampoline';
type UfoRideDirection = 'up' | 'down';
interface WeddingEvent {
  phase: WeddingEventPhase;
  t: number;
  colorIndex: number;
  partnerKind: WeddingPartnerKind;
  babySpecies: BuddySpecies;
  babyBaseX: number;
  babyBaseY: number;
}
interface BirdState {
  x: number;
  y: number;
  dir: number;
  wingT: number;
}
interface BirdRide {
  t: number;
  startX: number;
  startY: number;
  dir: number;
  target: 'player' | 'buddy';
  buddyIndex?: number;
}
interface SnakeState {
  x: number;
  y: number;
  kind: SnakeKind;
  t: number;
  dir: number;
  minX: number;
  maxX: number;
}
interface UndergroundReturn {
  t: number;
  startX: number;
  startY: number;
}
interface TarantulaState {
  x: number;
  y: number;
  dir: number;
  t: number;
  emergeT: number;
  minX: number;
  maxX: number;
  torchX: number;
}
interface FishState {
  x: number;
  y: number;
  dir: number;
  t: number;
}
interface UnderwaterReturn {
  t: number;
  startX: number;
  startY: number;
  fishDir: number;
  target: 'player' | 'buddy';
  returnTo: 'cave' | 'underwater';
  buddyIndex?: number;
}
interface UfoRide {
  t: number;
  startX: number;
  startY: number;
  direction: UfoRideDirection;
}
interface StrandedBuddy {
  id: number;
  world: WorldLayer;
  x: number;
  y: number;
  facing: number;
  colorIndex: number;
  variantIndex: number;
  species: BuddySpecies;
  bornAt: number;
  startScale: number;
  growDuration: number;
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
let weddingMateColorIndex = 0;
let weddingMateColorsMade: boolean[] = [];
let weddingAllColorsCelebrated = false;
let weddingCroissantRainT = 0;
let weddingCroissantSpawnBank = 0;
let candyWorld = false;
let upperAtmosphereWorld = false;
let ufoRide: UfoRide | null = null;
let ufoCooldown = 0;
let bird: BirdState | null = null;
let birdCooldown = 0;
let birdRide: BirdRide | null = null;
let birdTripSide: BirdTripSide = 'left';
let birdFlybysRemaining = 0;
let undergroundWorld = false;
let snake: SnakeState | null = null;
let snakeCooldown = 0;
let undergroundReturn: UndergroundReturn | null = null;
let tarantulas: TarantulaState[] = [];
let tarantulaCooldown = 0;
let underwaterWorld = false;
let deepSeaWorld = false;
let fish: FishState | null = null;
let fishCooldown = 0;
let underwaterReturn: UnderwaterReturn | null = null;
let strandedBuddies: StrandedBuddy[] = [];
let strandedBuddySeq = 0;
let consumables: Record<WorldLayer, Consumable[]> = {
  surface: [],
  candy: [],
  upperAtmosphere: [],
  cave: [],
  underwater: [],
  deepSea: [],
};
let snacksEaten = 0;
let worldMapOpen = false;
let exploredWorlds = new Set<WorldLayer>(['surface']);

// Input.
const moveCodes = new Set<string>();
const jumpCodes = new Set<string>();
const interactCodes = new Set<string>();
let jumpEdge = false;
let interactEdge = false;
let eatEdge = false;

let loop: Loop;
let actx: AudioContext | null = null;

// DOM.
let screenEl: HTMLElement;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let hudEl: HTMLElement;
let modeChipEl: HTMLElement;
let scoreEl: HTMLElement;
let bestEl: HTMLElement;
let heartsEl: HTMLElement;
let snacksEl: HTMLElement;
let buddiesPillEl: HTMLElement;
let buddiesLabelEl: HTMLElement;
let buddiesEl: HTMLElement;
let mateProgressEl: HTMLElement;
let statusEl: HTMLElement;
let toastEl: HTMLElement;
let touchInteractEl: HTMLElement;
let worldMapButtonEl: HTMLButtonElement;
let worldMapEl: HTMLElement;
let worldMapCloseEl: HTMLButtonElement;

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
  eat: () => {
    tone(520, 760, 0.08, 'triangle', 0.14);
    window.setTimeout(() => tone(700, 980, 0.1, 'sine', 0.12), 65);
  },
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

function isWorldLayer(value: unknown): value is WorldLayer {
  return typeof value === 'string' && WORLD_LAYERS.includes(value as WorldLayer);
}

function loadExploredWorlds(): Set<WorldLayer> {
  const result = new Set<WorldLayer>(['surface']);
  try {
    const saved = localStorage.getItem(EXPLORED_WORLDS_KEY);
    if (!saved) return result;
    const parsed: unknown = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        if (isWorldLayer(value)) result.add(value);
      }
    }
  } catch {
    // A private browser session or malformed old value should not block play.
  }
  return result;
}

function rememberExploredWorld(world: WorldLayer): void {
  if (exploredWorlds.has(world)) return;
  exploredWorlds.add(world);
  try {
    localStorage.setItem(EXPLORED_WORLDS_KEY, JSON.stringify([...exploredWorlds]));
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

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function weddingMateMadeCount(): number {
  return weddingMateColorsMade.filter(Boolean).length;
}

function allWeddingMateColorsMade(): boolean {
  return weddingMateMadeCount() >= BUDDY_COLOR_COUNT;
}

function chooseWeddingMateColor(previous: number | null = null): number {
  const all = Array.from({ length: BUDDY_COLOR_COUNT }, (_, i) => i);
  const unseen = all.filter((i) => !weddingMateColorsMade[i] && i !== previous);
  const choices = unseen.length > 0 ? unseen : all.filter((i) => i !== previous);
  const pool = choices.length > 0 ? choices : all;
  return pool[Math.floor(Math.random() * pool.length)] ?? 0;
}

function resetWeddingMateProgress(): void {
  weddingMateColorsMade = Array.from({ length: BUDDY_COLOR_COUNT }, () => false);
  weddingMateColorIndex = chooseWeddingMateColor(null);
  weddingAllColorsCelebrated = false;
  weddingCroissantRainT = 0;
  weddingCroissantSpawnBank = 0;
}

function renderWeddingMateProgress(): void {
  if (!mateProgressEl) return;
  if (!isWeddingMode()) {
    mateProgressEl.style.display = 'none';
    mateProgressEl.innerHTML = '';
    return;
  }

  const made = weddingMateMadeCount();
  mateProgressEl.style.display = '';
  mateProgressEl.setAttribute('aria-label', `${made} of ${BUDDY_COLOR_COUNT} mate colors completed`);
  mateProgressEl.innerHTML = [
    `<span class="jp-mate-progress-label">Mates ${made}/${BUDDY_COLOR_COUNT}</span>`,
    ...BUDDY_STYLES.map((style, i) => {
      const classes = [
        'jp-mate-swatch',
        weddingMateColorsMade[i] ? 'made' : '',
        i === weddingMateColorIndex ? 'current' : '',
      ].filter(Boolean).join(' ');
      const title = `Mate color ${i + 1}${weddingMateColorsMade[i] ? ' complete' : ''}${i === weddingMateColorIndex ? ' current' : ''}`;
      return `<span class="${classes}" title="${title}" style="background:${style.body}"></span>`;
    }),
  ].join('');
}

function startCroissantCelebration(): void {
  if (weddingAllColorsCelebrated) return;
  weddingAllColorsCelebrated = true;
  weddingCroissantRainT = WEDDING_CROISSANT_RAIN_DUR;
  weddingCroissantSpawnBank = 0;
  playCheer();
  spawnConfetti(screenEl);
  spawnCroissants(42);
  showToast('Croissant rain!');
  speakText('Croissant rain!', { rate: 1, pitch: 1.25 });
  setStatus('All mate colors! Croissant rain!');
}

function markWeddingMateColor(colorIndex: number): void {
  const normalized = ((colorIndex % BUDDY_COLOR_COUNT) + BUDDY_COLOR_COUNT) % BUDDY_COLOR_COUNT;
  if (!weddingMateColorsMade[normalized]) {
    weddingMateColorsMade[normalized] = true;
    if (allWeddingMateColorsMade()) startCroissantCelebration();
  }
  renderWeddingMateProgress();
}

function spawnCroissants(count: number): void {
  const cssW = canvas?.clientWidth || 960;
  const cssH = canvas?.clientHeight || VIRTUAL_H;
  const scale = cssH > 0 ? cssH / VIRTUAL_H : 1;
  const viewW = cssW / scale;

  for (let i = 0; i < count; i++) {
    const life = 4.8 + Math.random() * 1.8;
    particles.push({
      x: cameraX + Math.random() * viewW,
      y: -90 - Math.random() * 140,
      vx: (Math.random() - 0.5) * 52,
      vy: 70 + Math.random() * 90,
      life,
      maxLife: life,
      size: 18 + Math.random() * 12,
      color: '#f5bd58',
      kind: 'croissant',
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 3.4,
    });
  }
  capParticles();
}

function updateCroissantRain(dt: number): void {
  if (weddingCroissantRainT <= 0) return;
  weddingCroissantRainT = Math.max(0, weddingCroissantRainT - dt);
  weddingCroissantSpawnBank += WEDDING_CROISSANTS_PER_SEC * dt;
  const count = Math.floor(weddingCroissantSpawnBank);
  if (count <= 0) return;
  weddingCroissantSpawnBank -= count;
  spawnCroissants(count);
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
    p.vy += (p.kind === 'croissant' ? 140 : 900) * dt;
    if (p.angle !== undefined) p.angle += (p.spin ?? 0) * dt;
  }
}

// --- HUD --------------------------------------------------------------------

function updateHud(): void {
  screenEl.classList.toggle('jp-wedding-mode', isWeddingMode());
  if (hasBuddyChain()) rememberExploredWorld(currentWorldLayer());
  screenEl.dataset.world = currentWorldLayer();
  modeChipEl.textContent = `${mode.emoji} ${mode.name}`;
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  snacksEl.textContent = String(snacksEaten);
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
  renderWeddingMateProgress();
  touchInteractEl.classList.toggle('visible', isWeddingMode());
  worldMapButtonEl.classList.toggle('visible', hasBuddyChain());
  syncWorldMapUi();
  positionStatusBelowHud();
}

function syncWorldMapUi(): void {
  worldMapEl.classList.toggle('visible', worldMapOpen);
  worldMapEl.setAttribute('aria-hidden', String(!worldMapOpen));
  worldMapButtonEl.setAttribute('aria-expanded', String(worldMapOpen));
  const current = currentWorldLayer();
  worldMapEl.querySelectorAll<HTMLElement>('[data-jp-world]').forEach((button) => {
    const world = button.dataset.jpWorld as WorldLayer;
    const here = world === current;
    const explored = exploredWorlds.has(world);
    button.classList.toggle('current', here);
    button.classList.toggle('locked', !explored);
    if (button instanceof HTMLButtonElement) button.disabled = !explored;
    if (here) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
    const marker = button.querySelector<HTMLElement>('.jp-world-card-here');
    if (marker) marker.textContent = here ? '★' : explored ? '' : '🔒';
    button.setAttribute('aria-label', explored
      ? `${WORLD_MAP_NAMES[world]}${here ? ', current location' : ''}`
      : `${WORLD_MAP_NAMES[world]}, locked until explored`);
  });
}

function positionStatusBelowHud(): void {
  const hudBottom = hudEl.getBoundingClientRect().bottom;
  statusEl.style.top = `${Math.ceil(hudBottom + 8)}px`;
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
  if (isWeddingMode()) return 'Find your partner • Up jumps • Space eats';
  if (isBuddyChallenge()) return 'Watch for a bird • Up jumps • Space eats';
  return 'Arrows move • Up jumps • Space eats nearby snacks';
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
  resetWeddingMateProgress();
  candyWorld = false;
  upperAtmosphereWorld = false;
  ufoRide = null;
  ufoCooldown = 0;
  bird = null;
  birdRide = null;
  resetBirdTrip('left');
  undergroundWorld = false;
  snake = null;
  snakeCooldown = 0;
  undergroundReturn = null;
  tarantulas = [];
  tarantulaCooldown = 0;
  underwaterWorld = false;
  deepSeaWorld = false;
  fish = null;
  fishCooldown = 0;
  underwaterReturn = null;
  strandedBuddies = [];
  strandedBuddySeq = 0;
  snacksEaten = 0;
  worldMapOpen = false;
  const portal = ufoPortalPosition();
  consumables = {
    surface: buildConsumables(level, 'surface', levelNum, portal.x),
    candy: buildConsumables(level, 'candy', levelNum, portal.x),
    upperAtmosphere: buildConsumables(level, 'upperAtmosphere', levelNum, portal.x),
    cave: buildConsumables(level, 'cave', levelNum, portal.x),
    underwater: buildConsumables(level, 'underwater', levelNum, portal.x),
    deepSea: buildConsumables(level, 'deepSea', levelNum, portal.x),
  };
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

function weddingPartnerKind(): WeddingPartnerKind {
  return underwaterWorld || deepSeaWorld ? 'fish' : 'buddy';
}

function weddingBabySpecies(kind: WeddingPartnerKind): BuddySpecies {
  return kind === 'fish' ? 'fishBuddy' : 'buddy';
}

function weddingMovementLocked(): boolean {
  return weddingEvent?.phase === 'kiss' && weddingEvent.t < WEDDING_MOVEMENT_LOCK_DUR;
}

function isRightGoalPlatform(solid: Solid | null | undefined): boolean {
  return !!solid && !isBarrel(solid.ref) && solid.x <= level.goalX && solid.x + solid.w >= level.goalX;
}

function isLeftGoalPlatform(solid: Solid | null | undefined): boolean {
  return !!solid && !isBarrel(solid.ref) && level.leftGoalX !== undefined && solid.x <= level.leftGoalX && solid.x + solid.w >= level.leftGoalX;
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

function weddingBabyBasePosition(): { x: number; y: number } {
  const partner = weddingPartnerCenter();
  const midX = partner ? (body.x + PLAYER_W / 2 + partner.x) / 2 : body.x + PLAYER_W / 2;
  const partnerTop = level.partnerY ?? GROUND_Y - PLAYER_H;
  const midY = partner ? (body.y + partnerTop) / 2 : body.y;
  return {
    x: midX - PLAYER_W / 2,
    y: clamp(midY, 72, GROUND_Y - PLAYER_H),
  };
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

function overlapsRect(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function currentWorldLayer(): WorldLayer {
  if (deepSeaWorld) return 'deepSea';
  if (underwaterWorld) return 'underwater';
  if (undergroundWorld) return 'cave';
  if (upperAtmosphereWorld) return 'upperAtmosphere';
  if (candyWorld) return 'candy';
  return 'surface';
}

function worldDisplayName(world: WorldLayer): string {
  switch (world) {
    case 'candy': return 'candy clouds';
    case 'upperAtmosphere': return 'the starry sky';
    case 'cave': return 'the cave';
    case 'underwater': return 'the reef';
    case 'deepSea': return 'the deep sea';
    default: return 'the surface';
  }
}

const WORLD_MAP_NAMES: Record<WorldLayer, string> = {
  surface: 'Sunny Surface',
  candy: 'Candy Clouds',
  upperAtmosphere: 'Starry Sky',
  cave: 'Crystal Cave',
  underwater: 'Coral Reef',
  deepSea: 'Deep Sea',
};

function worldStatus(world: WorldLayer): string {
  switch (world) {
    case 'candy': return 'Candy clouds! Eat gumdrops or use the UFO beam.';
    case 'upperAtmosphere': return 'Tiny poofy clouds! Space eats croissants.';
    case 'cave': return 'Space eats cave cheese. Find a snake trampoline.';
    case 'underwater': return 'Space eats crunchy kelp. Up and Down swim.';
    case 'deepSea': return 'Space eats starfruit. Find a glowing lantern fish.';
    default: return startStatus();
  }
}

function canOpenWorldMap(): boolean {
  return hasBuddyChain()
    && phase === 'playing'
    && !birdRide
    && !ufoRide
    && !undergroundReturn
    && !underwaterReturn
    && !weddingEvent;
}

function openWorldMap(): void {
  if (!canOpenWorldMap()) {
    showToast('Map in a moment!');
    setStatus('Finish this ride or celebration, then open the map.');
    return;
  }
  worldMapOpen = true;
  clearInput();
  syncWorldMapUi();
  showToast('Choose a world!');
  setStatus('The game is paused while you choose a world.');
  worldMapCloseEl.focus();
}

function closeWorldMap(restoreStatus = true): void {
  if (!worldMapOpen) return;
  worldMapOpen = false;
  clearInput();
  syncWorldMapUi();
  if (restoreStatus) setStatus(worldStatus(currentWorldLayer()));
  worldMapButtonEl.focus();
}

function travelToWorld(world: WorldLayer): void {
  if (!hasBuddyChain()) return;
  if (!exploredWorlds.has(world)) {
    showToast('World still locked! 🔒');
    setStatus('Explore that world during the adventure to unlock it here.');
    return;
  }
  if (world === currentWorldLayer()) {
    closeWorldMap(false);
    showToast(`Already in ${WORLD_MAP_NAMES[world]}!`);
    setStatus(worldStatus(world));
    return;
  }

  const landing = platformLandingForBuddy(body.x);
  candyWorld = world === 'candy';
  upperAtmosphereWorld = world === 'upperAtmosphere';
  undergroundWorld = world === 'cave';
  underwaterWorld = world === 'underwater';
  deepSeaWorld = world === 'deepSea';
  bird = null;
  birdRide = null;
  ufoRide = null;
  ufoCooldown = 0;
  snake = null;
  snakeCooldown = world === 'cave' ? 0.8 : 0;
  undergroundReturn = null;
  tarantulas = [];
  tarantulaCooldown = world === 'cave' ? 0.6 : 0;
  fish = null;
  fishCooldown = world === 'underwater' || world === 'deepSea' ? 0.8 : 0;
  underwaterReturn = null;
  chain.releaseCarriedBuddy();
  particles = [];
  respawnTo(landing);
  lastSafe = landing;
  if (world === 'surface') {
    const midpoint = level.leftGoalX === undefined ? level.width / 2 : (level.leftGoalX + level.goalX) / 2;
    resetBirdTrip(body.x + body.w / 2 <= midpoint ? 'left' : 'right');
  }

  worldMapOpen = false;
  updateHud();
  spawnSparks(body.x + PLAYER_W / 2, body.y + PLAYER_H / 2, 20);
  showToast(`${WORLD_MAP_NAMES[world]}!`);
  speakText(WORLD_MAP_NAMES[world], { rate: 1, pitch: world === 'deepSea' ? 0.9 : 1.2 });
  setStatus(worldStatus(world));
  worldMapButtonEl.focus();
}

function ufoPortalPosition(): { x: number; platformY: number } {
  const targetX = level.width * 0.58;
  const candidates = level.platforms.filter((platform) => platform.w >= 130);
  const pool = candidates.length > 0 ? candidates : level.platforms;
  let best = pool[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const platform of pool) {
    const centerX = platform.x + platform.w / 2;
    const distance = Math.abs(centerX - targetX);
    if (distance < bestDistance) {
      best = platform;
      bestDistance = distance;
    }
  }
  if (!best) return { x: level.width / 2, platformY: GROUND_Y };
  return { x: best.x + best.w / 2, platformY: best.y };
}

function isNearUfoPortal(): boolean {
  if ((!candyWorld && !upperAtmosphereWorld) || ufoRide || ufoCooldown > 0) return false;
  const portal = ufoPortalPosition();
  const cx = body.x + body.w / 2;
  const feetY = body.y + body.h;
  return Math.abs(cx - portal.x) <= UFO_USE_DISTANCE && Math.abs(feetY - portal.platformY) <= 72;
}

function eatNearbyConsumable(): boolean {
  const foods = consumables[currentWorldLayer()];
  if (!foods || foods.length === 0) return false;
  const cx = body.x + body.w / 2;
  const cy = body.y + body.h / 2;
  let closestIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < foods.length; i++) {
    const food = foods[i];
    const distance = Math.hypot(cx - (food.x + food.w / 2), cy - (food.y + food.h / 2));
    if (distance <= EAT_DISTANCE && distance < closestDistance) {
      closestIndex = i;
      closestDistance = distance;
    }
  }
  if (closestIndex < 0) return false;

  const [food] = foods.splice(closestIndex, 1);
  const label = CONSUMABLE_LABELS[food.kind];
  snacksEaten++;
  score++;
  combo++;
  if (score > best) {
    best = score;
    saveBest(mode.id, best);
  }
  sfx.eat();
  spawnSparks(food.x + food.w / 2, food.y + food.h / 2, 11);
  showToast(`Yum! ${label}!`);
  setStatus(foods.length > 0 ? `Yum! ${foods.length} snacks left in this world.` : 'You found every snack in this world!');
  updateHud();
  return true;
}

function startUfoRide(): boolean {
  if (!isNearUfoPortal()) return false;
  const direction: UfoRideDirection = upperAtmosphereWorld ? 'down' : 'up';
  ufoRide = { t: 0, startX: body.x, startY: body.y, direction };
  body.vx = 0;
  body.vy = 0;
  body.grounded = false;
  body.jumping = false;
  spawnSparks(body.x + PLAYER_W / 2, body.y + PLAYER_H / 2, 18);
  showToast(direction === 'up' ? 'UFO ride!' : 'Back to candy clouds!');
  speakText(direction === 'up' ? 'U F O ride!' : 'Back to candy clouds!', { rate: 1, pitch: 1.3 });
  setStatus(direction === 'up' ? 'The friendly UFO is beaming you above the clouds!' : 'The UFO is carrying you down to candy clouds.');
  return true;
}

function handleEatAction(): void {
  if (eatNearbyConsumable()) return;
  if (startUfoRide()) return;
  if (candyWorld || upperAtmosphereWorld) {
    setStatus('Stand by a snack to eat it, or under the UFO beam to ride.');
  } else {
    setStatus('Stand next to a snack, then press Space to eat it.');
  }
}

function updateUfoRide(dt: number): boolean {
  if (!ufoRide) return false;
  ufoRide.t += dt;
  const p = clamp(ufoRide.t / UFO_RIDE_DUR, 0, 1);
  const lift = Math.sin(Math.PI * smoothstep(p));
  const portal = ufoPortalPosition();
  body.prevX = body.x;
  body.prevY = body.y;
  body.x = ufoRide.startX + Math.sin(p * Math.PI * 4) * 8;
  body.y = ufoRide.startY - lift * 185;
  body.vx = 0;
  body.vy = p < 0.5 ? -240 : 240;
  body.grounded = false;
  body.jumping = false;

  if (p >= 1) {
    const direction = ufoRide.direction;
    const startX = ufoRide.startX;
    ufoRide = null;
    ufoCooldown = UFO_REUSE_DELAY;
    upperAtmosphereWorld = direction === 'up';
    candyWorld = direction === 'down';
    body.x = clamp(startX, 0, level.width - body.w);
    body.y = portal.platformY - PLAYER_H;
    body.prevX = body.x;
    body.prevY = body.y;
    body.vx = 0;
    body.vy = 0;
    body.grounded = false;
    lastSafe = { x: body.x, y: body.y };
    spawnSparks(body.x + PLAYER_W / 2, body.y + 8, 22);
    if (direction === 'up') {
      showToast('Above the clouds! ✨');
      speakText('Above the clouds!', { rate: 1, pitch: 1.35 });
      setStatus('Tiny poofy clouds! Find croissants and press Space to eat.');
    } else {
      showToast('Candy clouds!');
      setStatus('Back in candy clouds. Find gumdrops or ride the UFO again.');
    }
    updateHud();
  }

  updateParticles(dt);
  return true;
}

function strandedBuddyScale(buddy: StrandedBuddy, now: number): number {
  if (buddy.growDuration <= 0) return 1;
  const age = (now - buddy.bornAt) / 1000;
  const growT = clamp(age / buddy.growDuration, 0, 1);
  return buddy.startScale + (1 - buddy.startScale) * growT;
}

function strandedBuddyRemainingGrowth(buddy: StrandedBuddy, now: number): number {
  if (buddy.growDuration <= 0) return 0;
  return Math.max(0, buddy.growDuration - (now - buddy.bornAt) / 1000);
}

function platformLandingForBuddy(x: number): { x: number; y: number } {
  const maxX = Math.max(0, level.width - PLAYER_W);
  const minCx = PLAYER_W / 2;
  const maxCx = Math.max(minCx, level.width - PLAYER_W / 2);
  const desiredCx = clamp(x + PLAYER_W / 2, minCx, maxCx);
  const exactTop = platformTopAtCenter(desiredCx);
  if (exactTop !== null) return { x: clamp(desiredCx - PLAYER_W / 2, 0, maxX), y: exactTop - PLAYER_H };

  let best: { cx: number; top: number; dist: number } | null = null;
  for (const p of level.platforms) {
    const left = p.x + PLAYER_W / 2;
    const right = p.x + p.w - PLAYER_W / 2;
    const cx = left <= right ? clamp(desiredCx, left, right) : p.x + p.w / 2;
    const dist = Math.abs(cx - desiredCx);
    if (!best || dist < best.dist) best = { cx, top: p.y, dist };
  }

  if (best) return { x: clamp(best.cx - PLAYER_W / 2, 0, maxX), y: best.top - PLAYER_H };
  return { x: clamp(desiredCx - PLAYER_W / 2, 0, maxX), y: GROUND_Y - PLAYER_H };
}

function stashCarriedBuddy(buddy: Buddy, world: WorldLayer, carried: BuddyRender | undefined, fallbackX: number, facingDir: number): void {
  const landing = platformLandingForBuddy(carried?.x ?? fallbackX);
  strandedBuddies.push({
    id: strandedBuddySeq++,
    world,
    x: landing.x,
    y: landing.y,
    facing: facingDir || 1,
    colorIndex: buddy.colorIndex,
    variantIndex: buddy.variantIndex,
    species: buddy.species,
    bornAt: buddy.bornAt,
    startScale: buddy.startScale,
    growDuration: buddy.growDuration,
  });
}

function strandedBuddyRenders(now: number): BuddyRender[] {
  const world = currentWorldLayer();
  return strandedBuddies
    .filter((buddy) => buddy.world === world)
    .map((buddy) => {
      const bob = Math.sin(now / 260 + buddy.id * 1.7) * 2;
      const playerCx = body.x + body.w / 2;
      const buddyCx = buddy.x + PLAYER_W / 2;
      const lookDir = Math.abs(playerCx - buddyCx) > 1 ? (playerCx >= buddyCx ? 1 : -1) : buddy.facing;
      return {
        x: buddy.x,
        y: buddy.y - bob,
        vy: 0,
        facing: lookDir,
        grounded: true,
        colorIndex: buddy.colorIndex,
        variantIndex: buddy.variantIndex,
        species: buddy.species,
        alpha: 1,
        scale: strandedBuddyScale(buddy, now),
      };
    });
}

function maybeCollectStrandedBuddies(): boolean {
  if (!hasBuddyChain() || strandedBuddies.length === 0) return false;
  const world = currentWorldLayer();
  const now = performance.now();
  let collected = false;

  for (let i = strandedBuddies.length - 1; i >= 0; i--) {
    const buddy = strandedBuddies[i];
    if (buddy.world !== world) continue;

    const scale = strandedBuddyScale(buddy, now);
    const buddyW = PLAYER_W * Math.max(0.55, scale);
    const buddyH = PLAYER_H * Math.max(0.55, scale);
    const buddyX = buddy.x + (PLAYER_W - buddyW) / 2;
    const buddyY = buddy.y + PLAYER_H - buddyH;
    const playerCx = body.x + body.w / 2;
    const playerCy = body.y + body.h / 2;
    const buddyCx = buddy.x + PLAYER_W / 2;
    const buddyCy = buddy.y + PLAYER_H / 2;
    const close = Math.hypot(playerCx - buddyCx, playerCy - buddyCy) <= 66;
    if (!close && !overlapsRect(body.x, body.y, body.w, body.h, buddyX, buddyY, buddyW, buddyH)) continue;

    strandedBuddies.splice(i, 1);
    const joinDir = playerCx >= buddyCx ? 1 : -1;
    chain.add(buddy.colorIndex, joinDir, now, body.x, body.y, {
      startScale: scale,
      duration: strandedBuddyRemainingGrowth(buddy, now),
      joinFrom: { x: buddy.x, y: buddy.y },
      joinDuration: 0.85,
      fadeDuration: 0,
      species: buddy.species,
      variantIndex: buddy.variantIndex,
    });
    spawnSparks(buddy.x + PLAYER_W / 2, buddy.y + 8, 14);
    collected = true;
  }

  if (!collected) return false;
  sfx.score();
  showToast('Buddy found!');
  speakText('Buddy found!', { rate: 1, pitch: 1.25 });
  setStatus('Your buddy hopped back into the trail.');
  updateHud();
  if (isBuddyChallenge() && chain.count >= (mode.buddies ?? 5)) {
    finalizeBuddies();
    return true;
  }
  return false;
}

function resetBirdTrip(side: BirdTripSide): void {
  birdTripSide = side;
  birdFlybysRemaining = Math.random() < 0.5 ? 1 : 2;
  birdCooldown = 1.8 + Math.random() * 2.4;
  if (!birdRide) bird = null;
}

function noteBirdTripSide(side: BirdTripSide): void {
  if (!hasBuddyChain() || candyWorld || upperAtmosphereWorld || undergroundWorld || underwaterWorld || deepSeaWorld || birdTripSide === side) return;
  resetBirdTrip(side);
}

function updateBirdTripSide(cx: number): void {
  if (!hasBuddyChain() || candyWorld || upperAtmosphereWorld || undergroundWorld || underwaterWorld || deepSeaWorld || level.leftGoalX === undefined) return;
  if (cx <= level.leftGoalX) noteBirdTripSide('left');
  else if (cx >= level.goalX) noteBirdTripSide('right');
}

function birdTripHasStarted(): boolean {
  if (level.leftGoalX === undefined) return true;
  const cx = body.x + body.w / 2;
  return birdTripSide === 'left'
    ? cx > level.leftGoalX + BIRD_TRIP_START_BUFFER
    : cx < level.goalX - BIRD_TRIP_START_BUFFER;
}

function canSpawnBird(): boolean {
  return hasBuddyChain() && !candyWorld && !upperAtmosphereWorld && !undergroundWorld && !underwaterWorld && !deepSeaWorld && !birdRide && !weddingEvent && phase === 'playing';
}

function spawnBird(): void {
  const dir = Math.random() < 0.5 ? 1 : -1;
  bird = {
    x: body.x + (dir > 0 ? -520 : 620),
    y: GROUND_Y - 150 - Math.random() * 38,
    dir,
    wingT: Math.random() * Math.PI * 2,
  };
  birdFlybysRemaining = Math.max(0, birdFlybysRemaining - 1);
}

function startBirdRide(): void {
  if (!bird) return;
  birdRide = { t: 0, startX: body.x, startY: body.y, dir: bird.dir, target: 'player' };
  body.vx = 0;
  body.vy = 0;
  body.jumping = false;
  body.grounded = false;
  bird.x = body.x + PLAYER_W / 2 - BIRD_W / 2;
  bird.y = body.y - BIRD_H + 8;
  showToast('Bird ride!');
  speakText('Bird ride!', { rate: 1.05, pitch: 1.35 });
  setStatus('Hold on! Up to the candy clouds.');
}

function startBirdBuddyRide(buddyIndex: number, buddyRender: BuddyRender): void {
  if (!bird) return;
  birdRide = {
    t: 0,
    startX: buddyRender.x,
    startY: buddyRender.y,
    dir: bird.dir,
    target: 'buddy',
    buddyIndex,
  };
  body.vx = 0;
  body.vy = 0;
  body.jumping = false;
  const buddyScale = buddyRender.scale ?? 1;
  bird.x = buddyRender.x + (PLAYER_W * buddyScale) / 2 - BIRD_W / 2;
  bird.y = buddyRender.y - BIRD_H + 8;
  chain.carryBuddy(buddyIndex, buddyRender.x, buddyRender.y, bird.dir, -180);
  showToast('Bird got a buddy!');
  speakText('Bird got a buddy!', { rate: 1.05, pitch: 1.35 });
  setStatus('The bird is carrying that buddy away.');
}

function surfaceTopAtCenter(cx: number): number | null {
  let best: number | null = null;
  const consider = (s: { x: number; y: number; w: number }) => {
    if (s.x <= cx && s.x + s.w >= cx && (best === null || s.y < best)) best = s.y;
  };
  for (const p of level.platforms) consider(p);
  for (const b of level.barrels) consider(b);
  return best;
}

function platformTopAtCenter(cx: number): number | null {
  let best: number | null = null;
  for (const p of level.platforms) {
    if (p.x <= cx && p.x + p.w >= cx && (best === null || p.y < best)) best = p.y;
  }
  return best;
}

function snakeSize(kind: SnakeKind): { w: number; h: number } {
  return kind === 'trampoline'
    ? { w: TRAMPOLINE_W, h: TRAMPOLINE_H }
    : { w: SNAKE_W, h: SNAKE_H };
}

function spawnSnake(): void {
  const dir = facing || 1;
  const offsets = [dir * 230, -dir * 230, dir * 390, -dir * 390, 0];
  for (const offset of offsets) {
    const cx = clamp(body.x + PLAYER_W / 2 + offset, 40 + SNAKE_W / 2, level.width - 40 - SNAKE_W / 2);
    const top = platformTopAtCenter(cx);
    if (top === null) continue;
    const platform = level.platforms.find((p) => p.x <= cx && p.x + p.w >= cx);
    const minX = platform ? platform.x + 14 : Math.max(0, cx - 180);
    const maxX = platform ? platform.x + platform.w - SNAKE_W - 14 : Math.min(level.width - SNAKE_W, cx + 180);
    snake = {
      x: clamp(cx - SNAKE_W / 2, minX, maxX),
      y: top - SNAKE_H,
      kind: 'snake',
      t: 0,
      dir: Math.random() < 0.5 ? -1 : 1,
      minX,
      maxX,
    };
    return;
  }
  snakeCooldown = 2.5;
}

function touchedSnakeTop(s: SnakeState): boolean {
  const size = snakeSize(s.kind);
  const feet = body.y + body.h;
  const prevFeet = body.prevY + body.h;
  return body.vy >= 0
    && body.x + body.w > s.x + 8
    && body.x < s.x + size.w - 8
    && prevFeet <= s.y + 12
    && feet >= s.y
    && feet <= s.y + size.h + 12;
}

function startUndergroundReturn(): void {
  if (!undergroundWorld || undergroundReturn) return;
  undergroundReturn = { t: 0, startX: body.x, startY: body.y };
  body.vx = 0;
  body.vy = 0;
  body.jumping = false;
  body.grounded = false;
  snake = null;
  spawnSparks(body.x + PLAYER_W / 2, body.y + PLAYER_H, 18);
  showToast('Back up!');
  speakText('Back up!', { rate: 1.05, pitch: 1.25 });
  setStatus('The trampoline is sending you back up.');
}

function updateUndergroundReturn(dt: number): boolean {
  if (!undergroundReturn) return false;

  undergroundReturn.t += dt;
  const p = clamp(undergroundReturn.t / UNDERGROUND_RETURN_DUR, 0, 1);
  const lift = smoothstep(p);
  body.prevX = body.x;
  body.prevY = body.y;
  body.x = undergroundReturn.startX + Math.sin(p * Math.PI * 3) * 10;
  body.y = undergroundReturn.startY - lift * 340;
  body.vx = 0;
  body.vy = -520 * (1 - p);
  body.grounded = false;
  body.jumping = false;

  if (p >= 1) {
    const landingCx = undergroundReturn.startX + PLAYER_W / 2;
    const top = platformTopAtCenter(landingCx);
    const landingX = undergroundReturn.startX;
    undergroundWorld = false;
    undergroundReturn = null;
    snake = null;
    snakeCooldown = 0;
    tarantulas = [];
    tarantulaCooldown = 0;
    body.x = top !== null ? landingX : lastSafe.x;
    body.y = top !== null ? top - PLAYER_H : lastSafe.y;
    body.prevX = body.x;
    body.prevY = body.y;
    body.vx = 0;
    body.vy = 0;
    body.grounded = false;
    lastSafe = { x: body.x, y: body.y };
    resetBirdTrip(body.x + PLAYER_W / 2 <= (level.leftGoalX ?? level.startX) ? 'left' : 'right');
    spawnSparks(body.x + PLAYER_W / 2, body.y + 8, 18);
    showToast('Back on the surface!');
    speakText('Back on the surface!', { rate: 1, pitch: 1.2 });
    setStatus(startStatus());
  }

  updateParticles(dt);
  return true;
}

function updateSnake(dt: number): void {
  if (!undergroundWorld || underwaterWorld || undergroundReturn) return;

  if (!snake) {
    snakeCooldown -= dt;
    if (snakeCooldown <= 0) spawnSnake();
    return;
  }

  snake.t += dt;
  if (snake.kind === 'snake') {
    snake.x += snake.dir * SNAKE_SPEED * dt;
    if (snake.x <= snake.minX || snake.x >= snake.maxX) {
      snake.x = clamp(snake.x, snake.minX, snake.maxX);
      snake.dir *= -1;
    }
  }
  if (snake.x + SNAKE_W < body.x - 820 || snake.x > body.x + 900) {
    snake = null;
    snakeCooldown = 3 + Math.random() * 3;
    return;
  }

  if (!touchedSnakeTop(snake)) return;

  body.y = snake.y - body.h;
  body.prevY = body.y;
  body.grounded = false;
  body.jumping = false;
  if (snake.kind === 'snake') {
    snake.kind = 'trampoline';
    snake.x += (SNAKE_W - TRAMPOLINE_W) / 2;
    snake.y += SNAKE_H - TRAMPOLINE_H;
    snake.minX = snake.x;
    snake.maxX = snake.x;
    snake.dir = 0;
    body.vy = -520;
    sfx.score();
    spawnSparks(snake.x + TRAMPOLINE_W / 2, snake.y, 14);
    showToast('Snake trampoline!');
    speakText('Snake trampoline!', { rate: 1.05, pitch: 1.3 });
    setStatus('Jump on the trampoline to get back up.');
  } else {
    startUndergroundReturn();
  }
}

function caveTorchSpots(): Array<{ x: number; y: number; minX: number; maxX: number }> {
  const spots: Array<{ x: number; y: number; minX: number; maxX: number }> = [];
  let torches = 0;
  for (let i = 0; i < level.platforms.length && torches < 10; i++) {
    const p = level.platforms[i];
    if (p.w < 120) continue;
    const x = p.x + 42 + ((i * 149) % Math.max(1, p.w - 84));
    const minX = p.x + 14;
    const maxX = p.x + p.w - TARANTULA_W - 14;
    if (maxX > minX) spots.push({ x, y: p.y, minX, maxX });
    torches++;
  }
  return spots;
}

function spawnTarantula(): boolean {
  const cx = body.x + PLAYER_W / 2;
  const spots = caveTorchSpots();
  const nearby = spots.filter(
    (spot) =>
      Math.abs(spot.x - cx) < 760
      && !tarantulas.some((tarantula) => Math.abs(tarantula.torchX - spot.x) < 6 && Math.abs(tarantula.y - spot.y) < 6),
  );
  const choices = nearby.length > 0 ? nearby : spots;
  if (choices.length === 0) return false;

  const spot = choices[Math.floor(Math.random() * choices.length)];
  const startX = clamp(spot.x - TARANTULA_W / 2, spot.minX, spot.maxX);
  tarantulas.push({
    x: startX,
    y: spot.y,
    dir: Math.random() < 0.5 ? -1 : 1,
    t: 0,
    emergeT: 0,
    minX: spot.minX,
    maxX: spot.maxX,
    torchX: spot.x,
  });
  return true;
}

function updateTarantulas(dt: number): void {
  if (!undergroundWorld || underwaterWorld || undergroundReturn) return;

  for (let i = tarantulas.length - 1; i >= 0; i--) {
    const tarantula = tarantulas[i];
    tarantula.t += dt;
    tarantula.emergeT = Math.min(1, tarantula.emergeT + dt / TARANTULA_EMERGE_DUR);
    if (tarantula.emergeT >= 1) {
      tarantula.x += tarantula.dir * TARANTULA_SPEED * dt;
      if (tarantula.x <= tarantula.minX || tarantula.x >= tarantula.maxX) {
        tarantula.x = clamp(tarantula.x, tarantula.minX, tarantula.maxX);
        tarantula.dir *= -1;
      }
    }
    if (tarantula.t > 2 && (tarantula.x + TARANTULA_W < body.x - 900 || tarantula.x > body.x + 980)) {
      tarantulas.splice(i, 1);
    }
  }

  if (tarantulas.length >= TARANTULA_MAX) return;
  tarantulaCooldown -= dt;
  if (tarantulaCooldown > 0) return;
  spawnTarantula();
  tarantulaCooldown = 1.8 + Math.random() * 3.2;
}

function spawnFish(): void {
  const dir = Math.random() < 0.5 ? 1 : -1;
  fish = {
    x: body.x + (dir > 0 ? -430 : 520),
    y: deepSeaWorld ? GROUND_Y - 170 - Math.random() * 110 : GROUND_Y - 130 - Math.random() * 60,
    dir,
    t: Math.random() * Math.PI * 2,
  };
}

function startFishRide(): void {
  if (!fish || underwaterReturn) return;
  const returnTo = deepSeaWorld ? 'underwater' : 'cave';
  underwaterReturn = { t: 0, startX: body.x, startY: body.y, fishDir: fish.dir, target: 'player', returnTo };
  body.vx = 0;
  body.vy = 0;
  body.grounded = false;
  body.jumping = false;
  fish.x = body.x + PLAYER_W / 2 - FISH_W / 2;
  fish.y = body.y - FISH_H + 18;
  spawnSparks(body.x + PLAYER_W / 2, body.y + PLAYER_H * 0.4, 14);
  showToast(deepSeaWorld ? 'Lantern fish!' : 'Fish ride!');
  speakText(deepSeaWorld ? 'Lantern fish!' : 'Fish ride!', { rate: 1.05, pitch: 1.25 });
  setStatus(deepSeaWorld ? 'The lantern fish is swimming you back to the reef.' : 'The fish is swimming you back up to the cave.');
}

function startFishBuddyRide(buddyIndex: number, buddyRender: BuddyRender): void {
  if (!fish || underwaterReturn) return;
  underwaterReturn = {
    t: 0,
    startX: buddyRender.x,
    startY: buddyRender.y,
    fishDir: fish.dir,
    target: 'buddy',
    returnTo: deepSeaWorld ? 'underwater' : 'cave',
    buddyIndex,
  };
  const buddyScale = buddyRender.scale ?? 1;
  fish.x = buddyRender.x + (PLAYER_W * buddyScale) / 2 - FISH_W / 2;
  fish.y = buddyRender.y - FISH_H + 18;
  chain.carryBuddy(buddyIndex, buddyRender.x, buddyRender.y, fish.dir, -180);
  spawnSparks(buddyRender.x + PLAYER_W * buddyScale / 2, buddyRender.y + PLAYER_H * buddyScale * 0.45, 12);
  showToast(deepSeaWorld ? 'Lantern fish got a buddy!' : 'Buddy fish ride!');
  speakText(deepSeaWorld ? 'Lantern fish got a buddy!' : 'Buddy fish ride!', { rate: 1.05, pitch: 1.25 });
  setStatus(deepSeaWorld ? 'The lantern fish is swimming your buddy away.' : 'The fish is swimming your buddy away.');
}

function updateUnderwaterReturn(dt: number): boolean {
  if (!underwaterReturn) return false;

  underwaterReturn.t += dt;
  const exclusivePlayerRide = underwaterReturn.target === 'player';
  const p = clamp(underwaterReturn.t / UNDERWATER_RETURN_DUR, 0, 1);
  const lift = smoothstep(p);
  if (underwaterReturn.target === 'buddy') {
    const swimX = underwaterReturn.startX + Math.sin(p * Math.PI * 5) * 20;
    const swimY = underwaterReturn.startY - lift * 330 + Math.sin(p * Math.PI * 9) * 8;
    if (underwaterReturn.buddyIndex !== undefined) {
      chain.carryBuddy(underwaterReturn.buddyIndex, swimX, swimY, underwaterReturn.fishDir, -240);
    }
  } else {
    body.prevX = body.x;
    body.prevY = body.y;
    body.x = underwaterReturn.startX + Math.sin(p * Math.PI * 4) * 16;
    body.y = underwaterReturn.startY - lift * 320;
    body.vx = 0;
    body.vy = -420 * (1 - p);
    body.grounded = false;
    body.jumping = false;
  }

  if (fish) {
    fish.dir = underwaterReturn.fishDir;
    fish.t += dt * 8;
    if (underwaterReturn.target === 'buddy' && underwaterReturn.buddyIndex !== undefined) {
      const carried = chain.renders(performance.now())[underwaterReturn.buddyIndex];
      const carriedScale = carried?.scale ?? 1;
      fish.x = (carried?.x ?? underwaterReturn.startX) + (PLAYER_W * carriedScale) / 2 - FISH_W / 2;
      fish.y = (carried?.y ?? underwaterReturn.startY) - FISH_H + 18;
    } else {
      fish.x = body.x + PLAYER_W / 2 - FISH_W / 2;
      fish.y = body.y - FISH_H + 18;
    }
  }

  if (p >= 1) {
    const rideTarget = underwaterReturn.target;
    const buddyIndex = underwaterReturn.buddyIndex;
    const landingX = underwaterReturn.startX;
    const returnTo = underwaterReturn.returnTo;
    const fishDir = underwaterReturn.fishDir;
    const top = platformTopAtCenter(landingX + PLAYER_W / 2);
    underwaterReturn = null;
    fish = null;
    if (rideTarget === 'buddy' && buddyIndex !== undefined) {
      fishCooldown = 3 + Math.random() * 3;
      const carried = chain.renders(performance.now())[buddyIndex];
      const removed = chain.removeBuddy(buddyIndex);
      if (removed) stashCarriedBuddy(removed, returnTo, carried, landingX, fishDir);
      spawnSparks((carried?.x ?? landingX) + PLAYER_W / 2, carried?.y ?? body.y, 14);
      showToast(`Buddy swam to ${worldDisplayName(returnTo)}!`);
      speakText('Buddy swam up!', { rate: 1, pitch: 1.2 });
      setStatus(`Find that buddy in ${worldDisplayName(returnTo)}.`);
      updateHud();
    } else if (returnTo === 'underwater') {
      fishCooldown = 0.8 + Math.random() * 1.2;
      deepSeaWorld = false;
      underwaterWorld = true;
      undergroundWorld = false;
      body.x = top !== null ? landingX : lastSafe.x;
      body.y = top !== null ? top - PLAYER_H : lastSafe.y;
      body.prevX = body.x;
      body.prevY = body.y;
      body.vx = 0;
      body.vy = 0;
      body.grounded = false;
      lastSafe = { x: body.x, y: body.y };
      spawnSparks(body.x + PLAYER_W / 2, body.y + 8, 18);
      showToast('Back to the reef!');
      speakText('Back to the reef!', { rate: 1, pitch: 1.15 });
      setStatus('Back underwater. Touch a fish to swim up to the cave.');
    } else {
      fishCooldown = 0;
      underwaterWorld = false;
      deepSeaWorld = false;
      undergroundWorld = true;
      snake = null;
      snakeCooldown = 1.2;
      tarantulas = [];
      tarantulaCooldown = 0.6 + Math.random() * 1.1;
      body.x = top !== null ? landingX : lastSafe.x;
      body.y = top !== null ? top - PLAYER_H : lastSafe.y;
      body.prevX = body.x;
      body.prevY = body.y;
      body.vx = 0;
      body.vy = 0;
      body.grounded = false;
      lastSafe = { x: body.x, y: body.y };
      spawnSparks(body.x + PLAYER_W / 2, body.y + 8, 18);
      showToast('Back in the cave!');
      speakText('Back in the cave!', { rate: 1, pitch: 1.05 });
      setStatus('Back in the cave. Find the snake trampoline to reach the surface.');
    }
  }

  if (exclusivePlayerRide) updateParticles(dt);
  return exclusivePlayerRide;
}

function updateFish(dt: number): void {
  if ((!underwaterWorld && !deepSeaWorld) || underwaterReturn) return;

  if (!fish) {
    fishCooldown -= dt;
    if (fishCooldown <= 0) spawnFish();
    return;
  }

  fish.t += dt * 6;
  fish.x += fish.dir * (deepSeaWorld ? LANTERN_FISH_SPEED : FISH_SPEED) * dt;
  fish.y += Math.sin(fish.t) * (deepSeaWorld ? 18 : 12) * dt;

  if (fish.x < body.x - 760 || fish.x > body.x + 900) {
    fish = null;
    fishCooldown = 2.5 + Math.random() * 3;
    return;
  }

  const buddyHit = findBuddyCollision(fish.x + 8, fish.y + 4, FISH_W - 16, FISH_H - 8);
  if (buddyHit) {
    startFishBuddyRide(buddyHit.index, buddyHit.render);
    return;
  }

  if (overlapsRect(body.x, body.y, body.w, body.h, fish.x + 8, fish.y + 4, FISH_W - 16, FISH_H - 8)) {
    startFishRide();
  }
}

function applyDragVelocity(v: number, drag: number): number {
  if (v > 0) return Math.max(0, v - drag);
  if (v < 0) return Math.min(0, v + drag);
  return 0;
}

function stepSwimBody(
  body: Body,
  solids: Solid[],
  input: MoveInput & { downHeld: boolean },
  dt: number,
): StepResult {
  const res: StepResult = {
    landed: false,
    startedJump: input.jumpPressed,
    landedOn: null,
    wallHits: [],
    ceilingHit: null,
  };

  body.prevX = body.x;
  body.prevY = body.y;
  body.grounded = false;
  body.jumping = false;
  body.coyote = 0;
  body.buffer = 0;
  body.jumpHold = 0;

  const xDir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  const yDir = (input.jumpHeld || input.jumpPressed ? -1 : 0) + (input.downHeld ? 1 : 0);
  if (xDir !== 0) body.vx = clamp(body.vx + xDir * SWIM_ACCEL * dt, -SWIM_MAX_X, SWIM_MAX_X);
  else body.vx = applyDragVelocity(body.vx, SWIM_DRAG * SWIM_MAX_X * dt);
  if (yDir !== 0) body.vy = clamp(body.vy + yDir * SWIM_ACCEL * dt, -SWIM_MAX_Y, SWIM_MAX_Y);
  else body.vy = approach(body.vy, SWIM_SINK_MAX_Y, SWIM_SINK_ACCEL * dt);

  body.x += body.vx * dt;
  for (const s of solids) {
    if (!overlapsRect(body.x, body.y, body.w, body.h, s.x, s.y, s.w, s.h)) continue;
    if (body.vx > 0) {
      body.x = s.x - body.w;
      body.vx = 0;
      res.wallHits.push(s);
    } else if (body.vx < 0) {
      body.x = s.x + s.w;
      body.vx = 0;
      res.wallHits.push(s);
    }
  }

  const wasGrounded = body.grounded;
  body.y += body.vy * dt;
  for (const s of solids) {
    if (!overlapsRect(body.x, body.y, body.w, body.h, s.x, s.y, s.w, s.h)) continue;
    if (body.vy > 0) {
      body.y = s.y - body.h;
      body.vy = 0;
      body.grounded = true;
      res.landedOn = s;
    } else if (body.vy < 0) {
      body.y = s.y + s.h;
      body.vy = 0;
      res.ceilingHit = s;
    }
  }
  if (body.grounded && !wasGrounded) res.landed = true;

  body.x = clamp(body.x, 0, Math.max(0, level.width - body.w));
  return res;
}

function findBuddyCollision(x: number, y: number, w: number, h: number): { index: number; render: BuddyRender } | null {
  if (chain.count === 0) return null;
  const buddies = chain.renders(performance.now());
  for (let i = 0; i < buddies.length; i++) {
    const bd = buddies[i];
    const scale = bd.scale ?? 1;
    if (overlapsRect(bd.x, bd.y, PLAYER_W * scale, PLAYER_H * scale, x, y, w, h)) {
      return { index: i, render: bd };
    }
  }
  return null;
}

function findBirdBuddyCollision(): { index: number; render: BuddyRender } | null {
  if (!bird) return null;
  return findBuddyCollision(bird.x + 10, bird.y + 4, BIRD_W - 20, BIRD_H - 8);
}

function updateBird(dt: number): void {
  updateBirdTripSide(body.x + body.w / 2);

  if (!canSpawnBird()) {
    if (!birdRide) bird = null;
    return;
  }

  if (!bird) {
    if (birdFlybysRemaining <= 0 || !birdTripHasStarted()) return;
    birdCooldown -= dt;
    if (birdCooldown <= 0) spawnBird();
    return;
  }

  bird.wingT += dt * 9;
  bird.x += bird.dir * BIRD_SPEED * dt;
  const farLeft = body.x - 760;
  const farRight = body.x + 900;
  if (bird.x < farLeft || bird.x > farRight) {
    bird = null;
    birdCooldown = birdFlybysRemaining > 0 ? 5 + Math.random() * 4 : Number.POSITIVE_INFINITY;
    return;
  }

  if (overlapsRect(body.x, body.y, body.w, body.h, bird.x + 10, bird.y + 4, BIRD_W - 20, BIRD_H - 8)) {
    startBirdRide();
    return;
  }

  const buddyHit = findBirdBuddyCollision();
  if (buddyHit) {
    startBirdBuddyRide(buddyHit.index, buddyHit.render);
  }
}

function updateBirdRide(dt: number): boolean {
  if (!birdRide) return false;

  birdRide.t += dt;
  const exclusivePlayerRide = birdRide.target === 'player';
  const p = clamp(birdRide.t / BIRD_RIDE_DUR, 0, 1);
  const lift = smoothstep(p);
  if (birdRide.target === 'player') {
    body.prevX = body.x;
    body.prevY = body.y;
    body.vx = 0;
    body.vy = 0;
    body.jumping = false;
    body.x = birdRide.startX + Math.sin(p * Math.PI * 2) * 12;
    body.y = birdRide.startY - lift * 260;
    body.grounded = false;
    facing = birdRide.dir;
  } else if (birdRide.buddyIndex !== undefined) {
    const flutterX = Math.sin(p * Math.PI * 7) * 18;
    const flutterY = Math.sin(p * Math.PI * 10) * 8;
    const carriedX = birdRide.startX + flutterX;
    const carriedY = birdRide.startY - lift * 330 - flutterY;
    chain.carryBuddy(birdRide.buddyIndex, carriedX, carriedY, birdRide.dir, -260);
  }

  if (bird) {
    bird.dir = birdRide.dir;
    bird.wingT += dt * 11;
    if (birdRide.target === 'player') {
      bird.x = body.x + PLAYER_W / 2 - BIRD_W / 2;
      bird.y = body.y - BIRD_H + 8;
    } else {
      const carriedScale = birdRide.buddyIndex !== undefined ? (chain.renders(performance.now())[birdRide.buddyIndex]?.scale ?? 1) : 1;
      const carryX = birdRide.buddyIndex !== undefined ? (chain.renders(performance.now())[birdRide.buddyIndex]?.x ?? birdRide.startX) : birdRide.startX;
      const carryY = birdRide.buddyIndex !== undefined ? (chain.renders(performance.now())[birdRide.buddyIndex]?.y ?? birdRide.startY) : birdRide.startY;
      bird.x = carryX + (PLAYER_W * carriedScale) / 2 - BIRD_W / 2;
      bird.y = carryY - BIRD_H + 8;
    }
  }

  if (p >= 1) {
    const landingX = birdRide.startX;
    const landingCx = landingX + PLAYER_W / 2;
    const landingTop = birdRide.target === 'player' ? surfaceTopAtCenter(landingCx) : null;
    const rideTarget = birdRide.target;
    const buddyIndex = birdRide.buddyIndex;
    const rideDir = birdRide.dir;
    birdRide = null;
    bird = null;
    if (rideTarget === 'player') {
      candyWorld = true;
      upperAtmosphereWorld = false;
      birdCooldown = Number.POSITIVE_INFINITY;
      body.x = landingTop !== null ? landingX : lastSafe.x;
      body.y = landingTop !== null ? landingTop - PLAYER_H : lastSafe.y;
      body.prevX = body.x;
      body.prevY = body.y;
      body.grounded = false;
      lastSafe = { x: body.x, y: body.y };
      chain.releaseCarriedBuddy();
      spawnSparks(body.x + PLAYER_W / 2, body.y + 10, 18);
      showToast('Candy cloud world!');
      speakText('Candy cloud world!', { rate: 1, pitch: 1.35 });
      setStatus(isWeddingMode()
        ? 'Candy clouds! Find your partner, snacks, and the UFO beam.'
        : 'Candy clouds! Eat gumdrops or find the UFO beam.');
      updateHud();
    } else if (buddyIndex !== undefined) {
      const carried = chain.renders(performance.now())[buddyIndex];
      const removed = chain.removeBuddy(buddyIndex);
      if (removed) stashCarriedBuddy(removed, 'candy', carried, landingX, rideDir);
      birdCooldown = 5 + Math.random() * 5;
      spawnSparks((carried?.x ?? landingX) + PLAYER_W / 2, carried?.y ?? body.y, 14);
      showToast('Buddy flew to candy!');
      speakText('Buddy flew to candy!', { rate: 1, pitch: 1.25 });
      setStatus('Find that buddy in candy clouds.');
      updateHud();
    }
  }

  if (exclusivePlayerRide) updateParticles(dt);
  return exclusivePlayerRide;
}

function startWeddingSmooch(): boolean {
  if (!isWeddingMode() || weddingEvent || !weddingReadyForSmooch || !isNearWeddingPartner()) return false;
  const partner = weddingPartnerCenter();
  if (!partner) return false;

  const partnerKind = weddingPartnerKind();
  const mateColorIndex = weddingMateColorIndex;
  const babyBase = weddingBabyBasePosition();
  body.vx = 0;
  body.vy = 0;
  body.jumping = false;
  facing = body.x + body.w / 2 <= partner.x ? 1 : -1;
  weddingReadyForSmooch = false;
  weddingEvent = {
    phase: 'kiss',
    t: 0,
    colorIndex: mateColorIndex,
    partnerKind,
    babySpecies: weddingBabySpecies(partnerKind),
    babyBaseX: babyBase.x,
    babyBaseY: babyBase.y,
  };
  sfx.smooch();
  spawnSparks((body.x + body.w / 2 + partner.x) / 2, body.y + 14, 10);
  showToast(partnerKind === 'fish' ? 'Fish smooch!' : 'Smooch! ♥');
  speakText(partnerKind === 'fish' ? 'Fish smooch!' : 'Smooch!', { rate: 1.05, pitch: 1.3 });
  setStatus(partnerKind === 'fish' ? 'Fish smooch!' : 'Smooch!');
  markWeddingMateColor(mateColorIndex);
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
    const fishBaby = weddingEvent.babySpecies === 'fishBuddy';
    showToast(fishBaby ? 'Tiny fish-buddy!' : 'Tiny buddy!');
    speakText(fishBaby ? 'Tiny fish buddy!' : 'Tiny buddy!', { rate: 1.05, pitch: 1.35 });
    return;
  }

  if (weddingEvent.phase === 'baby' && weddingEvent.t >= WEDDING_BABY_CRADLE_DUR) {
    const colorIndex = weddingEvent.colorIndex;
    const joinFrom = { x: weddingEvent.babyBaseX, y: weddingEvent.babyBaseY };
    const species = weddingEvent.babySpecies;
    weddingEvent = null;
    chain.add(colorIndex, facing, performance.now(), body.x, body.y, {
      startScale: WEDDING_BABY_START_SCALE,
      duration: WEDDING_BABY_GROW_DUR,
      joinFrom,
      joinDuration: WEDDING_BABY_JOIN_DUR,
      species,
    });
    weddingMateColorIndex = chooseWeddingMateColor(colorIndex);
    sfx.score();
    spawnSparks(joinFrom.x + PLAYER_W / 2, joinFrom.y, 14);
    setStatus('Return to the left flag to get ready again.');
    updateHud();
  }
}

function collectBuddy(flagDir: number): void {
  chain.add(chain.count % BUDDY_COLOR_COUNT, flagDir, performance.now(), body.x, body.y);
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

function enterUndergroundWorld(): void {
  candyWorld = false;
  upperAtmosphereWorld = false;
  ufoRide = null;
  undergroundWorld = true;
  underwaterWorld = false;
  deepSeaWorld = false;
  bird = null;
  birdRide = null;
  fish = null;
  underwaterReturn = null;
  chain.releaseCarriedBuddy();
  snake = null;
  snakeCooldown = 0.8 + Math.random() * 1.2;
  tarantulas = [];
  tarantulaCooldown = 0.5 + Math.random() * 1.2;
  respawnTo(lastSafe);
  spawnDust(lastSafe.x + PLAYER_W / 2, lastSafe.y + PLAYER_H, 10);
  showToast('Underground cave!');
  speakText('Underground cave!', { rate: 1, pitch: 0.9 });
  setStatus('Cave cheese! Space eats. Find a snake trampoline to get back up.');
  updateHud();
}

function leaveCandyWorld(): void {
  candyWorld = false;
  upperAtmosphereWorld = false;
  ufoRide = null;
  undergroundWorld = false;
  underwaterWorld = false;
  deepSeaWorld = false;
  bird = null;
  birdRide = null;
  snake = null;
  tarantulas = [];
  tarantulaCooldown = 0;
  fish = null;
  chain.releaseCarriedBuddy();
  const cx = body.x + body.w / 2;
  const midpoint = level.leftGoalX === undefined ? level.width / 2 : (level.leftGoalX + level.goalX) / 2;
  resetBirdTrip(cx <= midpoint ? 'left' : 'right');
  respawnTo(lastSafe);
  spawnDust(lastSafe.x + PLAYER_W / 2, lastSafe.y + PLAYER_H, 10);
  showToast('Back to the surface!');
  setStatus(isWeddingMode() ? 'Back on the ground. Find another bird when you are ready.' : 'Back on the ground. Find another bird to return to candy clouds.');
  updateHud();
}

function enterUnderwaterWorld(): void {
  candyWorld = false;
  upperAtmosphereWorld = false;
  ufoRide = null;
  undergroundWorld = false;
  underwaterWorld = true;
  deepSeaWorld = false;
  snake = null;
  undergroundReturn = null;
  tarantulas = [];
  tarantulaCooldown = 0;
  fish = null;
  fishCooldown = 0.8 + Math.random() * 1.3;
  respawnTo(lastSafe);
  spawnDust(lastSafe.x + PLAYER_W / 2, lastSafe.y + PLAYER_H, 8);
  showToast('Underwater world!');
  speakText('Underwater world!', { rate: 1, pitch: 1.15 });
  setStatus('Space eats crunchy kelp. Touch a fish to swim back up.');
  updateHud();
}

function enterDeepSeaWorld(): void {
  candyWorld = false;
  upperAtmosphereWorld = false;
  ufoRide = null;
  undergroundWorld = false;
  underwaterWorld = false;
  deepSeaWorld = true;
  snake = null;
  undergroundReturn = null;
  tarantulas = [];
  tarantulaCooldown = 0;
  fish = null;
  fishCooldown = 0.9 + Math.random() * 1.4;
  respawnTo(lastSafe);
  spawnDust(lastSafe.x + PLAYER_W / 2, lastSafe.y + PLAYER_H, 8);
  showToast('Deep sea!');
  speakText('Deep sea!', { rate: 0.95, pitch: 0.85 });
  setStatus('Space eats glowing starfruit. Find a lantern fish to swim up.');
  updateHud();
}

function handlePitFall(): void {
  if (upperAtmosphereWorld) {
    upperAtmosphereWorld = false;
    candyWorld = true;
    ufoRide = null;
    ufoCooldown = UFO_REUSE_DELAY;
    respawnTo(lastSafe);
    spawnSparks(lastSafe.x + PLAYER_W / 2, lastSafe.y + PLAYER_H, 14);
    showToast('Soft landing!');
    speakText('Soft landing!', { rate: 1.05, pitch: 1.3 });
    setStatus('A candy cloud caught you. Find the UFO beam to go back up.');
    updateHud();
    return;
  }
  if (candyWorld) {
    leaveCandyWorld();
    return;
  }
  if (deepSeaWorld) {
    respawnTo(lastSafe);
    fishCooldown = Math.min(fishCooldown, 1);
    showToast('Back to the deep ledge.');
    setStatus('Find a lantern fish to swim back up.');
    return;
  }
  if (underwaterWorld) {
    enterDeepSeaWorld();
    return;
  }
  if (undergroundWorld) {
    enterUnderwaterWorld();
    return;
  }
  enterUndergroundWorld();
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
  if (worldMapOpen) {
    jumpEdge = false;
    interactEdge = false;
    eatEdge = false;
    return;
  }
  if (isWeddingMode()) updateCroissantRain(dt);

  // During the level-clear celebration the player just settles from the victory
  // hop; no input, scoring or hazards until the next level loads.
  if (phase === 'celebrating') {
    celebrateT += dt;
    jumpEdge = false;
    interactEdge = false;
    eatEdge = false;
    stepBody(body, solids, NEUTRAL_INPUT, tuning, dt);
    if (hasBuddyChain()) chain.step(dt, body.x, body.y);
    updateParticles(dt);
    if (celebrateT >= CELEBRATE_DUR) advanceLevel();
    return;
  }

  if (updateUfoRide(dt)) {
    jumpEdge = false;
    interactEdge = false;
    eatEdge = false;
    return;
  }
  if (updateBirdRide(dt)) {
    jumpEdge = false;
    interactEdge = false;
    eatEdge = false;
    return;
  }
  if (updateUndergroundReturn(dt)) {
    jumpEdge = false;
    interactEdge = false;
    eatEdge = false;
    return;
  }
  if (updateUnderwaterReturn(dt)) {
    jumpEdge = false;
    interactEdge = false;
    eatEdge = false;
    return;
  }

  ufoCooldown = Math.max(0, ufoCooldown - dt);
  const pressedEat = eatEdge;
  eatEdge = false;
  if (pressedEat) {
    handleEatAction();
    if (ufoRide) {
      jumpEdge = false;
      interactEdge = false;
      return;
    }
  }

  const left = moveCodes.has('ArrowLeft') || moveCodes.has('KeyA');
  const right = moveCodes.has('ArrowRight') || moveCodes.has('KeyD');
  const downHeld = interactCodes.size > 0;
  const pressedInteract = interactEdge;
  interactEdge = false;
  if (pressedInteract && isWeddingMode() && !startWeddingSmooch()) {
    setStatus(weddingInteractHint());
  }

  const lockForWeddingEvent = weddingMovementLocked();
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

  const res = underwaterWorld || deepSeaWorld
    ? stepSwimBody(body, solids, { ...input, downHeld: lockForWeddingEvent ? false : downHeld }, dt)
    : stepBody(body, solids, input, tuning, dt);

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
    if (isLeftGoalPlatform(res.landedOn)) noteBirdTripSide('left');
    else if (isRightGoalPlatform(res.landedOn)) noteBirdTripSide('right');
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
    if (maybeCollectStrandedBuddies()) return;
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

  updateSnake(dt);
  updateTarantulas(dt);
  updateFish(dt);

  // Falling into a pit.
  if (body.y > level.killY) {
    handlePitFall();
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

  updateBird(dt);
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
  const now = performance.now();
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
    invuln: now < invulnUntil,
    flagDown: phase === 'celebrating' ? clamp(celebrateT / FLAG_DUR, 0, 1) : 0,
    buddies: hasBuddyChain() ? chain.renders(now) : [],
    worldBuddies: hasBuddyChain() ? strandedBuddyRenders(now) : [],
    wedding: isWeddingMode() && level.partnerX !== undefined ? {
      partnerX: level.partnerX,
      partnerY: level.partnerY ?? GROUND_Y - PLAYER_H,
      partnerKind: weddingEvent?.partnerKind ?? weddingPartnerKind(),
      partnerColorIndex: weddingEvent?.colorIndex ?? weddingMateColorIndex,
      near: isNearWeddingPartner(),
      phase: weddingEvent?.phase ?? 'idle',
      phaseT: weddingEvent?.t ?? 0,
      colorIndex: weddingEvent?.colorIndex ?? weddingMateColorIndex,
      babySpecies: weddingEvent?.babySpecies ?? weddingBabySpecies(weddingPartnerKind()),
      babyBaseX: weddingEvent?.babyBaseX ?? weddingBabyBasePosition().x,
      babyBaseY: weddingEvent?.babyBaseY ?? weddingBabyBasePosition().y,
    } : undefined,
    candyWorld,
    upperAtmosphereWorld,
    atmosphereLiftT: ufoRide ? clamp(ufoRide.t / UFO_RIDE_DUR, 0, 1) : 0,
    skyRideT: birdRide ? clamp(birdRide.t / BIRD_RIDE_DUR, 0, 1) : 0,
    undergroundWorld,
    undergroundLiftT: undergroundReturn ? clamp(undergroundReturn.t / UNDERGROUND_RETURN_DUR, 0, 1) : 0,
    underwaterWorld,
    underwaterLiftT: underwaterReturn ? clamp(underwaterReturn.t / UNDERWATER_RETURN_DUR, 0, 1) : 0,
    deepSeaWorld,
    consumables: consumables[currentWorldLayer()] ?? [],
    ufo: candyWorld || upperAtmosphereWorld || ufoRide ? {
      ...ufoPortalPosition(),
      t: view.time,
      active: ufoRide !== null,
    } : undefined,
    bird: bird ? {
      x: bird.x,
      y: bird.y,
      dir: bird.dir,
      wingT: bird.wingT,
      carrying: birdRide !== null,
    } : undefined,
    snake: snake ? {
      x: snake.x,
      y: snake.y,
      kind: snake.kind,
      t: snake.t,
      dir: snake.dir,
    } : undefined,
    tarantulas: undergroundWorld ? tarantulas.map((tarantula) => ({
      x: tarantula.x,
      y: tarantula.y,
      dir: tarantula.dir,
      t: tarantula.t,
      emergeT: tarantula.emergeT,
      torchX: tarantula.torchX,
    })) : [],
    fish: fish ? {
      x: fish.x,
      y: fish.y,
      dir: fish.dir,
      t: fish.t,
      carrying: underwaterReturn !== null,
      kind: deepSeaWorld ? 'lantern' : 'fish',
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
  exploredWorlds = loadExploredWorlds();

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
  worldMapOpen = false;
  worldMapEl.classList.remove('visible');
  worldMapEl.setAttribute('aria-hidden', 'true');
  worldMapButtonEl.setAttribute('aria-expanded', 'false');
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
  interactCodes.clear();
  jumpEdge = false;
  interactEdge = false;
  eatEdge = false;
}

// --- input ------------------------------------------------------------------

const MOVE_CODES = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
const JUMP_CODES = new Set(['ArrowUp', 'KeyW']);
const INTERACT_CODES = new Set(['ArrowDown', 'KeyS']);
const EAT_CODES = new Set(['Space']);

function onKeyDown(event: KeyboardEvent): void {
  if (!gameActive) return;
  if (shouldIgnoreGameKey(event)) return;
  const code = event.code;

  if (code === 'Escape' && worldMapOpen) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeWorldMap();
    return;
  }
  if (code === 'KeyM') {
    event.preventDefault();
    if (!event.repeat) {
      if (worldMapOpen) closeWorldMap();
      else openWorldMap();
    }
    return;
  }
  if (worldMapOpen) {
    event.preventDefault();
    return;
  }

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
    interactCodes.add(code);
    if (!event.repeat) interactEdge = true;
  } else if (EAT_CODES.has(code)) {
    event.preventDefault();
    if (!event.repeat) eatEdge = true;
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
    interactCodes.delete(code);
  } else if (EAT_CODES.has(code)) {
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
      interactCodes.add('TouchInteract');
      interactEdge = true;
    };
    const release = (e: Event) => {
      e.preventDefault();
      interactCodes.delete('TouchInteract');
    };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  });

  document.querySelectorAll<HTMLElement>('[data-jp-eat]').forEach((btn) => {
    const press = (e: Event) => {
      e.preventDefault();
      eatEdge = true;
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
  hudEl = document.getElementById('jp-hud')!;
  modeChipEl = document.getElementById('jp-mode')!;
  scoreEl = document.getElementById('jp-score')!;
  bestEl = document.getElementById('jp-best')!;
  heartsEl = document.getElementById('jp-hearts')!;
  snacksEl = document.getElementById('jp-snacks')!;
  buddiesPillEl = document.getElementById('jp-buddies-pill')!;
  buddiesLabelEl = document.getElementById('jp-buddies-label')!;
  buddiesEl = document.getElementById('jp-buddies')!;
  mateProgressEl = document.getElementById('jp-mate-progress')!;
  statusEl = document.getElementById('jp-status')!;
  toastEl = document.getElementById('jp-toast')!;
  touchInteractEl = document.getElementById('jp-touch-interact')!;
  worldMapButtonEl = document.getElementById('jp-world-map-button') as HTMLButtonElement;
  worldMapEl = document.getElementById('jp-world-map')!;
  worldMapCloseEl = document.getElementById('jp-world-map-close') as HTMLButtonElement;

  loop = createLoop(update, renderFrame);

  document.querySelectorAll<HTMLElement>('[data-jp-mode]').forEach((btn) => {
    btn.addEventListener('click', () => startGame(btn.dataset.jpMode!));
  });
  modeChipEl.addEventListener('click', () => {
    if (!gameActive) return;
    const i = MODE_ORDER.indexOf(mode.id);
    switchMode(String(MODE_ORDER[(i + 1) % MODE_ORDER.length]));
  });
  worldMapButtonEl.addEventListener('click', openWorldMap);
  worldMapCloseEl.addEventListener('click', () => closeWorldMap());
  worldMapEl.addEventListener('click', (event) => {
    if (event.target === worldMapEl) closeWorldMap();
  });
  worldMapEl.querySelectorAll<HTMLElement>('[data-jp-world]').forEach((button) => {
    button.addEventListener('click', () => travelToWorld(button.dataset.jpWorld as WorldLayer));
  });

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  bindTouchControls();

  window.addEventListener('blur', clearInput);
  window.addEventListener('resize', () => {
    if (gameActive) {
      resizeCanvas();
      positionStatusBelowHud();
    }
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
