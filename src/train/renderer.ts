import { Dir, DIR_DELTA, EXIT_BIT, hasExit, FLYING_ANIMALS } from './types';
import type { GameState, Renderer, TileState, TrainCar, TrainKind, AnimalKind } from './types';

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

const TERRAIN_COLOR: Record<string, string> = {
  grass: '#5fb55f',
  water: '#3a7dd6',
};

const TRAIN_EMOJI: Record<TrainKind, string> = {
  steam: '\u{1F682}',
  diesel: '\u{1F683}',
  electric: '\u{1F686}',
  monorail: '\u{1F69D}',
};

const TRAIN_CAR_EMOJI: Record<TrainKind, string> = {
  steam: '\u{1F683}',
  diesel: '\u{1F683}',
  electric: '\u{1F686}',
  monorail: '\u{1F69D}',
};

const ANIMAL_EMOJI: Record<AnimalKind, string> = {
  cow: '\u{1F404}',
  sheep: '\u{1F411}',
  pig: '\u{1F416}',
  horse: '\u{1F40E}',
  chicken: '\u{1F414}',
  dog: '\u{1F415}',
  duck: '\u{1F986}',
  rabbit: '\u{1F407}',
  pigeon: '\u{1F54A}\uFE0F',
};

// ---------------------------------------------------------------------------
// DOM Renderer
// ---------------------------------------------------------------------------

export class DomRenderer implements Renderer {
  private container!: HTMLElement;
  private gridEl!: HTMLElement;
  private trainLayer!: HTMLElement;
  private animalLayer!: HTMLElement;
  private poopLayer!: HTMLElement;
  private bloodLayer!: HTMLElement;

  /** SVG-based per-tile elements so we can draw track curves cleanly. */
  private tileEls: HTMLElement[] = [];
  private tileSvgs: SVGSVGElement[] = [];
  private trainEls: Map<number, HTMLElement[]> = new Map();
  private animalEls: Map<number, HTMLElement> = new Map();
  private poopEls: Map<number, HTMLElement> = new Map();
  private bloodEls: Map<number, HTMLElement> = new Map();

  private size = { rows: 0, cols: 0 };
  private tilePx = 60;

  init(container: HTMLElement, state: GameState): void {
    this.container = container;
    this.container.innerHTML = '';
    this.size = state.size;

    // Build grid
    this.gridEl = document.createElement('div');
    this.gridEl.id = 'tg-grid';
    this.gridEl.style.cssText = `
      position:relative; touch-action:none; user-select:none;
      width:100%; height:100%;
      background:#3a7d3a;
    `;
    this.container.appendChild(this.gridEl);

    this.computeTileSize();
    this.buildTiles(state);

    this.bloodLayer = document.createElement('div');
    this.bloodLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    this.gridEl.appendChild(this.bloodLayer);

    this.poopLayer = document.createElement('div');
    this.poopLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    this.gridEl.appendChild(this.poopLayer);

    this.trainLayer = document.createElement('div');
    this.trainLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    this.gridEl.appendChild(this.trainLayer);

    this.animalLayer = document.createElement('div');
    this.animalLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    this.gridEl.appendChild(this.animalLayer);

    window.addEventListener('resize', this.handleResize);
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize);
    this.container.innerHTML = '';
    this.tileEls = [];
    this.tileSvgs = [];
    this.trainEls.clear();
    this.animalEls.clear();
    this.poopEls.clear();
    this.bloodEls.clear();
  }

  private handleResize = (): void => {
    this.computeTileSize();
    for (const tileEl of this.tileEls) {
      tileEl.style.width = this.tilePx + 'px';
      tileEl.style.height = this.tilePx + 'px';
    }
    for (let i = 0; i < this.size.rows; i++) {
      for (let j = 0; j < this.size.cols; j++) {
        const idx = i * this.size.cols + j;
        const el = this.tileEls[idx];
        if (el) {
          el.style.left = j * this.tilePx + 'px';
          el.style.top = i * this.tilePx + 'px';
        }
      }
    }
  };

  private computeTileSize(): void {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;
    const sizeFromW = Math.floor(w / this.size.cols);
    const sizeFromH = Math.floor(h / this.size.rows);
    this.tilePx = Math.max(28, Math.min(sizeFromW, sizeFromH, 80));
  }

  private buildTiles(state: GameState): void {
    const px = this.tilePx;
    for (const tile of state.tiles) {
      const el = document.createElement('div');
      el.className = 'tg-tile';
      el.dataset.row = String(tile.row);
      el.dataset.col = String(tile.col);
      el.style.cssText = `
        position:absolute;
        left:${tile.col * px}px; top:${tile.row * px}px;
        width:${px}px; height:${px}px;
        background:${TERRAIN_COLOR[tile.terrain]};
        box-sizing:border-box;
        border:1px solid rgba(0,0,0,0.05);
      `;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
      el.appendChild(svg);

      this.gridEl.appendChild(el);
      this.tileEls.push(el);
      this.tileSvgs.push(svg);
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

  screenToTileSpace(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.gridEl.getBoundingClientRect();
    const x = (clientX - rect.left) / this.tilePx;
    const y = (clientY - rect.top) / this.tilePx;
    if (x < 0 || y < 0 || x >= this.size.cols || y >= this.size.rows) return null;
    return { x, y };
  }

  render(state: GameState, now: number): void {
    this.renderTiles(state);
    this.renderBloodPuddles(state);
    this.renderPoops(state, now);
    this.renderTrains(state);
    this.renderAnimals(state);
  }

  // ---- Tiles ----

  private renderTiles(state: GameState): void {
    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      const el = this.tileEls[i];
      el.style.background = TERRAIN_COLOR[tile.terrain];

      const svg = this.tileSvgs[i];
      svg.innerHTML = '';

      if (tile.track) {
        this.drawTrack(svg, tile);
      }
      if (tile.decoration === 'tunnel') {
        this.drawDecoration(svg, '\u26F0\uFE0F'); // mountain
      } else if (tile.decoration === 'bridge') {
        this.drawDecoration(svg, '\u{1F309}'); // bridge at night, recognizable
      }
    }
  }

  private drawTrack(svg: SVGSVGElement, tile: TileState): void {
    if (!tile.track) return;
    const exits: Dir[] = [];
    for (let d: Dir = 0; d < 4; d++) {
      if (hasExit(tile.track, d as Dir)) exits.push(d as Dir);
    }
    // Draw a path from each exit to the centre (single line through if straight)
    const tieColor = '#7a4a1c';
    const railColor = '#bdbdbd';

    // Draw ties first as a wider lighter band, then rails as narrow lines
    const wide = makeRoadSpec(exits);
    const tiePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tiePath.setAttribute('d', wide);
    tiePath.setAttribute('stroke', tieColor);
    tiePath.setAttribute('stroke-width', '24');
    tiePath.setAttribute('fill', 'none');
    tiePath.setAttribute('stroke-linecap', 'butt');
    svg.appendChild(tiePath);

    const railPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    railPath.setAttribute('d', wide);
    railPath.setAttribute('stroke', railColor);
    railPath.setAttribute('stroke-width', '6');
    railPath.setAttribute('fill', 'none');
    railPath.setAttribute('stroke-linecap', 'butt');
    svg.appendChild(railPath);
  }

  private drawDecoration(svg: SVGSVGElement, emoji: string): void {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '50');
    text.setAttribute('y', '70');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '60');
    text.textContent = emoji;
    svg.appendChild(text);
  }

  // ---- Trains ----

  private renderTrains(state: GameState): void {
    const px = this.tilePx;

    // Remove DOM for trains no longer present
    const activeIds = new Set(state.trains.map((t) => t.id));
    for (const [id, els] of this.trainEls) {
      if (!activeIds.has(id)) {
        for (const e of els) e.remove();
        this.trainEls.delete(id);
      }
    }

    for (const train of state.trains) {
      let els = this.trainEls.get(train.id);
      if (!els) {
        els = [];
        for (let i = 0; i < train.cars.length; i++) {
          const e = document.createElement('div');
          e.className = 'tg-train-car';
          e.style.cssText = `
            position:absolute; pointer-events:none;
            font-size:${px * 0.7}px; line-height:1;
            transform:translate(-50%, -50%);
            text-shadow: 0 2px 4px rgba(0,0,0,0.4);
            z-index: 5;
          `;
          const emoji = document.createElement('span');
          emoji.className = 'tg-train-emoji';
          emoji.textContent = i === 0 ? TRAIN_EMOJI[train.kind] : TRAIN_CAR_EMOJI[train.kind];
          const dirt = document.createElement('span');
          dirt.className = 'tg-train-dirt';
          dirt.style.cssText = `
            position:absolute;
            right:-0.04em; bottom:0.02em;
            width:0.34em; height:0.24em;
            border-radius:50%;
            background:radial-gradient(circle at 42% 42%, #8a4b18 0%, #5f3411 62%, #3b1f09 100%);
            box-shadow:-0.18em -0.08em 0 -0.08em #6f3d13, 0.14em -0.11em 0 -0.1em #4b2a0d, 0 1px 2px rgba(0,0,0,0.35);
            opacity:0;
            transform:rotate(-14deg);
            transition:opacity 120ms ease;
          `;
          e.appendChild(emoji);
          e.appendChild(dirt);
          this.trainLayer.appendChild(e);
          els.push(e);
        }
        this.trainEls.set(train.id, els);
      }

      for (let i = 0; i < train.cars.length; i++) {
        const car = train.cars[i];
        const el = els[i];
        if (!el) continue;
        const pos = carScreenPos(car, px);
        el.style.left = pos.x + 'px';
        el.style.top = pos.y + 'px';
        // Rotate to direction
        const rot = dirToDeg(car.dir);
        el.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
        el.style.fontSize = px * 0.7 + 'px';
        el.style.filter = train.dirty ? 'sepia(0.45) saturate(0.75) brightness(0.9)' : '';
        el.style.textShadow = train.dirty
          ? '0 2px 4px rgba(75,45,5,0.6), 0 0 0.12em rgba(95,52,17,0.55)'
          : '0 2px 4px rgba(0,0,0,0.4)';
        el.classList.toggle('tg-train-dirty', train.dirty);
        const dirt = el.querySelector<HTMLElement>('.tg-train-dirt');
        if (dirt) dirt.style.opacity = train.dirty ? '1' : '0';
      }
    }
  }

  // ---- Animals ----

  private renderAnimals(state: GameState): void {
    const px = this.tilePx;
    const activeIds = new Set(state.animals.map((a) => a.id));
    for (const [id, el] of this.animalEls) {
      if (!activeIds.has(id)) {
        el.remove();
        this.animalEls.delete(id);
      }
    }

    for (const a of state.animals) {
      const flying = FLYING_ANIMALS.has(a.kind);
      let el = this.animalEls.get(a.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tg-animal';
        el.style.cssText = `
          position:absolute; pointer-events:none;
          line-height:1;
          z-index: ${flying ? 7 : 4};
          text-shadow: 0 ${flying ? 4 : 1}px ${flying ? 6 : 2}px rgba(0,0,0,${flying ? 0.45 : 0.3});
        `;
        el.textContent = ANIMAL_EMOJI[a.kind];
        this.animalLayer.appendChild(el);
        this.animalEls.set(a.id, el);
      }
      const size = flying ? px * 0.6 : px * 0.55;
      el.style.left = a.x * px + 'px';
      el.style.top = a.y * px + 'px';
      el.style.fontSize = size + 'px';
      // Perched flyers get a small pedestal feel; un-perched flyers bob slightly via transform.
      const tilt = flying && !a.perched ? Math.sin(a.x + a.y) * 6 : 0;
      el.style.transform = `translate(-50%, -50%) rotate(${tilt}deg)`;
      el.classList.toggle('tg-perched', a.perched);
    }
  }

  // ---- Poops ----

  private renderPoops(state: GameState, now: number): void {
    const px = this.tilePx;

    const activeIds = new Set(state.poops.map((p) => p.id));
    for (const [id, el] of this.poopEls) {
      if (!activeIds.has(id)) {
        el.remove();
        this.poopEls.delete(id);
      }
    }

    for (const p of state.poops) {
      let el = this.poopEls.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tg-poop';
        el.textContent = '\u{1F4A9}';
        el.style.cssText = `
          position:absolute; pointer-events:none;
          line-height:1;
          z-index: 3;
          transform: translate(-50%, -50%);
          text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        `;
        this.poopLayer.appendChild(el);
        this.poopEls.set(p.id, el);
      }
      // Falling: lift the poop above the landing point and shrink slightly
      let visualY = p.y;
      let scale = 1;
      if (!p.landed) {
        const t = Math.max(0, Math.min(1, (now - p.startTime) / p.duration));
        visualY = p.y - p.fallStart * (1 - t);
        scale = 0.6 + 0.4 * t;
      }
      el.style.left = p.x * px + 'px';
      el.style.top = visualY * px + 'px';
      el.style.fontSize = px * 0.35 + 'px';
      el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(2)})`;
      el.classList.toggle('tg-landed', p.landed);
    }
  }

  // ---- Blood puddles ----

  private renderBloodPuddles(state: GameState): void {
    const px = this.tilePx;

    const activeIds = new Set(state.bloodPuddles.map((b) => b.id));
    for (const [id, el] of this.bloodEls) {
      if (!activeIds.has(id)) {
        el.remove();
        this.bloodEls.delete(id);
      }
    }

    for (const b of state.bloodPuddles) {
      let el = this.bloodEls.get(b.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tg-blood-puddle';
        el.style.cssText = `
          position:absolute; pointer-events:none;
          z-index: 2;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(circle at 45% 45%, #d71920 0%, #a00000 58%, #5f0000 100%);
          box-shadow: 0 1px 2px rgba(60,0,0,0.45);
        `;
        this.bloodLayer.appendChild(el);
        this.bloodEls.set(b.id, el);
      }
      const wobble = (b.id % 5) * 0.03;
      el.style.left = b.x * px + 'px';
      el.style.top = b.y * px + 'px';
      el.style.width = px * (0.34 + wobble) + 'px';
      el.style.height = px * (0.22 + wobble * 0.5) + 'px';
      el.style.transform = `translate(-50%, -50%) rotate(${(b.id % 7) * 19}deg)`;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function carScreenPos(car: TrainCar, px: number): { x: number; y: number } {
  // Centre of the source tile + progress * (dir vector)
  const cx = (car.col + 0.5) * px;
  const cy = (car.row + 0.5) * px;
  const [dr, dc] = DIR_DELTA[car.dir];
  const t = Math.max(0, Math.min(1, car.progress));
  return { x: cx + dc * t * px, y: cy + dr * t * px };
}

function dirToDeg(d: Dir): number {
  switch (d) {
    case Dir.N: return -90;
    case Dir.E: return 0;
    case Dir.S: return 90;
    case Dir.W: return 180;
  }
}

/**
 * Build an SVG path string that draws a track shape connecting the given exits
 * through the centre of a 100x100 tile. Each exit is at the midpoint of an edge.
 */
function makeRoadSpec(exits: Dir[]): string {
  const pt = (d: Dir): [number, number] => {
    switch (d) {
      case Dir.N: return [50, 0];
      case Dir.E: return [100, 50];
      case Dir.S: return [50, 100];
      case Dir.W: return [0, 50];
    }
  };

  if (exits.length === 0) return '';
  if (exits.length === 1) {
    const [x, y] = pt(exits[0]);
    return `M${x} ${y} L 50 50`;
  }
  if (exits.length === 2) {
    const [a, b] = exits;
    const isStraight = (a + 2) % 4 === b;
    const [ax, ay] = pt(a);
    const [bx, by] = pt(b);
    if (isStraight) {
      return `M${ax} ${ay} L${bx} ${by}`;
    }
    // Curve: quadratic through the corner closest to centre
    return `M${ax} ${ay} Q 50 50 ${bx} ${by}`;
  }
  // 3+ exits: draw lines from each exit to centre
  let d = '';
  for (const dir of exits) {
    const [x, y] = pt(dir);
    d += `M${x} ${y} L 50 50 `;
  }
  return d;
}
