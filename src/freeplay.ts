import type { SoundEntry } from './types';
import {
  isMobile,
  pickRandom,
  speakText,
  loadSounds,
  enterFullscreen,
  exitFullscreen,
  setupEscapeHold,
  setupFullscreenExit,
  preventContextMenu,
  ESCAPE_HOLD_TIME,
} from './utils';

const BUTTON_COUNTS: Record<number, number> = { 1: 4, 2: 6, 3: 12 };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const COLORS = [
  { display: null, css: '#e74c3c', name: 'red' },
  { display: null, css: '#3498db', name: 'blue' },
  { display: null, css: '#2ecc71', name: 'green' },
  { display: null, css: '#f1c40f', name: 'yellow' },
  { display: null, css: '#e67e22', name: 'orange' },
  { display: null, css: '#9b59b6', name: 'purple' },
  { display: null, css: '#2c3e50', name: 'black' },
  { display: null, css: '#ecf0f1', name: 'white' },
  { display: null, css: '#8B4513', name: 'brown' },
  { display: null, css: '#ff69b4', name: 'pink' },
  { display: null, css: '#1abc9c', name: 'turquoise' },
  { display: null, css: '#ffd700', name: 'gold' },
];

const NUMBERS_EASY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const NUMBERS_HARD: number[] = [];
for (let i = 1; i <= 20; i++) NUMBERS_HARD.push(i);

interface DisplayItem {
  display: string | null;
  css?: string;
  name: string;
  renderType: 'emoji' | 'text' | 'color';
  sound?: SoundEntry;
}

let sounds: SoundEntry[] = [];
let isPlaying = false;
let buttonItems: (DisplayItem | null)[] = [];
let buttonCount = 4;

function getDifficulty(): number {
  const slider = document.getElementById('difficulty-slider') as HTMLInputElement | null;
  return slider ? parseInt(slider.value) : 2;
}

function getMode(): string {
  const sel = document.querySelector('.mode-btn.selected') as HTMLElement | null;
  return sel ? sel.dataset.mode ?? 'objects' : 'objects';
}

function getRandomItem(): DisplayItem {
  const mode = getMode();

  if (mode === 'objects') {
    const s = pickRandom(sounds);
    return { display: s.emoji, name: s.name, renderType: 'emoji', sound: s };
  }
  if (mode === 'alphabet') {
    const letter = pickRandom(ALPHABET);
    return { display: letter, name: letter, renderType: 'text' };
  }
  if (mode === 'colors') {
    const c = pickRandom(COLORS);
    return { display: null, css: c.css, name: c.name, renderType: 'color' };
  }
  if (mode === 'numbers') {
    const pool = getDifficulty() >= 3 ? NUMBERS_HARD : NUMBERS_EASY;
    const n = pickRandom(pool);
    return { display: String(n), name: String(n), renderType: 'text' };
  }
  const s = pickRandom(sounds);
  return { display: s.emoji, name: s.name, renderType: 'emoji', sound: s };
}

function renderItemIntoButton(btn: HTMLElement, item: DisplayItem): void {
  const existing = btn.querySelector('.emoji, .color-swatch');
  if (existing) existing.remove();

  if (item.renderType === 'color') {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = item.css!;
    btn.appendChild(swatch);
  } else {
    const span = document.createElement('span');
    span.className = 'emoji';
    span.textContent = item.display;
    if (item.renderType === 'text') span.classList.add('text-choice');
    btn.appendChild(span);
  }
}

function initTouchButton(index: number): void {
  const btn = document.querySelector(`.touch-btn[data-index="${index}"]`) as HTMLElement | null;
  if (!btn) return;

  const item = getRandomItem();
  buttonItems[index] = item;
  renderItemIntoButton(btn, item);
}

function buildTouchGrid(): void {
  buttonCount = BUTTON_COUNTS[getDifficulty()] || 6;
  buttonItems = new Array(buttonCount).fill(null);

  const grid = document.getElementById('touch-grid')!;
  grid.innerHTML = '';
  grid.classList.remove('grid-large');

  if (buttonCount <= 4) {
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gridTemplateRows = buttonCount <= 2 ? '1fr' : '1fr 1fr';
  } else if (buttonCount <= 6) {
    grid.style.gridTemplateColumns = '1fr 1fr 1fr';
    grid.style.gridTemplateRows = '1fr 1fr';
  } else {
    grid.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
    grid.style.gridTemplateRows = '1fr 1fr 1fr';
    grid.classList.add('grid-large');
  }

  for (let i = 0; i < buttonCount; i++) {
    const btn = document.createElement('button');
    btn.className = 'touch-btn';
    btn.dataset.index = String(i);
    btn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        handleTouchButton(i);
      },
      { passive: false },
    );
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleTouchButton(i);
    });
    grid.appendChild(btn);
    initTouchButton(i);
  }
}

function playSoundDesktop(item: DisplayItem): void {
  if (!item) return;

  speakText(item.name);

  const el = document.createElement('div');
  el.className = 'emoji-display';

  if (item.renderType === 'color') {
    el.style.width = '120px';
    el.style.height = '120px';
    el.style.borderRadius = '50%';
    el.style.background = item.css!;
    el.style.border = '4px solid rgba(255,255,255,0.3)';
    el.style.fontSize = '0';
  } else if (item.renderType === 'text') {
    el.textContent = item.display;
    el.style.color = 'white';
    el.style.fontWeight = '700';
  } else {
    el.textContent = item.display;
  }

  const padding = 100;
  const x = padding + Math.random() * (window.innerWidth - padding * 2 - 150);
  const y = padding + Math.random() * (window.innerHeight - padding * 2 - 150);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;

  document.getElementById('play-area')!.appendChild(el);

  let duration = 3000;
  if (item.sound) {
    const audio = new Audio(`${item.sound.filename}.mp3`);
    audio.volume = 0.7;
    audio.play().catch(() => {});
    duration = (item.sound.duration || 3) * 1000;
    audio.addEventListener('ended', () => fadeOutEmoji(el));
  }

  setTimeout(() => fadeOutEmoji(el), duration + 500);
}

function fadeOutEmoji(emoji: HTMLElement): void {
  if (emoji.classList.contains('fading')) return;
  emoji.classList.add('fading');
  setTimeout(() => {
    if (emoji.parentNode) emoji.parentNode.removeChild(emoji);
  }, 500);
}

async function handleTouchButton(index: number): Promise<void> {
  const btn = document.querySelector(`.touch-btn[data-index="${index}"]`) as HTMLElement | null;
  const item = buttonItems[index];
  if (!btn || !item) return;

  if (btn.classList.contains('charging')) return;

  speakText(item.name);

  btn.classList.add('charging');

  let audio: HTMLAudioElement | null = null;
  if (item.sound) {
    audio = new Audio();
    audio.volume = 0.7;
    audio.preload = 'auto';

    const audioReady = new Promise<void>((resolve) => {
      audio!.addEventListener('canplaythrough', () => resolve(), { once: true });
      audio!.addEventListener('error', () => resolve(), { once: true });
      setTimeout(resolve, 500);
    });

    audio.src = `${item.sound.filename}.mp3`;
    await audioReady;

    try {
      await audio.play();
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 30));
  } else {
    await new Promise((r) => setTimeout(r, 400));
  }

  btn.classList.remove('charging');
  btn.classList.add('fading');

  const duration = item.sound ? (item.sound.duration || 3) * 1000 : 1500;

  let replaced = false;
  const replaceItem = () => {
    if (replaced) return;
    replaced = true;
    initTouchButton(index);
    requestAnimationFrame(() => {
      btn.classList.remove('fading');
    });
  };

  if (audio) {
    audio.addEventListener('ended', replaceItem, { once: true });
  }
  setTimeout(replaceItem, duration + 500);
}

async function startPlaying(): Promise<void> {
  if (isMobile) await enterFullscreen();

  document.getElementById('start-screen')!.style.display = 'none';

  if (isMobile) {
    buildTouchGrid();
    document.getElementById('touch-grid')!.style.display = 'grid';
  } else {
    document.getElementById('play-area')!.style.display = 'block';
  }

  isPlaying = true;
  document.body.focus();
}

function stopPlaying(): void {
  if (isMobile) exitFullscreen();
  document.getElementById('start-screen')!.style.display = 'block';
  document.getElementById('play-area')!.style.display = 'none';
  document.getElementById('touch-grid')!.style.display = 'none';
  isPlaying = false;
}

export async function initFreePlay(): Promise<void> {
  sounds = await loadSounds();

  document.getElementById('start-btn')!.addEventListener('click', startPlaying);

  document.addEventListener(
    'keydown',
    (e) => {
      if (!isPlaying && e.key !== 'Escape' && document.getElementById('start-screen')!.style.display !== 'none') {
        startPlaying();
      }
    },
    { once: false },
  );

  // Desktop keypress triggers random sound
  document.addEventListener(
    'keydown',
    (e) => {
      if (!isPlaying || e.key === 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      playSoundDesktop(getRandomItem());
    },
    true,
  );

  setupEscapeHold(
    () => isPlaying,
    () => stopPlaying(),
  );
  setupFullscreenExit(
    () => isPlaying,
    () => stopPlaying(),
  );
  preventContextMenu(() => isPlaying);

  document.addEventListener(
    'keydown',
    (e) => {
      if (isPlaying && (e.ctrlKey || e.altKey || e.metaKey)) {
        e.preventDefault();
      }
    },
    true,
  );
}
