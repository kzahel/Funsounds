import { Direction } from './types';
import type { GameState, GameEvent, Renderer, EnemyType } from './types';
import { createGameState, processAction, resolveHops, respawnPlayer, getLevelDef } from './engine';
import { DomRenderer } from './renderer';
import { isMobile, enterFullscreen, setupEscapeHold, setupFullscreenExit, preventContextMenu, spawnConfetti, playCheer } from '../utils';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let gameActive = false;
let state: GameState;
let renderer: Renderer;
let rafId = 0;
let lastEnemyTick = 0;
let currentLevelNum = 1;
let spawnTimers: ReturnType<typeof setTimeout>[] = [];

// DOM refs
let screenEl: HTMLElement;
let containerEl: HTMLElement;
let statusEl: HTMLElement;
let overlayEl: HTMLElement;
let overlayTitleEl: HTMLElement;
let overlayTextEl: HTMLElement;
let restartBtnEl: HTMLElement;

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function startGame(): void {
  screenEl.style.display = '';
  if (isMobile) enterFullscreen();
  document.getElementById('start-screen')!.style.display = 'none';
  currentLevelNum = 1;
  startLevel(currentLevelNum);
}

function startLevel(levelNum: number): void {
  currentLevelNum = levelNum;
  const now = performance.now();
  state = createGameState(levelNum, now);
  lastEnemyTick = now;
  clearSpawnTimers();

  if (renderer) renderer.destroy();
  renderer = new DomRenderer();
  renderer.init(containerEl, state);

  overlayEl.style.display = 'none';
  statusEl.textContent = isMobile ? 'Tap to move' : 'Arrow keys to move';

  scheduleEnemyWaves(now);

  gameActive = true;
  rafId = requestAnimationFrame(gameLoop);
}

function stopGame(): void {
  gameActive = false;
  cancelAnimationFrame(rafId);
  clearSpawnTimers();
  if (renderer) renderer.destroy();

  screenEl.style.display = 'none';
  document.getElementById('start-screen')!.style.display = '';
}

function showOverlay(title: string, text: string, btnText: string, onBtn: () => void): void {
  overlayTitleEl.textContent = title;
  overlayTextEl.textContent = text;
  restartBtnEl.textContent = btnText;
  overlayEl.style.display = '';
  restartBtnEl.onclick = onBtn;
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function gameLoop(now: number): void {
  if (!gameActive) return;

  // Resolve completed hops
  const hopEvents = resolveHops(state, now);
  handleEvents(hopEvents, now);

  // Enemy tick
  if (state.phase === 'playing' && now - lastEnemyTick >= state.level.enemyTickMs) {
    lastEnemyTick = now;
    const events = processAction(state, { type: 'enemy_tick', time: now });
    handleEvents(events, now);
  }

  renderer.render(state, now);
  rafId = requestAnimationFrame(gameLoop);
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function handleEvents(events: GameEvent[], now: number): void {
  for (const e of events) {
    switch (e.type) {
      case 'player_died':
      case 'player_fell':
        statusEl.textContent = 'Oops!';
        clearSpawnTimers();
        setTimeout(() => {
          if (!gameActive) return;
          if (state.phase === 'game_over') {
            showOverlay('Game Over', `Score: ${state.score}`, 'Play Again', () => startGame());
          } else {
            respawnPlayer(state, performance.now());
            scheduleEnemyWaves(performance.now());
            statusEl.textContent = isMobile ? 'Tap to move' : 'Arrow keys to move';
          }
        }, 1500);
        break;

      case 'level_complete':
        statusEl.textContent = 'Level Complete!';
        clearSpawnTimers();
        spawnConfetti(screenEl);
        playCheer();
        setTimeout(() => {
          if (!gameActive) return;
          if (currentLevelNum >= 10) {
            showOverlay('You Win!', `Final Score: ${state.score}`, 'Play Again', () => startGame());
          } else {
            startLevel(currentLevelNum + 1);
          }
        }, 2500);
        break;

      case 'game_over':
        // Handled in player_died timeout
        break;

      case 'coily_lured':
        statusEl.textContent = 'Bye bye snake!';
        setTimeout(() => {
          if (gameActive && state.phase === 'playing') {
            statusEl.textContent = '';
          }
        }, 1500);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Enemy spawn scheduling
// ---------------------------------------------------------------------------

function scheduleEnemyWaves(startTime: number): void {
  for (const wave of state.level.enemyWaves) {
    for (let i = 0; i < wave.count; i++) {
      const delay = wave.spawnAfterMs + i * wave.intervalMs;
      const timer = setTimeout(() => {
        if (!gameActive || state.phase !== 'playing') return;
        const events = processAction(state, {
          type: 'spawn_enemy',
          enemyType: wave.type,
          time: performance.now(),
        });
        handleEvents(events, performance.now());
      }, delay);
      spawnTimers.push(timer);
    }
  }
}

function clearSpawnTimers(): void {
  for (const t of spawnTimers) clearTimeout(t);
  spawnTimers = [];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_MAP: Record<string, Direction> = {
  ArrowUp: Direction.UP_LEFT,
  ArrowRight: Direction.UP_RIGHT,
  ArrowDown: Direction.DOWN_RIGHT,
  ArrowLeft: Direction.DOWN_LEFT,
};

function handleKeyDown(e: KeyboardEvent): void {
  if (!gameActive || e.key === 'Escape') return;
  const dir = KEY_MAP[e.key];
  if (dir !== undefined) {
    e.preventDefault();
    doMove(dir);
  }
}

function handlePointerDown(e: PointerEvent): void {
  if (!gameActive || state.phase !== 'playing') return;
  e.preventDefault();

  const now = performance.now();
  const playerPos = renderer.getPlayerScreenPos(state, now);
  const dx = e.clientX - playerPos.x;
  const dy = e.clientY - playerPos.y;

  // Determine quadrant — the pyramid is isometric so we split along X and Y axes
  // relative to the player. Up = negative Y, Down = positive Y, etc.
  let dir: Direction;
  if (dy < 0) {
    dir = dx < 0 ? Direction.UP_LEFT : Direction.UP_RIGHT;
  } else {
    dir = dx < 0 ? Direction.DOWN_LEFT : Direction.DOWN_RIGHT;
  }

  doMove(dir);
}

function doMove(dir: Direction): void {
  if (state.phase !== 'playing' || state.player.hop || !state.player.alive) return;
  const now = performance.now();
  const events = processAction(state, { type: 'move', direction: dir, time: now });
  handleEvents(events, now);
}

// ---------------------------------------------------------------------------
// Init (called from main.ts)
// ---------------------------------------------------------------------------

export async function initQbert(): Promise<void> {
  screenEl = document.getElementById('qbert-screen')!;
  containerEl = document.getElementById('qb-pyramid-container')!;
  statusEl = document.getElementById('qb-status')!;
  overlayEl = document.getElementById('qb-overlay')!;
  overlayTitleEl = document.getElementById('qb-overlay-title')!;
  overlayTextEl = document.getElementById('qb-overlay-text')!;
  restartBtnEl = document.getElementById('qb-restart-btn')!;

  document.getElementById('qbert-btn')!.addEventListener('click', startGame);

  document.addEventListener('keydown', handleKeyDown, true);
  containerEl.addEventListener('pointerdown', handlePointerDown);

  setupEscapeHold(() => gameActive, stopGame);
  setupFullscreenExit(() => gameActive, stopGame);
  preventContextMenu(() => gameActive);
}
