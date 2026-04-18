import type { GameState, Renderer, Tool, ToolTab, Facing, CropKind, Season, SavePayload } from './types';
import {
  CROP_PRICE,
  COST_CAT,
  COST_SCARECROW,
  COST_BEEHIVE,
  COST_FENCE,
  COST_BOOTS,
  SAVE_SLOT_COUNT,
  SAVE_VERSION,
  SELL_PRICE,
  costToExpand,
  seasonSellMultiplier,
  seasonShopMultiplier,
  toolsEqual,
} from './types';
import { createGameState, processAction, currentSeason, seasonTimeRemaining, cloneState, sellValue } from './engine';
import { DomRenderer, SEASON_EMOJI } from './renderer';
import { isMobile, enterFullscreen, setupEscapeHold, setupFullscreenExit, preventContextMenu } from '../utils';

// ---------------------------------------------------------------------------
// Toolbar definition
// ---------------------------------------------------------------------------

interface ToolButton {
  id: string;
  label: string;
  emoji: string;
  tool: Tool;
  priceLabel?: (state: GameState) => string;
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
      { id: 'seed-strawberry', label: 'Strawberry', emoji: '\u{1F353}', tool: { kind: 'seed', crop: 'strawberry' } },
      { id: 'seed-potato', label: 'Potato', emoji: '\u{1F954}', tool: { kind: 'seed', crop: 'potato' } },
      { id: 'seed-watermelon', label: 'Watermelon', emoji: '\u{1F349}', tool: { kind: 'seed', crop: 'watermelon' } },
      { id: 'seed-apple', label: 'Apple', emoji: '\u{1F333}', tool: { kind: 'seed', crop: 'apple' } },
      { id: 'seed-turnip', label: 'Turnip', emoji: '\u{1FADA}', tool: { kind: 'seed', crop: 'turnip' } },
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
      {
        id: 'place-beehive', label: 'Beehive', emoji: '\u{1F36F}', tool: { kind: 'place_beehive' },
        priceLabel: (s) => s.pendingBeehives > 0 ? `x${s.pendingBeehives}` : 'Buy in Shop',
        disabled: (s) => s.pendingBeehives <= 0,
      },
      {
        id: 'place-fence', label: 'Fence', emoji: '\u{1FAB5}', tool: { kind: 'place_fence' },
        priceLabel: (s) => s.pendingFences > 0 ? `x${s.pendingFences}` : 'Buy in Shop',
        disabled: (s) => s.pendingFences <= 0,
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
        priceLabel: (s) => `$${seasonCost(s, COST_CAT)}`,
        disabled: (s) => s.money < seasonCost(s, COST_CAT),
      },
      {
        id: 'buy-scarecrow', label: 'Scarecrow', emoji: '\u{1F383}', tool: { kind: 'buy_scarecrow' },
        priceLabel: (s) => `$${seasonCost(s, COST_SCARECROW)}`,
        disabled: (s) => s.money < seasonCost(s, COST_SCARECROW),
      },
      {
        id: 'buy-beehive', label: 'Beehive', emoji: '\u{1F36F}', tool: { kind: 'buy_beehive' },
        priceLabel: (s) => `$${seasonCost(s, COST_BEEHIVE)}`,
        disabled: (s) => s.money < seasonCost(s, COST_BEEHIVE),
      },
      {
        id: 'buy-fence', label: 'Fence', emoji: '\u{1FAB5}', tool: { kind: 'buy_fence' },
        priceLabel: (s) => `$${seasonCost(s, COST_FENCE)}`,
        disabled: (s) => s.money < seasonCost(s, COST_FENCE),
      },
      {
        id: 'buy-boots', label: 'Boots', emoji: '\u{1F462}', tool: { kind: 'buy_boots' },
        priceLabel: (s) => s.hasBoots ? 'Owned' : `$${seasonCost(s, COST_BOOTS)}`,
        disabled: (s) => s.hasBoots || s.money < seasonCost(s, COST_BOOTS),
      },
      {
        id: 'buy-expand', label: 'Expand', emoji: '\u{1F331}', tool: { kind: 'buy_expand' },
        priceLabel: (s) => `$${seasonCost(s, costToExpand(s.arableRadius))}`,
        disabled: (s) => s.money < seasonCost(s, costToExpand(s.arableRadius)),
      },
    ],
  },
];

function seasonCost(state: GameState, baseCost: number): number {
  return Math.round(baseCost * seasonShopMultiplier(currentSeason(state.time)));
}

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
let hudSeasonEl: HTMLElement;
let hudHintEl: HTMLElement;
let menuBtnEl: HTMLElement;
let menuOverlayEl: HTMLElement;
let menuSaveRowsEl: HTMLElement;
let menuLoadRowsEl: HTMLElement;
let menuResumeBtnEl: HTMLElement;
let menuResetBtnEl: HTMLElement;
let menuQuitBtnEl: HTMLElement;

// ---------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------

const slotKey = (slot: number): string => `funsounds-farm-slot-${slot}`;

interface SlotMeta {
  savedAt: string;
  money: number;
  season: Season;
  year: number;
}

function readSlot(slot: number): SavePayload | null {
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (!raw) return null;
    const payload = JSON.parse(raw) as SavePayload;
    if (!payload || payload.version !== SAVE_VERSION || !payload.state) return null;
    return payload;
  } catch {
    return null;
  }
}

function slotMeta(slot: number): SlotMeta | null {
  const p = readSlot(slot);
  if (!p) return null;
  const t = p.state.time;
  return {
    savedAt: p.savedAt,
    money: p.state.money,
    season: currentSeason(t),
    year: Math.floor(t / (180 * 4)) + 1, // SEASON_DURATION * 4
  };
}

function writeSlot(slot: number, st: GameState): void {
  const payload: SavePayload = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    state: cloneState(st),
  };
  localStorage.setItem(slotKey(slot), JSON.stringify(payload));
}

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

  closeMenu();
  gameActive = true;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(gameLoop);
}

function stopGame(): void {
  gameActive = false;
  cancelAnimationFrame(rafId);
  if (renderer) renderer.destroy();
  closeMenu();
  screenEl.style.display = 'none';
  document.getElementById('start-screen')!.style.display = 'block';
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
  const parts: string[] = [];
  const pushIf = (qty: number, emoji: string): void => { if (qty) parts.push(`${emoji}${qty}`); };
  pushIf(inv.carrot, '\u{1F955}');
  pushIf(inv.tomato, '\u{1F345}');
  pushIf(inv.corn, '\u{1F33D}');
  pushIf(inv.pumpkin, '\u{1F383}');
  pushIf(inv.strawberry, '\u{1F353}');
  pushIf(inv.potato, '\u{1F954}');
  pushIf(inv.watermelon, '\u{1F349}');
  pushIf(inv.apple, '\u{1F34E}');
  pushIf(inv.turnip, '\u{1FADA}');
  pushIf(inv.honey, '\u{1F36F}');
  const total = parts.length;
  if (total === 0) {
    hudInventoryEl.textContent = 'Basket empty';
    hudInventoryEl.classList.remove('fg-hud-ready');
  } else {
    hudInventoryEl.textContent = `${parts.join(' ')}  \u2192 $${sellValue(state)}`;
    hudInventoryEl.classList.add('fg-hud-ready');
  }
  const raining = state.time < state.rainUntil;
  hudRainEl.style.display = raining ? 'inline-block' : 'none';
  const season = currentSeason(state.time);
  const remain = Math.ceil(seasonTimeRemaining(state.time));
  hudSeasonEl.textContent = `${SEASON_EMOJI[season]} ${season[0].toUpperCase() + season.slice(1)} · ${remain}s`;
  refreshToolBadges();
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
      const k = btn.tool.kind;
      if (k === 'buy_cat' || k === 'buy_scarecrow' || k === 'buy_beehive'
          || k === 'buy_fence' || k === 'buy_boots' || k === 'buy_expand') {
        processAction(state, { type: 'place', row: 0, col: 0, tool: btn.tool });
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
    el.classList.toggle('fg-tool-active', !!btn && toolsEqual(btn.tool, state.selectedTool));
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
  if ((e.target as HTMLElement).closest('#fg-menu')) return;
  if (state.paused) return;
  e.preventDefault();
  placeAtPointer(e.clientX, e.clientY);
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}

function placeAtPointer(clientX: number, clientY: number): void {
  const tile = renderer.screenToTile(clientX, clientY);
  if (!tile) return;
  const tool = state.selectedTool;
  const k = tool.kind;
  if (k === 'buy_cat' || k === 'buy_scarecrow' || k === 'buy_beehive'
      || k === 'buy_fence' || k === 'buy_boots' || k === 'buy_expand') return;
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
  if (state.paused) return;
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

function bindTouchPad(): void {
  const pad = document.getElementById('fg-touchpad');
  if (!pad) return;
  const setDir = (dir: Facing, moving: boolean): void => {
    if (!gameActive || state.paused) return;
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
// Menu (pause + save/load)
// ---------------------------------------------------------------------------

function openMenu(): void {
  menuOverlayEl.style.display = 'flex';
  processAction(state, { type: 'set_paused', paused: true });
  // Release any held movement keys
  state.player.moving = { up: false, down: false, left: false, right: false };
  rebuildMenuRows();
}

function closeMenu(): void {
  if (menuOverlayEl) menuOverlayEl.style.display = 'none';
  if (state) processAction(state, { type: 'set_paused', paused: false });
}

function formatWhen(iso: string): string {
  const t = new Date(iso);
  const now = Date.now();
  const diffMs = now - t.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return t.toLocaleDateString();
}

function rebuildMenuRows(): void {
  menuSaveRowsEl.innerHTML = '';
  menuLoadRowsEl.innerHTML = '';
  for (let i = 1; i <= SAVE_SLOT_COUNT; i++) {
    const meta = slotMeta(i);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'fg-menu-slot-btn';
    const saveLabel = meta
      ? `Slot ${i} · Year ${meta.year} ${meta.season} · $${meta.money} · ${formatWhen(meta.savedAt)}`
      : `Slot ${i} · Empty`;
    saveBtn.textContent = `Save to ${saveLabel}`;
    saveBtn.addEventListener('click', () => {
      writeSlot(i, state);
      rebuildMenuRows();
    });
    menuSaveRowsEl.appendChild(saveBtn);

    const loadBtn = document.createElement('button');
    loadBtn.className = 'fg-menu-slot-btn';
    loadBtn.textContent = `Load ${saveLabel}`;
    if (!meta) {
      loadBtn.classList.add('fg-menu-slot-disabled');
      loadBtn.disabled = true;
    } else {
      loadBtn.addEventListener('click', () => loadSlot(i));
    }
    menuLoadRowsEl.appendChild(loadBtn);
  }
}

function loadSlot(slot: number): void {
  const payload = readSlot(slot);
  if (!payload) return;
  processAction(state, { type: 'load_state', state: payload.state });
  // The renderer was built for the old state; rebuild so tile DOM matches.
  renderer.rebuild(state);
  renderTabButtons(state.selectedTab);
  closeMenu();
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
  hudSeasonEl = document.getElementById('fg-hud-season')!;
  hudHintEl = document.getElementById('fg-hint')!;
  menuBtnEl = document.getElementById('fg-menu-btn')!;
  menuOverlayEl = document.getElementById('fg-menu')!;
  menuSaveRowsEl = document.getElementById('fg-menu-save-rows')!;
  menuLoadRowsEl = document.getElementById('fg-menu-load-rows')!;
  menuResumeBtnEl = document.getElementById('fg-menu-resume')!;
  menuResetBtnEl = document.getElementById('fg-menu-reset')!;
  menuQuitBtnEl = document.getElementById('fg-menu-quit')!;

  document.getElementById('farm-btn')!.addEventListener('click', startGame);

  containerEl.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  bindTouchPad();

  menuBtnEl.addEventListener('click', () => {
    if (!gameActive) return;
    if (menuOverlayEl.style.display === 'flex') closeMenu();
    else openMenu();
  });
  menuResumeBtnEl.addEventListener('click', closeMenu);
  menuResetBtnEl.addEventListener('click', () => {
    processAction(state, { type: 'reset' });
    renderer.rebuild(state);
    renderTabButtons(state.selectedTab);
    closeMenu();
  });
  menuQuitBtnEl.addEventListener('click', stopGame);

  setupEscapeHold(() => gameActive, stopGame);
  setupFullscreenExit(() => gameActive, stopGame);
  preventContextMenu(() => gameActive);

  void hudHintEl;
  void SELL_PRICE;
  void seasonSellMultiplier;
  void CROP_PRICE;
}
