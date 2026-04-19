import { isRaining, isArable, currentSeason } from './engine';
import type {
  GameState,
  Renderer,
  Pest,
  CropKind,
  PestKind,
  Player,
  Season,
} from './types';

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

const TILE_BG: Record<string, string> = {
  grass: '#62a83d',
  tilled: '#8c5a2a',
  wet_tilled: '#4a321a',
  apple_tree: '#2f6f2a',
};

const CROP_EMOJI: Record<CropKind, string> = {
  carrot: '\u{1F955}',
  tomato: '\u{1F345}',
  corn: '\u{1F33D}',
  pumpkin: '\u{1F383}',
  strawberry: '\u{1F353}',
  potato: '\u{1F954}',
  watermelon: '\u{1F349}',
  apple: '\u{1F34E}',
  turnip: '\u{1FADA}', // onion/turnip stand-in
  sunflower: '\u{1F33B}',
};

const PEST_EMOJI: Record<PestKind, string> = {
  rabbit: '\u{1F407}',
  bird: '\u{1F426}',
};

const PLAYER_EMOJI = '\u{1F9D1}\u200D\u{1F33E}';
const MARKET_EMOJI = '\u{1F3EA}';
const RAIN_EMOJI = '\u{1F4A7}';
const SNOW_EMOJI = '\u2744\uFE0F';
const CAT_EMOJI = '\u{1F408}';
const BEEHIVE_EMOJI = '\u{1F36F}';
const FENCE_EMOJI = '\u{1FAB5}'; // wood emoji as fence stand-in
const APPLE_TREE_EMOJI = '\u{1F333}';

const SEASON_EMOJI: Record<Season, string> = {
  spring: '\u{1F338}',
  summer: '\u{2600}\uFE0F',
  fall: '\u{1F342}',
  winter: '\u2744\uFE0F',
};

// ---------------------------------------------------------------------------
// DomRenderer
// ---------------------------------------------------------------------------

export class DomRenderer implements Renderer {
  private container!: HTMLElement;
  private gridEl!: HTMLElement;
  private pestLayer!: HTMLElement;
  private defenseLayer!: HTMLElement;
  private playerLayer!: HTMLElement;
  private rainLayer!: HTMLElement;
  private snowLayer!: HTMLElement;

  private tileEls: HTMLElement[] = [];
  private cropEls: (HTMLElement | null)[] = [];
  private fenceEls: (HTMLElement | null)[] = [];
  private treeEls: (HTMLElement | null)[] = [];
  private pestEls: Map<number, HTMLElement> = new Map();
  private defenseEls: Map<number, HTMLElement> = new Map();
  private playerEl!: HTMLElement;

  private size = { rows: 0, cols: 0 };
  private tilePx = 60;

  init(container: HTMLElement, state: GameState): void {
    this.container = container;
    this.container.innerHTML = '';
    this.size = state.size;

    this.gridEl = document.createElement('div');
    this.gridEl.id = 'fg-grid';
    this.gridEl.style.cssText = `
      position:relative; touch-action:none; user-select:none;
      width:100%; height:100%;
      background:#2b6a1d;
    `;
    this.container.appendChild(this.gridEl);

    this.computeTileSize();
    this.buildTiles(state);

    this.defenseLayer = this.makeLayer('fg-defense-layer', 3);
    this.pestLayer = this.makeLayer('fg-pest-layer', 4);
    this.playerLayer = this.makeLayer('fg-player-layer', 5);
    this.rainLayer = this.makeLayer('fg-rain-layer', 6);
    this.snowLayer = this.makeLayer('fg-snow-layer', 6);
    this.rainLayer.style.display = 'none';
    this.snowLayer.style.display = 'none';

    this.playerEl = document.createElement('div');
    this.playerEl.className = 'fg-player';
    this.playerEl.style.cssText = `
      position:absolute; pointer-events:none;
      font-size:${this.tilePx * 0.65}px; line-height:1;
      transform:translate(-50%, -55%);
      text-shadow: 0 2px 4px rgba(0,0,0,0.4);
    `;
    this.playerEl.textContent = PLAYER_EMOJI;
    this.playerLayer.appendChild(this.playerEl);

    window.addEventListener('resize', this.handleResize);
  }

  /** Rebuild the tile layer — used after 'load_state' because existing per-tile DOM is stale. */
  rebuild(state: GameState): void {
    if (!this.container) return;
    this.destroy();
    this.init(this.container, state);
  }

  private makeLayer(id: string, z: number): HTMLElement {
    const el = document.createElement('div');
    el.id = id;
    el.style.cssText = `position:absolute; inset:0; pointer-events:none; z-index:${z};`;
    this.gridEl.appendChild(el);
    return el;
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.container.innerHTML = '';
    this.tileEls = [];
    this.cropEls = [];
    this.fenceEls = [];
    this.treeEls = [];
    this.pestEls.clear();
    this.defenseEls.clear();
  }

  private handleResize = (): void => {
    this.computeTileSize();
    for (let i = 0; i < this.size.rows; i++) {
      for (let j = 0; j < this.size.cols; j++) {
        const idx = i * this.size.cols + j;
        const el = this.tileEls[idx];
        if (!el) continue;
        el.style.left = j * this.tilePx + 'px';
        el.style.top = i * this.tilePx + 'px';
        el.style.width = this.tilePx + 'px';
        el.style.height = this.tilePx + 'px';
      }
    }
  };

  private computeTileSize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;
    const sizeFromW = Math.floor(w / this.size.cols);
    const sizeFromH = Math.floor(h / this.size.rows);
    this.tilePx = Math.max(32, Math.min(sizeFromW, sizeFromH, 88));
  }

  private buildTiles(state: GameState): void {
    const px = this.tilePx;
    for (const tile of state.tiles) {
      const el = document.createElement('div');
      el.className = 'fg-tile';
      el.dataset.row = String(tile.row);
      el.dataset.col = String(tile.col);
      el.style.cssText = `
        position:absolute;
        left:${tile.col * px}px; top:${tile.row * px}px;
        width:${px}px; height:${px}px;
        background:${TILE_BG[tile.kind]};
        box-sizing:border-box;
        border:1px solid rgba(0,0,0,0.08);
        display:flex; align-items:center; justify-content:center;
        font-size:${px * 0.7}px; line-height:1;
      `;
      if (tile.isMarket) {
        el.classList.add('fg-market');
        const marker = document.createElement('span');
        marker.className = 'fg-market-emoji';
        marker.textContent = MARKET_EMOJI;
        el.appendChild(marker);
      }
      this.gridEl.appendChild(el);
      this.tileEls.push(el);
      this.cropEls.push(null);
      this.fenceEls.push(null);
      this.treeEls.push(null);
    }
  }

  screenToTile(clientX: number, clientY: number): { row: number; col: number } | null {
    const rect = this.gridEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= this.size.cols * this.tilePx || y >= this.size.rows * this.tilePx) return null;
    const col = Math.floor(x / this.tilePx);
    const row = Math.floor(y / this.tilePx);
    if (row < 0 || row >= this.size.rows || col < 0 || col >= this.size.cols) return null;
    return { row, col };
  }

  render(state: GameState, _now: number): void {
    this.renderTiles(state);
    this.renderCrops(state);
    this.renderDefenses(state);
    this.renderPests(state);
    this.renderPlayer(state.player, state.hasBoots);
    this.renderWeather(state);
  }

  // ---- Tiles ----

  private renderTiles(state: GameState): void {
    const px = this.tilePx;
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      const el = this.tileEls[i];
      el.style.background = TILE_BG[tile.kind];
      const arable = isArable(state, tile.row, tile.col);
      el.classList.toggle('fg-not-arable', !arable);

      // Fence overlay
      let fenceEl = this.fenceEls[i];
      if (tile.hasFence) {
        if (!fenceEl) {
          fenceEl = document.createElement('span');
          fenceEl.className = 'fg-fence';
          fenceEl.textContent = FENCE_EMOJI;
          fenceEl.style.cssText = `
            position:absolute; left:50%; top:50%;
            transform:translate(-50%, -50%);
            font-size:${px * 0.7}px; line-height:1;
            pointer-events:none;
            text-shadow: 0 2px 3px rgba(0,0,0,0.4);
          `;
          el.appendChild(fenceEl);
          this.fenceEls[i] = fenceEl;
        }
        fenceEl.style.fontSize = px * 0.7 + 'px';
      } else if (fenceEl) {
        fenceEl.remove();
        this.fenceEls[i] = null;
      }

      // Apple tree trunk under the fruit
      let treeEl = this.treeEls[i];
      if (tile.kind === 'apple_tree') {
        if (!treeEl) {
          treeEl = document.createElement('span');
          treeEl.className = 'fg-tree';
          treeEl.textContent = APPLE_TREE_EMOJI;
          treeEl.style.cssText = `
            position:absolute; left:50%; top:50%;
            transform:translate(-50%, -50%);
            font-size:${px * 0.9}px; line-height:1;
            pointer-events:none;
            text-shadow: 0 2px 3px rgba(0,0,0,0.4);
            z-index: 0;
          `;
          el.insertBefore(treeEl, el.firstChild);
          this.treeEls[i] = treeEl;
        }
        treeEl.style.fontSize = px * 0.9 + 'px';
      } else if (treeEl) {
        treeEl.remove();
        this.treeEls[i] = null;
      }
    }
  }

  // ---- Crops ----

  private renderCrops(state: GameState): void {
    const px = this.tilePx;
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      const tileEl = this.tileEls[i];
      let cropEl = this.cropEls[i];
      if (!tile.crop) {
        if (cropEl) {
          cropEl.remove();
          this.cropEls[i] = null;
        }
        continue;
      }
      if (!cropEl) {
        cropEl = document.createElement('div');
        cropEl.className = 'fg-crop';
        cropEl.style.cssText = `
          position:absolute;
          left:50%; top:60%;
          line-height:1;
          transform:translate(-50%, -50%) scale(0.3);
          pointer-events:none;
          transition: transform 0.25s ease-out;
          text-shadow: 0 2px 3px rgba(0,0,0,0.35);
          z-index: 1;
        `;
        tileEl.appendChild(cropEl);
        this.cropEls[i] = cropEl;
      }
      cropEl.textContent = CROP_EMOJI[tile.crop.kind];
      // Apple on tree renders smaller (nestled in the tree foliage)
      const sizeMult = tile.kind === 'apple_tree' ? 0.45 : 0.75;
      cropEl.style.fontSize = px * sizeMult + 'px';
      const grow = tile.crop.growth;
      const scale = 0.25 + grow * 0.9;
      const ripe = grow >= 1;
      cropEl.classList.toggle('fg-ripe', ripe);
      if (!ripe) {
        cropEl.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      } else {
        cropEl.style.transform = '';
      }
    }
  }

  // ---- Defenses ----

  private renderDefenses(state: GameState): void {
    const px = this.tilePx;
    const activeIds = new Set(state.defenses.map((d) => d.id));
    for (const [id, el] of this.defenseEls) {
      if (!activeIds.has(id)) {
        el.remove();
        this.defenseEls.delete(id);
      }
    }
    for (const d of state.defenses) {
      let el = this.defenseEls.get(d.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `fg-${d.kind}`;
        if (d.kind === 'cat') {
          el.textContent = CAT_EMOJI;
          el.style.cssText = `
            position:absolute; pointer-events:none;
            font-size:${px * 0.55}px; line-height:1;
            transform:translate(-50%, -55%);
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            z-index: 3;
          `;
        } else if (d.kind === 'scarecrow') {
          el.innerHTML = `<span class="fg-sc-hat">\u{1F454}</span><span class="fg-sc-head">\u{1F383}</span>`;
          el.style.cssText = `
            position:absolute; pointer-events:none;
            transform:translate(-50%, -65%);
            font-size:${px * 0.5}px; line-height:1;
            display:flex; flex-direction:column; align-items:center;
            z-index: 3;
          `;
        } else {
          // beehive
          el.innerHTML = `<span class="fg-bh-emoji">${BEEHIVE_EMOJI}</span><span class="fg-bh-honey" style="display:none; position:absolute; right:-0.3em; top:-0.3em; background:#ffcf5a; color:#3a2a00; font-size:0.55em; border-radius:1em; padding:0 0.35em; line-height:1.4; box-shadow:0 1px 2px rgba(0,0,0,0.4);"></span>`;
          el.style.cssText = `
            position:absolute; pointer-events:none;
            font-size:${px * 0.55}px; line-height:1;
            transform:translate(-50%, -55%);
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            z-index: 3;
          `;
        }
        this.defenseLayer.appendChild(el);
        this.defenseEls.set(d.id, el);
      }
      el.style.left = d.x * px + 'px';
      el.style.top = d.y * px + 'px';
      const sizePct = d.kind === 'scarecrow' ? 0.5 : 0.55;
      el.style.fontSize = px * sizePct + 'px';
      if (d.kind === 'beehive') {
        const badge = el.querySelector('.fg-bh-honey') as HTMLElement | null;
        if (badge) {
          const honey = d.honey ?? 0;
          badge.style.display = honey > 0 ? 'inline-block' : 'none';
          badge.textContent = honey > 0 ? String(honey) : '';
        }
      }
    }
  }

  // ---- Pests ----

  private renderPests(state: GameState): void {
    const px = this.tilePx;
    const activeIds = new Set(state.pests.map((p) => p.id));
    for (const [id, el] of this.pestEls) {
      if (!activeIds.has(id)) {
        el.remove();
        this.pestEls.delete(id);
      }
    }
    for (const p of state.pests) {
      let el = this.pestEls.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'fg-pest';
        el.style.cssText = `
          position:absolute; pointer-events:none;
          font-size:${px * 0.55}px; line-height:1;
          transform:translate(-50%, -55%);
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
          z-index: 4;
        `;
        el.textContent = PEST_EMOJI[p.kind];
        this.pestLayer.appendChild(el);
        this.pestEls.set(p.id, el);
      }
      el.style.left = p.x * px + 'px';
      el.style.top = p.y * px + 'px';
      el.classList.toggle('fg-pest-fleeing', p.fleeing);
      el.classList.toggle('fg-pest-eating', p.eating);
    }
  }

  // ---- Player ----

  private renderPlayer(player: Player, hasBoots: boolean): void {
    const px = this.tilePx;
    this.playerEl.style.left = player.x * px + 'px';
    this.playerEl.style.top = player.y * px + 'px';
    this.playerEl.style.fontSize = px * 0.65 + 'px';
    const flip = player.facing === 'left' ? ' scaleX(-1)' : '';
    this.playerEl.style.transform = `translate(-50%, -55%)${flip}`;
    this.playerEl.classList.toggle('fg-player-boots', hasBoots);
  }

  // ---- Weather & season ----

  private renderWeather(state: GameState): void {
    const season = currentSeason(state.time);
    const wantRain = isRaining(state) && season !== 'winter';
    const wantSnow = season === 'winter';

    // Rain
    if (!wantRain) {
      this.rainLayer.style.display = 'none';
    } else if (this.rainLayer.style.display !== 'block') {
      this.rainLayer.style.display = 'block';
      this.rainLayer.innerHTML = '';
      const count = 24;
      for (let i = 0; i < count; i++) {
        const drop = document.createElement('div');
        drop.textContent = RAIN_EMOJI;
        drop.style.cssText = `
          position:absolute;
          left:${Math.random() * 100}%;
          top:${-10 - Math.random() * 40}%;
          font-size:${this.tilePx * 0.35}px;
          opacity:0.8;
          animation: fg-raindrop ${1.2 + Math.random() * 0.8}s linear infinite;
          animation-delay: ${-Math.random() * 2}s;
        `;
        this.rainLayer.appendChild(drop);
      }
    }

    // Snow
    if (!wantSnow) {
      this.snowLayer.style.display = 'none';
    } else if (this.snowLayer.style.display !== 'block') {
      this.snowLayer.style.display = 'block';
      this.snowLayer.innerHTML = '';
      const count = 28;
      for (let i = 0; i < count; i++) {
        const flake = document.createElement('div');
        flake.textContent = SNOW_EMOJI;
        flake.style.cssText = `
          position:absolute;
          left:${Math.random() * 100}%;
          top:${-5 - Math.random() * 30}%;
          font-size:${this.tilePx * 0.3}px;
          opacity:0.85;
          animation: fg-snowflake ${4 + Math.random() * 3}s linear infinite;
          animation-delay: ${-Math.random() * 4}s;
        `;
        this.snowLayer.appendChild(flake);
      }
    }
  }
}

export { SEASON_EMOJI };
