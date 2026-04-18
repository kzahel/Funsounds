import type { GameState, Renderer, Tool, ToolTab, Facing, CropKind } from './types';
import { CROP_PRICE, COST_CAT, COST_SCARECROW, costToExpand } from './types';
import { createGameState, processAction } from './engine';
import { DomRenderer } from './renderer';
import { isMobile, enterFullscreen, setupEscapeHold, setupFullscreenExit, preventContextMenu } from '../utils';

// ---------------------------------------------------------------------------
// Toolbar definition
// ---------------------------------------------------------------------------

interface ToolButton {
  id: string;
  label: string;
  emoji: string;
  tool: Tool;
  /** Computed on each render — shown as a badge under the label. */
  priceLabel?: (state: GameState) => string;
  /** When returns true, the button is visually disabled. */
  disabled?: (state: GameState) => boolean;
}

const TOOLBAR: { tab: ToolTab; label: string; emoji: string; buttons: ToolButton[] }[] = [
  {
    tab: 'farm',
    label: 'Farm',
    emoji: '\u{1F33E}',
    buttons: [
      { id: 'till', label: 'Till', emoji: '\u{1FA93}', tool: { kind: 'till' } },
      { id: 'water', label: 'Water', emoji: '\u{1F4A7}', tool: { kind: 'water' } },
      { id: 'pick', label: 'Pick', emoji: '\u{1F9FA}', tool: { kind: 'pick' } },
    ],
  },
  {
    tab: 'seeds',
    label: 'Seeds',
    emoji: '\u{1F331}',
    buttons: [
      { id: 'seed-carrot', label: 'Carrot', emoji: '\u{1F955}', tool: { kind: 'seed', crop: 'carrot' } },
      { id: 'seed-tomato', label: 'Tomato', emoji: '\u{1F345}', tool: { kind: 'seed', crop: 'tomato' } },
      { id: 'seed-corn', label: 'Corn', emoji: '\u{1F33D}', tool: { kind: 'seed', crop: 'corn' } },
      { id: 'seed-pumpkin', label: 'Pumpkin', emoji: '\u{1F383}', tool: { kind: 'seed', crop: 'pumpkin' } },
    ],
  },
  {
    tab: 'defense',
    label: 'Defense',
    emoji: '\u{1F408}',
    buttons: [
      {
        id: 'place-cat', label: 'Cat', emoji: '\u{1F408}', tool: { kind: 'place_cat' },
        priceLabel: (s) => s.pendingCats > 0 ? `x${s.pendingCats}` : 'Buy in Shop',
        disabled: (s) => s.pendingCats <= 0,
      },
      {
        id: 'place-scarecrow', label: 'Scarecrow', emoji: '\u{1F383}', tool: { kind: 'place_scarecrow' },
        priceLabel: (s) => s.pendingScarecrows > 0 ? `x${s.pendingScarecrows}` : 'Buy in Shop',
        disabled: (s) => s.pendingScarecrows <= 0,
      },
    ],
  },
  {
    tab: 'shop',
    label: 'Shop',
    emoji: '\u{1F3EA}',
    buttons: [
      {
        id: 'buy-cat', label: 'Cat', emoji: '\u{1F408}', tool: { kind: 'buy_cat' },
        priceLabel: () => `$${COST_CAT}`,
        disabled: (s) => s.money < COST_CAT,
      },
      {
        id: 'buy-scarecrow', label: 'Scarecrow', emoji: '\u{1F383}', tool: { kind: 'buy_scarecrow' },
        priceLabel: () => `$${COST_SCARECROW}`,
        disabled: (s) => s.money < COST_SCARECROW,
      },
      {
        id: 'buy-expand', label: 'Expand', emoji: '\u{1F331}', tool: { kind: 'buy_expand' },
        priceLabel: (s) => `$${costToExpand(s.arableRadius)}`,
        disabled: (s) => s.money < costToExpand(s.arableRadius),
      },
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
let tabsEl: HTMLElement;
let buttonsEl: HTMLElement;
let hudMoneyEl: HTMLElement;
let hudInventoryEl: HTMLElement;
let hudRainEl: HTMLElement;
let hudHintEl: HTMLElement;
let resetBtnEl: HTMLElement;

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
  // Clear movement keys so they don't persist across sessions
  if (state) {
    state.player.moving = { up: false, down: false, left: false, right: false };
  }
}

function gameLoop(now: number): void {
  if (!gameActive) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  processAction(state, { type: 'tick', dt });
  renderer.render(state, now);
  updateHUD();
  rafId = requestAnimationFrame(gameLoop);
}

function updateHUD(): void {
  hudMoneyEl.textContent = `\u{1F4B0} $${state.money}`;
  const inv = state.inventory;
  const total = inv.carrot + inv.tomato + inv.corn + inv.pumpkin;
  const parts: string[] = [];
  if (inv.carrot) parts.push(`\u{1F955}${inv.carrot}`);
  if (inv.tomato) parts.push(`\u{1F345}${inv.tomato}`);
  if (inv.corn) parts.push(`\u{1F33D}${inv.corn}`);
  if (inv.pumpkin) parts.push(`\u{1F383}${inv.pumpkin}`);
  if (total === 0) {
    hudInventoryEl.textContent = 'Basket empty';
    hudInventoryEl.classList.remove('fg-hud-ready');
  } else {
    const value = sellValue(state.inventory);
    hudInventoryEl.textContent = `${parts.join(' ')}  \u2192 $${value}`;
    hudInventoryEl.classList.add('fg-hud-ready');
  }
  const raining = state.time < state.rainUntil;
  hudRainEl.style.display = raining ? 'inline-block' : 'none';
  // Update tool button states / badges reactively
  refreshToolBadges();
}

function sellValue(inv: GameState['inventory']): number {
  let total = 0;
  for (const k of Object.keys(inv) as CropKind[]) total += inv[k] * CROP_PRICE[k];
  return total;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function buildToolbar(): void {
  tabsEl.innerHTML = '';
  buttonsEl.innerHTML = '';
  for (const group of TOOLBAR) {
    const tab = document.createElement('button');
    tab.className = 'fg-tab';
    tab.dataset.tab = group.tab;
    tab.textContent = `${group.emoji} ${group.label}`;
    tab.addEventListener('click', () => {
      selectToolButton(group.tab, group.buttons[0]);
    });
    tabsEl.appendChild(tab);
  }
}

function renderTabButtons(activeTab: ToolTab): void {
  for (const child of Array.from(tabsEl.children) as HTMLElement[]) {
    child.classList.toggle('fg-tab-active', child.dataset.tab === activeTab);
  }
  const group = TOOLBAR.find((g) => g.tab === activeTab)!;
  buttonsEl.innerHTML = '';
  for (const btn of group.buttons) {
    const el = document.createElement('button');
    el.className = 'fg-tool';
    el.dataset.toolId = btn.id;
    const priceLabel = btn.priceLabel ? btn.priceLabel(state) : '';
    el.innerHTML = `
      <span class="fg-tool-emoji">${btn.emoji}</span>
      <span class="fg-tool-label">${btn.label}</span>
      ${priceLabel ? `<span class="fg-tool-price">${priceLabel}</span>` : ''}
    `;
    el.addEventListener('click', () => {
      // Shop/buy actions process immediately rather than as placements
      if (btn.tool.kind === 'buy_cat' || btn.tool.kind === 'buy_scarecrow' || btn.tool.kind === 'buy_expand') {
        processAction(state, { type: 'place', row: 0, col: 0, tool: btn.tool });
        // Re-render buttons because tab/tool may have been switched by engine
        renderTabButtons(state.selectedTab);
        return;
      }
      selectToolButton(activeTab, btn);
    });
    buttonsEl.appendChild(el);
  }
  highlightSelectedButton();
  refreshToolBadges();
}

function selectToolButton(tab: ToolTab, btn: ToolButton): void {
  processAction(state, { type: 'select_tool', tool: btn.tool, tab });
  renderTabButtons(tab);
}

function highlightSelectedButton(): void {
  for (const el of Array.from(buttonsEl.children) as HTMLElement[]) {
    const id = el.dataset.toolId!;
    const group = TOOLBAR.find((g) => g.tab === state.selectedTab)!;
    const btn = group.buttons.find((b) => b.id === id);
    el.classList.toggle('fg-tool-active', !!btn && btn.tool === state.selectedTool);
  }
}

function refreshToolBadges(): void {
  for (const el of Array.from(buttonsEl.children) as HTMLElement[]) {
    const id = el.dataset.toolId!;
    const group = TOOLBAR.find((g) => g.tab === state.selectedTab)!;
    const btn = group.buttons.find((b) => b.id === id);
    if (!btn) continue;
    const disabled = btn.disabled ? btn.disabled(state) : false;
    el.classList.toggle('fg-tool-disabled', disabled);
    const priceEl = el.querySelector('.fg-tool-price');
    if (priceEl && btn.priceLabel) priceEl.textContent = btn.priceLabel(state);
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function handlePointerDown(e: PointerEvent): void {
  if (!gameActive) return;
  if ((e.target as HTMLElement).closest('#fg-toolbar')) return;
  if ((e.target as HTMLElement).closest('#fg-hud')) return;
  e.preventDefault();
  placeAtPointer(e.clientX, e.clientY);
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}

function placeAtPointer(clientX: number, clientY: number): void {
  const tile = renderer.screenToTile(clientX, clientY);
  if (!tile) return;
  const tool = state.selectedTool;
  // Shop actions shouldn't be triggered by tile taps — they're button-only
  if (tool.kind === 'buy_cat' || tool.kind === 'buy_scarecrow' || tool.kind === 'buy_expand') return;
  processAction(state, { type: 'place', row: tile.row, col: tile.col, tool });
}

function dirFromKey(k: string): Facing | null {
  switch (k) {
    case 'ArrowUp': case 'w': case 'W': return 'up';
    case 'ArrowDown': case 's': case 'S': return 'down';
    case 'ArrowLeft': case 'a': case 'A': return 'left';
    case 'ArrowRight': case 'd': case 'D': return 'right';
  }
  return null;
}

function handleKeyDown(e: KeyboardEvent): void {
  if (!gameActive) return;
  const dir = dirFromKey(e.key);
  if (!dir) return;
  e.preventDefault();
  processAction(state, { type: 'set_player_moving', dir, moving: true });
}

function handleKeyUp(e: KeyboardEvent): void {
  if (!gameActive) return;
  const dir = dirFromKey(e.key);
  if (!dir) return;
  processAction(state, { type: 'set_player_moving', dir, moving: false });
}

// Touch d-pad
function bindTouchPad(): void {
  const pad = document.getElementById('fg-touchpad');
  if (!pad) return;
  const setDir = (dir: Facing, moving: boolean): void => {
    if (!gameActive) return;
    processAction(state, { type: 'set_player_moving', dir, moving });
  };
  const btns = pad.querySelectorAll<HTMLElement>('[data-fg-dir]');
  btns.forEach((btn) => {
    const dir = btn.dataset.fgDir as Facing;
    const start = (e: Event): void => { e.preventDefault(); setDir(dir, true); };
    const end = (e: Event): void => { e.preventDefault(); setDir(dir, false); };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('pointerleave', end);
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function initFarm(): Promise<void> {
  screenEl = document.getElementById('farm-screen')!;
  containerEl = document.getElementById('fg-grid-container')!;
  tabsEl = document.getElementById('fg-tabs')!;
  buttonsEl = document.getElementById('fg-buttons')!;
  hudMoneyEl = document.getElementById('fg-hud-money')!;
  hudInventoryEl = document.getElementById('fg-hud-inventory')!;
  hudRainEl = document.getElementById('fg-hud-rain')!;
  hudHintEl = document.getElementById('fg-hint')!;
  resetBtnEl = document.getElementById('fg-reset-btn')!;

  document.getElementById('farm-btn')!.addEventListener('click', startGame);

  containerEl.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  bindTouchPad();

  resetBtnEl.addEventListener('click', () => {
    if (!gameActive) return;
    processAction(state, { type: 'reset' });
    if (renderer) {
      renderer.destroy();
      renderer = new DomRenderer();
      renderer.init(containerEl, state);
    }
    renderTabButtons(state.selectedTab);
  });

  setupEscapeHold(() => gameActive, stopGame);
  setupFullscreenExit(() => gameActive, stopGame);
  preventContextMenu(() => gameActive);

  void hudHintEl; // held as DOM reference but not mutated from here
}
