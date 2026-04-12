import type { GameState, Renderer, HopState, EnemyState } from './types';

// ---------------------------------------------------------------------------
// Color palettes — [levelNumber][colorIndex] → { top, left, right }
// ---------------------------------------------------------------------------

const PALETTES: Record<number, { top: string; left: string; right: string }[]> = {
  1: [
    { top: '#4466ff', left: '#3355dd', right: '#2244bb' },
    { top: '#ffdd44', left: '#ddbb22', right: '#bb9900' },
  ],
  2: [
    { top: '#4466ff', left: '#3355dd', right: '#2244bb' },
    { top: '#ff6699', left: '#dd4477', right: '#bb2255' },
  ],
  3: [
    { top: '#ffdd44', left: '#ddbb22', right: '#bb9900' },
    { top: '#4466ff', left: '#3355dd', right: '#2244bb' },
  ],
  4: [
    { top: '#44cc66', left: '#33aa55', right: '#228844' },
    { top: '#ff9944', left: '#dd7722', right: '#bb5500' },
    { top: '#cc44ff', left: '#aa22dd', right: '#8800bb' },
  ],
  5: [
    { top: '#44cc66', left: '#33aa55', right: '#228844' },
    { top: '#ff6644', left: '#dd4422', right: '#bb2200' },
    { top: '#ffdd44', left: '#ddbb22', right: '#bb9900' },
  ],
  6: [
    { top: '#4466ff', left: '#3355dd', right: '#2244bb' },
    { top: '#44cc66', left: '#33aa55', right: '#228844' },
    { top: '#ff9944', left: '#dd7722', right: '#bb5500' },
    { top: '#ff4466', left: '#dd2244', right: '#bb0022' },
  ],
  7: [
    { top: '#ff6699', left: '#dd4477', right: '#bb2255' },
    { top: '#44ddff', left: '#22bbdd', right: '#0099bb' },
  ],
  8: [
    { top: '#cc44ff', left: '#aa22dd', right: '#8800bb' },
    { top: '#44cc66', left: '#33aa55', right: '#228844' },
    { top: '#ffdd44', left: '#ddbb22', right: '#bb9900' },
  ],
  9: [
    { top: '#4466ff', left: '#3355dd', right: '#2244bb' },
    { top: '#ff6644', left: '#dd4422', right: '#bb2200' },
    { top: '#44cc66', left: '#33aa55', right: '#228844' },
    { top: '#ffdd44', left: '#ddbb22', right: '#bb9900' },
  ],
  10: [
    { top: '#ff4466', left: '#dd2244', right: '#bb0022' },
    { top: '#ff9944', left: '#dd7722', right: '#bb5500' },
    { top: '#44ddff', left: '#22bbdd', right: '#0099bb' },
    { top: '#cc44ff', left: '#aa22dd', right: '#8800bb' },
  ],
};

function getPalette(level: number): { top: string; left: string; right: string }[] {
  return PALETTES[level] ?? PALETTES[1];
}

// ---------------------------------------------------------------------------
// Entity emoji mapping
// ---------------------------------------------------------------------------

const ENEMY_EMOJI: Record<string, string> = {
  red_ball: '\u{1F534}',
  coily_ball: '\u{1F7E3}',
  coily: '\u{1F40D}',
  slick: '\u{1F49A}',
  sam: '\u{1F49C}',
};

const PLAYER_EMOJI = '\u{1F604}'; // grinning face
const DISC_EMOJI = '\u{1F4BF}'; // disc

// ---------------------------------------------------------------------------
// Isometric geometry
// ---------------------------------------------------------------------------

interface LayoutMetrics {
  cubeW: number;
  cubeH: number;
  topH: number;
  sideH: number;
  originX: number;
  originY: number;
}

function computeMetrics(containerW: number, containerH: number, rows: number): LayoutMetrics {
  // The pyramid spans ~rows cubes wide at the bottom and ~rows cubes tall
  // We want it centered with padding
  const maxW = containerW / (rows + 2);
  const maxH = containerH / (rows * 1.1 + 3);
  const cubeW = Math.min(64, maxW, maxH * 1.2);
  const topH = cubeW * 0.42;
  const sideH = cubeW * 0.55;
  const cubeH = topH + sideH;

  const originX = containerW / 2;
  // Push the pyramid up a bit so there's room for the HUD
  const totalPyramidH = rows * (topH + sideH * 0.5);
  const originY = (containerH - totalPyramidH) / 2 + cubeH * 0.5;

  return { cubeW, cubeH, topH, sideH, originX, originY };
}

function cubeToPixel(row: number, col: number, m: LayoutMetrics): { x: number; y: number } {
  const x = m.originX + (col - row / 2) * m.cubeW;
  const y = m.originY + row * (m.topH + m.sideH * 0.5);
  return { x, y };
}

function interpolatePosition(
  hop: HopState | null,
  row: number,
  col: number,
  now: number,
  m: LayoutMetrics,
): { x: number; y: number; t: number } {
  if (!hop) {
    const pos = cubeToPixel(row, col, m);
    return { ...pos, t: 1 };
  }
  const t = Math.min(1, Math.max(0, (now - hop.startTime) / hop.duration));
  const from = cubeToPixel(hop.fromRow, hop.fromCol, m);
  const to = cubeToPixel(hop.toRow, hop.toCol, m);
  const eased = t; // linear for now; can add easing
  const x = from.x + (to.x - from.x) * eased;
  const baseY = from.y + (to.y - from.y) * eased;
  // Parabolic hop arc
  const hopHeight = m.cubeH * 0.8;
  const arc = -4 * hopHeight * t * (1 - t);
  return { x, y: baseY + arc, t };
}

// ---------------------------------------------------------------------------
// DOM Renderer
// ---------------------------------------------------------------------------

export class DomRenderer implements Renderer {
  private container!: HTMLElement;
  private metrics!: LayoutMetrics;

  // DOM element pools
  private cubeEls: Map<string, { wrap: HTMLElement; top: HTMLElement; left: HTMLElement; right: HTMLElement }> =
    new Map();
  private playerEl!: HTMLElement;
  private enemyEls: Map<number, HTMLElement> = new Map();
  private discEls: Map<string, HTMLElement> = new Map();
  private hudScore!: HTMLElement;
  private hudLevel!: HTMLElement;
  private hudLives!: HTMLElement;

  private resizeObserver?: ResizeObserver;

  init(container: HTMLElement, state: GameState): void {
    this.container = container;
    this.container.innerHTML = '';

    const rect = container.getBoundingClientRect();
    this.metrics = computeMetrics(rect.width, rect.height, state.level.pyramidRows);

    this.buildCubes(state);
    this.buildDiscs(state);
    this.buildPlayer();
    this.buildHud();

    this.resizeObserver = new ResizeObserver(() => {
      const r = this.container.getBoundingClientRect();
      this.metrics = computeMetrics(r.width, r.height, state.level.pyramidRows);
      // Re-position cubes and discs (entities will catch up on next render)
      this.repositionCubes(state);
      this.repositionDiscs(state);
    });
    this.resizeObserver.observe(container);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.container.innerHTML = '';
    this.cubeEls.clear();
    this.enemyEls.clear();
    this.discEls.clear();
  }

  getPlayerScreenPos(state: GameState, now: number): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    const pos = interpolatePosition(state.player.hop, state.player.row, state.player.col, now, this.metrics);
    return { x: rect.left + pos.x, y: rect.top + pos.y };
  }

  render(state: GameState, now: number): void {
    this.renderCubeColors(state);
    this.renderPlayer(state, now);
    this.renderEnemies(state, now);
    this.renderDiscs(state);
    this.renderHud(state);
  }

  // ---- Build ----

  private buildCubes(state: GameState): void {
    const m = this.metrics;
    const palette = getPalette(state.level.number);

    for (const cube of state.cubes) {
      const pos = cubeToPixel(cube.row, cube.col, m);
      const colors = palette[cube.colorIndex] ?? palette[0];

      const wrap = document.createElement('div');
      wrap.className = 'qb-cube';
      wrap.style.position = 'absolute';
      wrap.style.width = m.cubeW + 'px';
      wrap.style.height = m.cubeH + 'px';
      wrap.style.transform = `translate3d(${pos.x - m.cubeW / 2}px, ${pos.y - m.topH / 2}px, 0)`;

      const topFace = document.createElement('div');
      topFace.className = 'qb-cube-top';
      topFace.style.cssText = `
        position:absolute; left:0; right:0; top:0;
        height:${m.topH}px;
        background:${colors.top};
        clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
        transition: background 0.15s;
      `;

      const leftFace = document.createElement('div');
      leftFace.className = 'qb-cube-left';
      leftFace.style.cssText = `
        position:absolute; left:0; top:${m.topH / 2}px;
        width:${m.cubeW / 2}px; height:${m.sideH}px;
        background:${colors.left};
        clip-path: polygon(0% 0%, 100% ${((m.topH / 2) / m.sideH * 100).toFixed(1)}%, 100% 100%, 0% ${(100 - (m.topH / 2) / m.sideH * 100).toFixed(1)}%);
        transition: background 0.15s;
      `;

      const rightFace = document.createElement('div');
      rightFace.className = 'qb-cube-right';
      rightFace.style.cssText = `
        position:absolute; right:0; top:${m.topH / 2}px;
        width:${m.cubeW / 2}px; height:${m.sideH}px;
        background:${colors.right};
        clip-path: polygon(0% ${((m.topH / 2) / m.sideH * 100).toFixed(1)}%, 100% 0%, 100% ${(100 - (m.topH / 2) / m.sideH * 100).toFixed(1)}%, 0% 100%);
        transition: background 0.15s;
      `;

      wrap.append(topFace, leftFace, rightFace);
      this.container.appendChild(wrap);
      this.cubeEls.set(`${cube.row},${cube.col}`, { wrap, top: topFace, left: leftFace, right: rightFace });
    }
  }

  private buildPlayer(): void {
    this.playerEl = document.createElement('div');
    this.playerEl.className = 'qb-entity qb-player';
    this.playerEl.textContent = PLAYER_EMOJI;
    this.playerEl.style.cssText = `
      position:absolute; pointer-events:none; z-index:15;
      font-size:${this.metrics.cubeW * 0.6}px; line-height:1;
      will-change:transform;
    `;
    this.container.appendChild(this.playerEl);
  }

  private buildDiscs(state: GameState): void {
    const m = this.metrics;
    for (const disc of state.discs) {
      const key = `${disc.row},${disc.side}`;
      const el = document.createElement('div');
      el.className = 'qb-disc';
      el.textContent = DISC_EMOJI;

      // Position disc off the side of the pyramid
      const col = disc.side === 'left' ? -1 : disc.row + 1;
      const pos = cubeToPixel(disc.row, col, m);

      el.style.cssText = `
        position:absolute; z-index:5;
        font-size:${m.cubeW * 0.5}px; line-height:1;
        transform: translate3d(${pos.x - m.cubeW * 0.25}px, ${pos.y}px, 0);
        animation: qb-disc-bob 1.5s ease-in-out infinite;
      `;
      this.container.appendChild(el);
      this.discEls.set(key, el);
    }
  }

  private buildHud(): void {
    // HUD is in the HTML, just grab refs
    this.hudScore = document.getElementById('qb-score')!;
    this.hudLevel = document.getElementById('qb-level')!;
    this.hudLives = document.getElementById('qb-lives')!;
  }

  // ---- Reposition on resize ----

  private repositionCubes(state: GameState): void {
    const m = this.metrics;
    for (const cube of state.cubes) {
      const el = this.cubeEls.get(`${cube.row},${cube.col}`);
      if (!el) continue;
      const pos = cubeToPixel(cube.row, cube.col, m);
      el.wrap.style.width = m.cubeW + 'px';
      el.wrap.style.height = m.cubeH + 'px';
      el.wrap.style.transform = `translate3d(${pos.x - m.cubeW / 2}px, ${pos.y - m.topH / 2}px, 0)`;
      el.top.style.height = m.topH + 'px';
      el.left.style.top = m.topH / 2 + 'px';
      el.left.style.width = m.cubeW / 2 + 'px';
      el.left.style.height = m.sideH + 'px';
      el.right.style.top = m.topH / 2 + 'px';
      el.right.style.width = m.cubeW / 2 + 'px';
      el.right.style.height = m.sideH + 'px';
    }
    this.playerEl.style.fontSize = m.cubeW * 0.6 + 'px';
  }

  private repositionDiscs(state: GameState): void {
    const m = this.metrics;
    for (const disc of state.discs) {
      const key = `${disc.row},${disc.side}`;
      const el = this.discEls.get(key);
      if (!el) continue;
      const col = disc.side === 'left' ? -1 : disc.row + 1;
      const pos = cubeToPixel(disc.row, col, m);
      el.style.fontSize = m.cubeW * 0.5 + 'px';
      el.style.transform = `translate3d(${pos.x - m.cubeW * 0.25}px, ${pos.y}px, 0)`;
    }
  }

  // ---- Per-frame rendering ----

  private renderCubeColors(state: GameState): void {
    const palette = getPalette(state.level.number);
    for (const cube of state.cubes) {
      const el = this.cubeEls.get(`${cube.row},${cube.col}`);
      if (!el) continue;
      const colors = palette[cube.colorIndex] ?? palette[0];
      el.top.style.background = colors.top;
      el.left.style.background = colors.left;
      el.right.style.background = colors.right;
    }
  }

  private renderPlayer(state: GameState, now: number): void {
    const m = this.metrics;
    const pos = interpolatePosition(state.player.hop, state.player.row, state.player.col, now, m);
    const entityOffsetY = -m.cubeW * 0.5;
    this.playerEl.style.transform = `translate3d(${pos.x - m.cubeW * 0.3}px, ${pos.y + entityOffsetY}px, 0)`;

    // Squash/stretch on landing
    if (pos.t > 0.85 && pos.t < 1 && state.player.hop) {
      const squash = 1 + (pos.t - 0.85) / 0.15 * 0.15;
      this.playerEl.style.transform += ` scaleX(${squash.toFixed(3)}) scaleY(${(2 - squash).toFixed(3)})`;
    }

    this.playerEl.style.opacity = state.player.alive ? '1' : '0.4';
  }

  private renderEnemies(state: GameState, now: number): void {
    const m = this.metrics;

    // Remove DOM elements for enemies no longer in state
    const activeIds = new Set(state.enemies.map((e) => e.id));
    for (const [id, el] of this.enemyEls) {
      if (!activeIds.has(id)) {
        el.remove();
        this.enemyEls.delete(id);
      }
    }

    for (const enemy of state.enemies) {
      let el = this.enemyEls.get(enemy.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'qb-entity';
        el.style.cssText = `
          position:absolute; pointer-events:none; z-index:10;
          font-size:${m.cubeW * 0.5}px; line-height:1;
          will-change:transform;
        `;
        this.container.appendChild(el);
        this.enemyEls.set(enemy.id, el);
      }

      el.textContent = ENEMY_EMOJI[enemy.type] ?? '\u{2753}';
      const pos = interpolatePosition(enemy.hop, enemy.row, enemy.col, now, m);
      const entityOffsetY = -m.cubeW * 0.4;
      el.style.transform = `translate3d(${pos.x - m.cubeW * 0.25}px, ${pos.y + entityOffsetY}px, 0)`;
    }
  }

  private renderDiscs(state: GameState): void {
    for (const disc of state.discs) {
      const key = `${disc.row},${disc.side}`;
      const el = this.discEls.get(key);
      if (el) {
        el.style.display = disc.used ? 'none' : '';
      }
    }
  }

  private renderHud(state: GameState): void {
    if (this.hudScore) this.hudScore.textContent = String(state.score);
    if (this.hudLevel) this.hudLevel.textContent = String(state.level.number);
    if (this.hudLives) this.hudLives.textContent = String(state.lives);
  }
}
