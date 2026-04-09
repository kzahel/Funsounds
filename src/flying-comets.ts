import {
  isMobile,
  enterFullscreen,
  exitFullscreen,
  setupEscapeHold,
  setupFullscreenExit,
  preventContextMenu,
  speakText,
} from './utils';

type FallingThingKind = 'comet' | 'cat';

interface Comet {
  kind: FallingThingKind;
  el: HTMLDivElement;
  x: number;
  y: number;
  baseVx: number;
  baseVy: number;
  rotation: number;
  spin: number;
  radius: number;
  width: number;
  height: number;
  totalWidth: number;
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
const SHIELD_RADIUS = 56;
const HIT_RECOVERY_MS = 900;
const MAX_COMETS = 7;
const MIN_SPAWN_MS = 520;
const MAX_SPAWN_MS = 980;
const CAT_SPAWN_RATE = 0.18;
const CAT_SLOW_RADIUS = 210;

interface WorldBounds {
  width: number;
  height: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

let gameActive = false;
let score = START_SCORE;
let bestScore = 0;
let lastFrame = 0;
let rafId = 0;
let nextSpawnAt = 0;
let hitRecoverUntil = 0;
let overlayMode: 'hidden' | 'playing' | 'gameover' = 'hidden';
let shieldHeld = false;
let shieldVisible = false;
let attachedCats = 0;

let planeX = 0;
let planeY = 0;
let bounds: WorldBounds = {
  width: 0,
  height: 0,
  minX: 24,
  maxX: 24,
  minY: 24,
  maxY: 24,
};

const comets: Comet[] = [];
const particles: Particle[] = [];
const pressedKeys = new Set<string>();

let screenEl: HTMLElement;
let worldEl: HTMLElement;
let planeEl: HTMLElement;
let planeCatsEl: HTMLElement;
let cometLayerEl: HTMLElement;
let particleLayerEl: HTMLElement;
let scoreEl: HTMLElement;
let bestEl: HTMLElement;
let catsEl: HTMLElement;
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

function updateBounds(): void {
  const rect = worldEl.getBoundingClientRect();
  bounds = {
    width: rect.width,
    height: rect.height,
    minX: 24,
    maxX: Math.max(24, rect.width - PLAYER_WIDTH - 24),
    minY: 24,
    maxY: Math.max(24, rect.height - PLAYER_HEIGHT - 32),
  };
}

function updateHud(): void {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(bestScore);
  catsEl.textContent = String(attachedCats);
  shieldTextEl.textContent = shieldVisible ? 'On' : 'Hold Space';
  shieldFillEl.style.width = '100%';
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function showOverlay(mode: 'playing' | 'gameover'): void {
  overlayMode = mode;
  overlayEl.classList.add('visible');

  if (mode === 'playing') {
    overlayTitleEl.textContent = 'Flying Comets';
    overlayTextEl.textContent = 'Arrow keys move. Hold Space to keep the shield up.';
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
  planeEl.style.transform = `translate3d(${planeX}px, ${planeY}px, 0)`;
}

function clearEntities(): void {
  while (comets.length) {
    comets.pop()!.el.remove();
  }
  while (particles.length) {
    particles.pop()!.el.remove();
  }
}

function renderAttachedCats(): void {
  planeCatsEl.innerHTML = '';
  for (let i = 0; i < attachedCats; i++) {
    const cat = document.createElement('div');
    cat.className = 'fc-plane-cat';
    cat.textContent = '🐱';
    cat.style.left = `${4 + i * 18}px`;
    cat.style.top = `${-10 - (i % 2) * 10}px`;
    planeCatsEl.appendChild(cat);
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
  createParticleBurst(comet.x + 12, comet.y + 12, 9);
  playFx('shooting_star', 0.28, 1.2);
  if (awardPoint) {
    addScore(1);
  }
  removeComet(comet);
}

function spawnComet(): void {
  if (comets.length >= MAX_COMETS) return;

  const isCat = Math.random() < CAT_SPAWN_RATE;
  const el = document.createElement('div');
  el.className = isCat ? 'fc-comet fc-cat' : 'fc-comet';
  el.innerHTML = isCat
    ? '<div class="fc-falling-cat">🐱</div>'
    : '<div class="fc-comet-trail"></div>' +
      '<div class="fc-comet-rock">' +
      '<span class="fc-comet-crater fc-comet-crater-a"></span>' +
      '<span class="fc-comet-crater fc-comet-crater-b"></span>' +
      '</div>';
  cometLayerEl.appendChild(el);

  const speedScale = randomBetween(0.95, 1.4);
  let width = 0;
  let height = 0;
  let totalWidth = 0;

  if (isCat) {
    const catSize = randomBetween(34, 52);
    width = catSize;
    height = catSize;
    totalWidth = catSize;
    el.style.setProperty('--fc-cat-size', `${catSize}px`);
  } else {
    const rockWidth = randomBetween(34, 62);
    const rockHeight = rockWidth * randomBetween(0.78, 1.08);
    const trailLength = rockWidth * randomBetween(0.95, 1.65);
    width = rockWidth;
    height = rockHeight;
    totalWidth = rockWidth + trailLength;
    el.style.setProperty('--fc-comet-width', `${rockWidth}px`);
    el.style.setProperty('--fc-comet-height', `${rockHeight}px`);
    el.style.setProperty('--fc-comet-trail', `${trailLength}px`);
    el.style.setProperty('--fc-comet-shadow', `${Math.max(6, rockWidth * 0.22)}px`);
  }

  const edgeRoll = Math.random();
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;

  if (edgeRoll < 0.45) {
    x = randomBetween(-40, bounds.width + 40);
    y = randomBetween(-160, -40);
    vx = randomBetween(-140, 140) * speedScale;
    vy = randomBetween(220, 360) * speedScale;
  } else if (edgeRoll < 0.8) {
    x = bounds.width + randomBetween(40, 180);
    y = randomBetween(-20, bounds.height * 0.9);
    vx = -randomBetween(220, 380) * speedScale;
    vy = randomBetween(40, 240) * speedScale;
  } else {
    x = bounds.width + randomBetween(20, 180);
    y = randomBetween(-180, -40);
    vx = -randomBetween(240, 420) * speedScale;
    vy = randomBetween(180, 340) * speedScale;
  }

  const angle = (Math.atan2(vy, vx) * 180) / Math.PI;
  const comet: Comet = {
    kind: isCat ? 'cat' : 'comet',
    el,
    x,
    y,
    baseVx: vx,
    baseVy: vy,
    rotation: angle,
    spin: isCat ? randomBetween(-40, 40) : randomBetween(-80, 80),
    radius: isCat ? Math.max(15, width * 0.28) : Math.max(16, width * 0.34),
    width,
    height,
    totalWidth,
  };
  comets.push(comet);
}

function collideCircle(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const radii = ar + br;
  return dx * dx + dy * dy <= radii * radii;
}

function collectCat(cat: Comet): void {
  removeComet(cat);
  attachedCats = Math.min(3, attachedCats + 1);
  renderAttachedCats();
  updateHud();
  playFx('cat', 0.48, randomBetween(0.96, 1.08));
  setStatus('Cat buddy aboard. Nearby comets slow way down.');
}

function onPlaneHit(comet: Comet): void {
  removeComet(comet);
  createParticleBurst(planeX + PLAYER_WIDTH / 2, planeY + PLAYER_HEIGHT / 2, 8);
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
  planeEl.style.transform = `translate3d(${planeX}px, ${planeY}px, 0) rotate(${tilt}deg)`;

  const shieldOn = shieldHeld;
  if (shieldVisible !== shieldOn) {
    shieldVisible = shieldOn;
    updateHud();
  }
  planeEl.classList.toggle('shielding', shieldOn);
  planeEl.classList.toggle('recovering', hitRecoverUntil > now);
}

function updateComets(deltaSeconds: number, now: number): void {
  const planeCenterX = planeX + PLAYER_WIDTH / 2;
  const planeCenterY = planeY + PLAYER_HEIGHT / 2;
  const shieldOn = shieldHeld;

  for (let i = comets.length - 1; i >= 0; i--) {
    const comet = comets[i];
    const cometCenterXBefore =
      comet.kind === 'cat' ? comet.x + comet.width * 0.5 : comet.x + comet.totalWidth - comet.width * 0.42;
    const cometCenterYBefore = comet.y + comet.height * 0.5;
    let speedFactor = 1;

    if (comet.kind === 'comet' && attachedCats > 0) {
      const dx = cometCenterXBefore - planeCenterX;
      const dy = cometCenterYBefore - planeCenterY;
      const distance = Math.hypot(dx, dy);
      const slowRadius = CAT_SLOW_RADIUS + attachedCats * 70;
      if (distance < slowRadius) {
        const t = distance / slowRadius;
        const minimumSpeed = Math.max(0.04, 0.14 - attachedCats * 0.02);
        speedFactor = minimumSpeed + (1 - minimumSpeed) * t;
      }
    }

    comet.x += comet.baseVx * speedFactor * deltaSeconds;
    comet.y += comet.baseVy * speedFactor * deltaSeconds;
    comet.rotation += comet.spin * deltaSeconds;
    comet.el.style.transform = `translate3d(${comet.x}px, ${comet.y}px, 0) rotate(${comet.rotation}deg)`;

    const cometCenterX =
      comet.kind === 'cat' ? comet.x + comet.width * 0.5 : comet.x + comet.totalWidth - comet.width * 0.42;
    const cometCenterY = comet.y + comet.height * 0.5;

    if (
      comet.kind === 'cat' &&
      collideCircle(planeCenterX, planeCenterY, shieldOn ? SHIELD_RADIUS : 26, cometCenterX, cometCenterY, comet.radius)
    ) {
      collectCat(comet);
      continue;
    }

    if (
      comet.kind === 'comet' &&
      shieldOn &&
      collideCircle(planeCenterX, planeCenterY, SHIELD_RADIUS, cometCenterX, cometCenterY, comet.radius)
    ) {
      shatterComet(comet, true);
      setStatus('Shield smash.');
      continue;
    }

    if (
      comet.kind === 'comet' &&
      hitRecoverUntil <= now &&
      collideCircle(planeCenterX, planeCenterY, 24, cometCenterX, cometCenterY, comet.radius - 8)
    ) {
      onPlaneHit(comet);
      continue;
    }

    if (
      comet.x < -comet.totalWidth - 80 ||
      comet.x > bounds.width + comet.totalWidth + 80 ||
      comet.y > bounds.height + comet.height + 120
    ) {
      if (comet.kind === 'comet') {
        addScore(1);
      }
      removeComet(comet);
      setStatus(comet.kind === 'comet' ? 'Nice dodge.' : 'A cat floated away.');
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
    particle.el.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) rotate(${particle.rotation}deg)`;
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
  }

  rafId = requestAnimationFrame(gameLoop);
}

function beginRun(): void {
  updateBounds();
  score = START_SCORE;
  bestScore = Math.max(bestScore, score);
  lastFrame = 0;
  nextSpawnAt = performance.now() + 900;
  hitRecoverUntil = 0;
  shieldHeld = false;
  shieldVisible = false;
  attachedCats = 0;
  planeX = bounds.width * 0.18;
  planeY = bounds.height * 0.5;
  pressedKeys.clear();
  clearEntities();
  renderAttachedCats();
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
  speakText('Flying comets. Dodge the comets.', { rate: 1, pitch: 1.15 });
  rafId = requestAnimationFrame(gameLoop);
}

function stopGame(): void {
  pressedKeys.clear();
  shieldHeld = false;
  shieldVisible = false;
  attachedCats = 0;
  gameActive = false;
  cancelAnimationFrame(rafId);
  rafId = 0;
  hideOverlay();
  clearEntities();
  renderAttachedCats();
  screenEl.style.display = 'none';
  document.getElementById('start-screen')!.style.display = 'block';
}

function endRun(): void {
  overlayMode = 'gameover';
  shieldHeld = false;
  shieldVisible = false;
  updateHud();
  showOverlay('gameover');
  playFx('ghost', 0.35, 0.95);
  speakText('Game over', { rate: 0.95, pitch: 0.9 });
  setStatus('Press play again or hold Escape to exit.');
}

function setShieldHeld(active: boolean): void {
  if (!gameActive || overlayMode !== 'hidden') return;
  if (shieldHeld === active) return;
  shieldHeld = active;
  if (active) {
    playFx('magic', 0.24, 1.1);
    setStatus('Shield up.');
  } else {
    setStatus('Dodge the comets.');
  }
  updateHud();
}

function onKeyDown(event: KeyboardEvent): void {
  if (!gameActive) return;

  if (event.key === ' ') {
    event.preventDefault();
    setShieldHeld(true);
    return;
  }

  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    pressedKeys.add(event.key);
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (!gameActive) return;
  if (event.key === ' ') {
    event.preventDefault();
    setShieldHeld(false);
    return;
  }
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
    const press = (event: Event) => {
      event.preventDefault();
      setShieldHeld(true);
    };
    const release = (event: Event) => {
      event.preventDefault();
      setShieldHeld(false);
    };

    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  });
}

function bindElements(): void {
  screenEl = document.getElementById('flying-comments-screen')!;
  worldEl = document.getElementById('fc-world')!;
  planeEl = document.getElementById('fc-plane')!;
  planeCatsEl = document.getElementById('fc-plane-cats')!;
  cometLayerEl = document.getElementById('fc-comet-layer')!;
  particleLayerEl = document.getElementById('fc-particle-layer')!;
  scoreEl = document.getElementById('fc-score')!;
  bestEl = document.getElementById('fc-best')!;
  catsEl = document.getElementById('fc-cats')!;
  shieldTextEl = document.getElementById('fc-shield-text')!;
  shieldFillEl = document.getElementById('fc-shield-fill')!;
  statusEl = document.getElementById('fc-status')!;
  overlayEl = document.getElementById('fc-overlay')!;
  overlayTitleEl = document.getElementById('fc-overlay-title')!;
  overlayTextEl = document.getElementById('fc-overlay-text')!;
  restartBtnEl = document.getElementById('fc-restart-btn') as HTMLButtonElement;
}

export async function initFlyingComets(): Promise<void> {
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
    shieldHeld = false;
    shieldVisible = false;
    updateHud();
  });

  window.addEventListener('resize', () => {
    updateBounds();
    planeX = Math.max(bounds.minX, Math.min(bounds.maxX, planeX));
    planeY = Math.max(bounds.minY, Math.min(bounds.maxY, planeY));
    syncPlane();
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
  setStatus('Arrow keys move. Hold Space for shield.');
}
