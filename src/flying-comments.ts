import {
  isMobile,
  enterFullscreen,
  exitFullscreen,
  setupEscapeHold,
  setupFullscreenExit,
  preventContextMenu,
  speakText,
} from './utils';

interface Comet {
  el: HTMLDivElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  radius: number;
}

interface Particle {
  el: HTMLDivElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  life: number;
  maxLife: number;
}

const START_SCORE = 5;
const PLAYER_SPEED = 380;
const PLAYER_WIDTH = 72;
const PLAYER_HEIGHT = 54;
const COMET_RADIUS = 28;
const SHIELD_RADIUS = 56;
const SHIELD_DURATION_MS = 1500;
const SHIELD_COOLDOWN_MS = 4200;
const HIT_RECOVERY_MS = 900;
const MAX_COMETS = 6;
const MIN_SPAWN_MS = 850;
const MAX_SPAWN_MS = 1500;

let gameActive = false;
let score = START_SCORE;
let bestScore = 0;
let lastFrame = 0;
let rafId = 0;
let nextSpawnAt = 0;
let shieldActiveUntil = 0;
let shieldReadyAt = 0;
let hitRecoverUntil = 0;
let overlayMode: 'hidden' | 'playing' | 'gameover' = 'hidden';

let planeX = 0;
let planeY = 0;

const comets: Comet[] = [];
const particles: Particle[] = [];
const pressedKeys = new Set<string>();

let screenEl: HTMLElement;
let worldEl: HTMLElement;
let planeEl: HTMLElement;
let shieldEl: HTMLElement;
let cometLayerEl: HTMLElement;
let particleLayerEl: HTMLElement;
let scoreEl: HTMLElement;
let bestEl: HTMLElement;
let shieldTextEl: HTMLElement;
let shieldFillEl: HTMLElement;
let statusEl: HTMLElement;
let overlayEl: HTMLElement;
let overlayTitleEl: HTMLElement;
let overlayTextEl: HTMLElement;
let restartBtnEl: HTMLButtonElement;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function playFx(name: string, volume = 0.45, playbackRate = 1): void {
  const audio = new Audio(`sounds/${name}.mp3`);
  audio.volume = volume;
  audio.playbackRate = playbackRate;
  audio.play().catch(() => {});
}

function getBounds() {
  const rect = worldEl.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    minX: 24,
    maxX: Math.max(24, rect.width - PLAYER_WIDTH - 24),
    minY: 24,
    maxY: Math.max(24, rect.height - PLAYER_HEIGHT - 32),
  };
}

function updateHud(now = performance.now()): void {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(bestScore);

  if (shieldActiveUntil > now) {
    const remaining = Math.max(0, shieldActiveUntil - now);
    shieldTextEl.textContent = `On ${Math.ceil(remaining / 1000)}s`;
    shieldFillEl.style.width = '100%';
  } else if (shieldReadyAt <= now) {
    shieldTextEl.textContent = 'Ready';
    shieldFillEl.style.width = '100%';
  } else {
    const progress = 1 - (shieldReadyAt - now) / SHIELD_COOLDOWN_MS;
    shieldTextEl.textContent = 'Charging';
    shieldFillEl.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function showOverlay(mode: 'playing' | 'gameover'): void {
  overlayMode = mode;
  overlayEl.classList.add('visible');

  if (mode === 'playing') {
    overlayTitleEl.textContent = 'Flying Comments';
    overlayTextEl.textContent = 'Arrow keys move. Space gives you a shield for a short burst.';
    restartBtnEl.textContent = 'Resume';
  } else {
    overlayTitleEl.textContent = 'Out of Points';
    overlayTextEl.textContent = 'A comet clipped the plane. Restart to try another run.';
    restartBtnEl.textContent = 'Play Again';
  }
}

function hideOverlay(): void {
  overlayMode = 'hidden';
  overlayEl.classList.remove('visible');
}

function syncPlane(): void {
  planeEl.style.transform = `translate(${planeX}px, ${planeY}px)`;
}

function clearEntities(): void {
  while (comets.length) {
    comets.pop()!.el.remove();
  }
  while (particles.length) {
    particles.pop()!.el.remove();
  }
}

function addScore(delta: number): void {
  score = Math.max(0, score + delta);
  bestScore = Math.max(bestScore, score);
  updateHud();
}

function createParticleBurst(x: number, y: number, count = 9): void {
  const colors = ['#ffd166', '#ff8c42', '#ff5a36', '#fff3b0'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'fc-particle';
    el.style.background = colors[i % colors.length];
    particleLayerEl.appendChild(el);
    particles.push({
      el,
      x,
      y,
      vx: randomBetween(-220, 220),
      vy: randomBetween(-220, 40),
      rotation: randomBetween(0, 360),
      spin: randomBetween(-540, 540),
      life: randomBetween(450, 900),
      maxLife: 900,
    });
  }
}

function removeComet(comet: Comet): void {
  const index = comets.indexOf(comet);
  if (index >= 0) {
    comets.splice(index, 1);
  }
  comet.el.remove();
}

function shatterComet(comet: Comet, awardPoint: boolean): void {
  createParticleBurst(comet.x + 12, comet.y + 12, 12);
  playFx('shooting_star', 0.28, 1.2);
  if (awardPoint) {
    addScore(1);
  }
  removeComet(comet);
}

function spawnComet(): void {
  if (comets.length >= MAX_COMETS) return;

  const bounds = getBounds();
  const el = document.createElement('div');
  el.className = 'fc-comet';
  el.innerHTML =
    '<div class="fc-comet-trail"></div>' +
    '<div class="fc-comet-core">☄️</div>';
  cometLayerEl.appendChild(el);

  const speedScale = randomBetween(0.9, 1.35);
  const comet: Comet = {
    el,
    x: bounds.width + randomBetween(40, 180),
    y: randomBetween(40, Math.max(60, bounds.height * 0.55)),
    vx: -randomBetween(180, 310) * speedScale,
    vy: randomBetween(80, 210) * speedScale,
    rotation: randomBetween(150, 210),
    spin: randomBetween(-80, 80),
    radius: COMET_RADIUS,
  };
  comets.push(comet);
}

function collideCircle(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const radii = ar + br;
  return dx * dx + dy * dy <= radii * radii;
}

function onPlaneHit(comet: Comet): void {
  removeComet(comet);
  createParticleBurst(planeX + PLAYER_WIDTH / 2, planeY + PLAYER_HEIGHT / 2, 10);
  hitRecoverUntil = performance.now() + HIT_RECOVERY_MS;
  planeEl.classList.add('hit');
  setTimeout(() => planeEl.classList.remove('hit'), 280);
  playFx('balloon', 0.4, 0.9);
  addScore(-1);
  setStatus('Ouch. Dodge the next one.');

  if (score <= 0) {
    endRun();
  }
}

function updatePlane(deltaSeconds: number, now: number): void {
  const bounds = getBounds();
  let dx = 0;
  let dy = 0;

  if (pressedKeys.has('ArrowLeft')) dx -= 1;
  if (pressedKeys.has('ArrowRight')) dx += 1;
  if (pressedKeys.has('ArrowUp')) dy -= 1;
  if (pressedKeys.has('ArrowDown')) dy += 1;

  if (dx !== 0 || dy !== 0) {
    const scale = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
    planeX += dx * PLAYER_SPEED * scale * deltaSeconds;
    planeY += dy * PLAYER_SPEED * scale * deltaSeconds;
  }

  planeX = Math.max(bounds.minX, Math.min(bounds.maxX, planeX));
  planeY = Math.max(bounds.minY, Math.min(bounds.maxY, planeY));

  const tilt = dy * 10 + dx * 4;
  planeEl.style.transform = `translate(${planeX}px, ${planeY}px) rotate(${tilt}deg)`;

  const shieldOn = shieldActiveUntil > now;
  shieldEl.classList.toggle('active', shieldOn);
  planeEl.classList.toggle('shielding', shieldOn);
  planeEl.classList.toggle('recovering', hitRecoverUntil > now);
}

function updateComets(deltaSeconds: number, now: number): void {
  const bounds = getBounds();
  const planeCenterX = planeX + PLAYER_WIDTH / 2;
  const planeCenterY = planeY + PLAYER_HEIGHT / 2;
  const shieldOn = shieldActiveUntil > now;

  for (let i = comets.length - 1; i >= 0; i--) {
    const comet = comets[i];
    comet.x += comet.vx * deltaSeconds;
    comet.y += comet.vy * deltaSeconds;
    comet.rotation += comet.spin * deltaSeconds;
    comet.el.style.transform = `translate(${comet.x}px, ${comet.y}px) rotate(${comet.rotation}deg)`;

    const cometCenterX = comet.x + 28;
    const cometCenterY = comet.y + 24;

    if (
      shieldOn &&
      collideCircle(planeCenterX, planeCenterY, SHIELD_RADIUS, cometCenterX, cometCenterY, comet.radius)
    ) {
      shatterComet(comet, true);
      setStatus('Shield smash.');
      continue;
    }

    if (
      hitRecoverUntil <= now &&
      collideCircle(planeCenterX, planeCenterY, 24, cometCenterX, cometCenterY, comet.radius - 8)
    ) {
      onPlaneHit(comet);
      continue;
    }

    if (comet.x < -120 || comet.y > bounds.height + 120) {
      addScore(1);
      removeComet(comet);
      setStatus('Nice dodge.');
    }
  }
}

function updateParticles(deltaSeconds: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.life -= deltaSeconds * 1000;
    if (particle.life <= 0) {
      particles.splice(i, 1);
      particle.el.remove();
      continue;
    }

    particle.x += particle.vx * deltaSeconds;
    particle.y += particle.vy * deltaSeconds;
    particle.vy += 300 * deltaSeconds;
    particle.rotation += particle.spin * deltaSeconds;
    particle.el.style.transform = `translate(${particle.x}px, ${particle.y}px) rotate(${particle.rotation}deg)`;
    particle.el.style.opacity = String(Math.max(0, particle.life / particle.maxLife));
  }
}

function gameLoop(now: number): void {
  if (!gameActive) return;
  if (!lastFrame) lastFrame = now;

  const deltaSeconds = Math.min(0.033, (now - lastFrame) / 1000);
  lastFrame = now;

  if (overlayMode === 'hidden') {
    if (now >= nextSpawnAt) {
      spawnComet();
      nextSpawnAt = now + randomBetween(MIN_SPAWN_MS, MAX_SPAWN_MS);
    }

    updatePlane(deltaSeconds, now);
    updateComets(deltaSeconds, now);
    updateParticles(deltaSeconds);
    updateHud(now);
  }

  rafId = requestAnimationFrame(gameLoop);
}

function beginRun(): void {
  const bounds = getBounds();
  score = START_SCORE;
  bestScore = Math.max(bestScore, score);
  lastFrame = 0;
  nextSpawnAt = performance.now() + 900;
  shieldActiveUntil = 0;
  shieldReadyAt = 0;
  hitRecoverUntil = 0;
  planeX = bounds.width * 0.18;
  planeY = bounds.height * 0.5;
  pressedKeys.clear();
  clearEntities();
  syncPlane();
  updateHud();
  setStatus('Dodge the comets.');
  hideOverlay();
  playFx('airplane', 0.25, 1.05);
}

async function startGame(): Promise<void> {
  if (isMobile) await enterFullscreen();

  document.getElementById('start-screen')!.style.display = 'none';
  screenEl.style.display = 'block';
  gameActive = true;
  beginRun();
  speakText('Flying comments. Dodge the comets.', { rate: 1, pitch: 1.15 });
  rafId = requestAnimationFrame(gameLoop);
}

function stopGame(): void {
  pressedKeys.clear();
  gameActive = false;
  cancelAnimationFrame(rafId);
  rafId = 0;
  hideOverlay();
  clearEntities();
  screenEl.style.display = 'none';
  document.getElementById('start-screen')!.style.display = 'block';
}

function endRun(): void {
  overlayMode = 'gameover';
  showOverlay('gameover');
  playFx('ghost', 0.35, 0.95);
  speakText('Game over', { rate: 0.95, pitch: 0.9 });
  setStatus('Press play again or hold Escape to exit.');
}

function activateShield(): void {
  const now = performance.now();
  if (!gameActive || overlayMode !== 'hidden') return;
  if (shieldActiveUntil > now || shieldReadyAt > now) return;

  shieldActiveUntil = now + SHIELD_DURATION_MS;
  shieldReadyAt = shieldActiveUntil + SHIELD_COOLDOWN_MS;
  playFx('magic', 0.35, 1.1);
  setStatus('Shield up.');
  updateHud(now);
}

function onKeyDown(event: KeyboardEvent): void {
  if (!gameActive) return;

  if (event.key === ' ') {
    event.preventDefault();
    if (!event.repeat) activateShield();
    return;
  }

  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    pressedKeys.add(event.key);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (!gameActive) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    pressedKeys.delete(event.key);
  }
}

function setTouchKey(key: string, active: boolean): void {
  if (!gameActive) return;
  if (active) pressedKeys.add(key);
  else pressedKeys.delete(key);
}

function bindTouchControls(): void {
  document.querySelectorAll<HTMLElement>('[data-fc-dir]').forEach((btn) => {
    const key = btn.dataset.fcDir!;
    const press = (event: Event) => {
      event.preventDefault();
      setTouchKey(key, true);
    };
    const release = (event: Event) => {
      event.preventDefault();
      setTouchKey(key, false);
    };

    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  });

  document.querySelectorAll<HTMLElement>('[data-fc-shield]').forEach((btn) => {
    const activate = (event: Event) => {
      event.preventDefault();
      activateShield();
    };

    btn.addEventListener('touchstart', activate, { passive: false });
    btn.addEventListener('click', activate);
  });
}

function bindElements(): void {
  screenEl = document.getElementById('flying-comments-screen')!;
  worldEl = document.getElementById('fc-world')!;
  planeEl = document.getElementById('fc-plane')!;
  shieldEl = document.getElementById('fc-plane-shield')!;
  cometLayerEl = document.getElementById('fc-comet-layer')!;
  particleLayerEl = document.getElementById('fc-particle-layer')!;
  scoreEl = document.getElementById('fc-score')!;
  bestEl = document.getElementById('fc-best')!;
  shieldTextEl = document.getElementById('fc-shield-text')!;
  shieldFillEl = document.getElementById('fc-shield-fill')!;
  statusEl = document.getElementById('fc-status')!;
  overlayEl = document.getElementById('fc-overlay')!;
  overlayTitleEl = document.getElementById('fc-overlay-title')!;
  overlayTextEl = document.getElementById('fc-overlay-text')!;
  restartBtnEl = document.getElementById('fc-restart-btn') as HTMLButtonElement;
}

export async function initFlyingComments(): Promise<void> {
  bindElements();

  document.getElementById('flying-comments-btn')!.addEventListener('click', startGame);
  restartBtnEl.addEventListener('click', () => {
    beginRun();
  });

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);

  bindTouchControls();

  window.addEventListener('blur', () => {
    pressedKeys.clear();
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

  updateHud();
  setStatus('Arrow keys move. Space shields.');
}
