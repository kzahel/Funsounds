import type { GameState, Renderer, Tool, ToolTab, TrainKind, AnimalKind, TerrainType } from './types';
import { createGameState, processAction, findAnimalNear } from './engine';
import { DomRenderer } from './renderer';
import { isMobile, enterFullscreen, setupEscapeHold, setupFullscreenExit, preventContextMenu } from '../utils';

// ---------------------------------------------------------------------------
// Toolbar definition (data-driven)
// ---------------------------------------------------------------------------

interface ToolButton {
  id: string;
  label: string;
  emoji: string;
  tool: Tool;
}

const TOOLBAR: { tab: ToolTab; label: string; emoji: string; buttons: ToolButton[] }[] = [
  {
    tab: 'tracks',
    label: 'Track',
    emoji: '\u{1F6E4}\uFE0F',
    buttons: [
      { id: 'track', label: 'Track', emoji: '\u{1F6E4}\uFE0F', tool: { kind: 'track' } },
      { id: 'tunnel', label: 'Tunnel', emoji: '\u26F0\uFE0F', tool: { kind: 'tunnel' } },
      { id: 'bridge', label: 'Bridge', emoji: '\u{1F309}', tool: { kind: 'bridge' } },
    ],
  },
  {
    tab: 'terrain',
    label: 'Land',
    emoji: '\u{1F33F}',
    buttons: [
      { id: 'grass', label: 'Grass', emoji: '\u{1F33F}', tool: { kind: 'terrain', terrain: 'grass' as TerrainType } },
      { id: 'water', label: 'Water', emoji: '\u{1F30A}', tool: { kind: 'terrain', terrain: 'water' as TerrainType } },
    ],
  },
  {
    tab: 'trains',
    label: 'Trains',
    emoji: '\u{1F682}',
    buttons: [
      { id: 'steam-3', label: 'Steam', emoji: '\u{1F682}', tool: { kind: 'train', train: 'steam', length: 3 } },
      { id: 'diesel-4', label: 'Diesel', emoji: '\u{1F683}', tool: { kind: 'train', train: 'diesel', length: 4 } },
      { id: 'electric-2', label: 'Electric', emoji: '\u{1F686}', tool: { kind: 'train', train: 'electric', length: 2 } },
      { id: 'monorail-1', label: 'Monorail', emoji: '\u{1F69D}', tool: { kind: 'train', train: 'monorail', length: 1 } },
    ],
  },
  {
    tab: 'animals',
    label: 'Animals',
    emoji: '\u{1F404}',
    buttons: [
      { id: 'cow', label: 'Cow', emoji: '\u{1F404}', tool: { kind: 'animal', animal: 'cow' } },
      { id: 'sheep', label: 'Sheep', emoji: '\u{1F411}', tool: { kind: 'animal', animal: 'sheep' } },
      { id: 'pig', label: 'Pig', emoji: '\u{1F416}', tool: { kind: 'animal', animal: 'pig' } },
      { id: 'horse', label: 'Horse', emoji: '\u{1F40E}', tool: { kind: 'animal', animal: 'horse' } },
      { id: 'chicken', label: 'Chicken', emoji: '\u{1F414}', tool: { kind: 'animal', animal: 'chicken' } },
      { id: 'dog', label: 'Dog', emoji: '\u{1F415}', tool: { kind: 'animal', animal: 'dog' } },
      { id: 'duck', label: 'Duck', emoji: '\u{1F986}', tool: { kind: 'animal', animal: 'duck' } },
      { id: 'rabbit', label: 'Rabbit', emoji: '\u{1F407}', tool: { kind: 'animal', animal: 'rabbit' } },
      { id: 'pigeon', label: 'Pigeon', emoji: '\u{1F54A}\uFE0F', tool: { kind: 'animal', animal: 'pigeon' } },
    ],
  },
  {
    tab: 'tools',
    label: 'Tools',
    emoji: '\u{1F9F9}',
    buttons: [
      { id: 'drag', label: 'Grab', emoji: '\u270B', tool: { kind: 'drag' } },
      { id: 'erase', label: 'Erase', emoji: '\u{1F9F9}', tool: { kind: 'erase' } },
    ],
  },
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let gameActive = false;
let state: GameState;
let renderer: Renderer;
let rafId = 0;
let lastFrame = 0;

let screenEl: HTMLElement;
let containerEl: HTMLElement;
let toolbarEl: HTMLElement;
let tabsEl: HTMLElement;
let buttonsEl: HTMLElement;
let clearBtnEl: HTMLElement;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startGame(): void {
  screenEl.style.display = 'block';
  if (isMobile) enterFullscreen();
  document.getElementById('start-screen')!.style.display = 'none';

  state = createGameState();
  if (renderer) renderer.destroy();
  renderer = new DomRenderer();
  renderer.init(containerEl, state);

  buildToolbar();
  selectToolButton(TOOLBAR[0].tab, TOOLBAR[0].buttons[0]);

  gameActive = true;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(gameLoop);
}

function stopGame(): void {
  gameActive = false;
  cancelAnimationFrame(rafId);
  if (renderer) renderer.destroy();
  screenEl.style.display = 'none';
  document.getElementById('start-screen')!.style.display = 'block';
}

function gameLoop(now: number): void {
  if (!gameActive) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  processAction(state, { type: 'tick', dt, time: now });
  renderer.render(state, now);
  rafId = requestAnimationFrame(gameLoop);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function buildToolbar(): void {
  tabsEl.innerHTML = '';
  buttonsEl.innerHTML = '';

  for (const group of TOOLBAR) {
    const tab = document.createElement('button');
    tab.className = 'tg-tab';
    tab.dataset.tab = group.tab;
    tab.textContent = `${group.emoji} ${group.label}`;
    tab.addEventListener('click', () => {
      // Switch to first button in this tab
      selectToolButton(group.tab, group.buttons[0]);
    });
    tabsEl.appendChild(tab);
  }
}

function renderTabButtons(activeTab: ToolTab): void {
  for (const child of Array.from(tabsEl.children) as HTMLElement[]) {
    child.classList.toggle('tg-tab-active', child.dataset.tab === activeTab);
  }
  const group = TOOLBAR.find((g) => g.tab === activeTab)!;
  buttonsEl.innerHTML = '';
  for (const btn of group.buttons) {
    const el = document.createElement('button');
    el.className = 'tg-tool';
    el.dataset.toolId = btn.id;
    el.innerHTML = `<span class="tg-tool-emoji">${btn.emoji}</span><span class="tg-tool-label">${btn.label}</span>`;
    el.addEventListener('click', () => selectToolButton(activeTab, btn));
    buttonsEl.appendChild(el);
  }
  highlightSelectedButton();
}

function selectToolButton(tab: ToolTab, btn: ToolButton): void {
  processAction(state, { type: 'select_tool', tool: btn.tool, tab });
  renderTabButtons(tab);
}

function highlightSelectedButton(): void {
  // Highlight whichever button matches the current selectedTool
  for (const el of Array.from(buttonsEl.children) as HTMLElement[]) {
    const id = el.dataset.toolId!;
    const group = TOOLBAR.find((g) => g.tab === state.selectedTab)!;
    const btn = group.buttons.find((b) => b.id === id);
    el.classList.toggle('tg-tool-active', btn?.tool === state.selectedTool);
  }
}

// ---------------------------------------------------------------------------
// Input — placement
// ---------------------------------------------------------------------------

let dragging = false;
let lastPlaced = { row: -1, col: -1 };

// Drag-tool state for grabbing animals
let grabbedId: number | null = null;
let grabStartedPerched = false;
let grabMaxDistance = 0; // tiles travelled while grabbing
let grabLastTile = { x: 0, y: 0 };

function placeAtPointer(clientX: number, clientY: number): void {
  const tile = renderer.screenToTile(clientX, clientY);
  if (!tile) return;
  if (tile.row === lastPlaced.row && tile.col === lastPlaced.col) return;
  lastPlaced = tile;

  const tool = state.selectedTool;
  if (tool.kind === 'erase') {
    processAction(state, { type: 'erase', row: tile.row, col: tile.col });
  } else {
    processAction(state, { type: 'place', row: tile.row, col: tile.col, tool, time: performance.now() });
  }
}

/** Convert a screen point to fractional tile-space (col, row). */
function pointerToTileSpace(clientX: number, clientY: number): { x: number; y: number } | null {
  return renderer.screenToTileSpace(clientX, clientY);
}

function handlePointerDown(e: PointerEvent): void {
  if (!gameActive) return;
  // Don't intercept the toolbar
  if ((e.target as HTMLElement).closest('#tg-toolbar')) return;
  e.preventDefault();
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

  const tool = state.selectedTool;

  if (tool.kind === 'drag') {
    const pos = pointerToTileSpace(e.clientX, e.clientY);
    if (!pos) return;
    const a = findAnimalNear(state, pos.x, pos.y, 1.0);
    if (!a) return;
    grabbedId = a.id;
    grabStartedPerched = a.perched;
    grabMaxDistance = 0;
    grabLastTile = { x: a.x, y: a.y };
    // Free the animal so it can be moved interactively
    processAction(state, { type: 'set_animal_perched', id: a.id, perched: false });
    processAction(state, { type: 'move_animal', id: a.id, x: pos.x, y: pos.y });
    return;
  }

  dragging = true;
  lastPlaced = { row: -1, col: -1 };
  // For trains/animals, single tap should not flood — but for tracks/terrain dragging is fine.
  const oneShot = tool.kind === 'train' || tool.kind === 'animal';
  placeAtPointer(e.clientX, e.clientY);
  if (oneShot) dragging = false;
}

function handlePointerMove(e: PointerEvent): void {
  if (grabbedId !== null) {
    e.preventDefault();
    const pos = pointerToTileSpace(e.clientX, e.clientY);
    if (!pos) return;
    const dx = pos.x - grabLastTile.x;
    const dy = pos.y - grabLastTile.y;
    grabMaxDistance += Math.sqrt(dx * dx + dy * dy);
    grabLastTile = pos;
    processAction(state, { type: 'move_animal', id: grabbedId, x: pos.x, y: pos.y });
    return;
  }
  if (!dragging) return;
  e.preventDefault();
  placeAtPointer(e.clientX, e.clientY);
}

function handlePointerUp(_e: PointerEvent): void {
  if (grabbedId !== null) {
    const tap = grabMaxDistance < 0.3;
    const shouldPerch = !(tap && grabStartedPerched);
    processAction(state, { type: 'set_animal_perched', id: grabbedId, perched: shouldPerch });
    grabbedId = null;
  }
  dragging = false;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function initTrain(): Promise<void> {
  screenEl = document.getElementById('train-screen')!;
  containerEl = document.getElementById('tg-grid-container')!;
  toolbarEl = document.getElementById('tg-toolbar')!;
  tabsEl = document.getElementById('tg-tabs')!;
  buttonsEl = document.getElementById('tg-buttons')!;
  clearBtnEl = document.getElementById('tg-clear-btn')!;

  document.getElementById('train-btn')!.addEventListener('click', startGame);

  containerEl.addEventListener('pointerdown', handlePointerDown);
  containerEl.addEventListener('pointermove', handlePointerMove);
  containerEl.addEventListener('pointerup', handlePointerUp);
  containerEl.addEventListener('pointercancel', handlePointerUp);

  clearBtnEl.addEventListener('click', () => {
    if (!gameActive) return;
    processAction(state, { type: 'clear_all' });
    if (renderer) {
      renderer.destroy();
      renderer = new DomRenderer();
      renderer.init(containerEl, state);
    }
  });

  setupEscapeHold(() => gameActive, stopGame);
  setupFullscreenExit(() => gameActive, stopGame);
  preventContextMenu(() => gameActive);

  // Suppress unused-import warning for toolbarEl reference (we touch it via DOM in buildToolbar)
  void toolbarEl;
}
