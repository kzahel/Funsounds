import type { SoundEntry } from './types';
import {
  isMobile,
  shuffle,
  speakText,
  loadSounds,
  enterFullscreen,
  exitFullscreen,
  spawnConfetti,
  playCheer,
  setupEscapeHold,
  setupFullscreenExit,
  preventContextMenu,
} from './utils';

let sounds: SoundEntry[] = [];
let memoryActive = false;

interface CardData {
  pairIndex: number;
  emoji: string;
  name: string;
  filename: string;
}

interface FlippedCard {
  el: HTMLElement;
  idx: number;
  card: CardData;
}

let cards: CardData[] = [];
let flippedCards: FlippedCard[] = [];
let matchedCount = 0;
let totalPairs = 0;
let locked = false;
let playerCount = 1;
let currentPlayer = 1;
let scores = [0, 0];

const GRID_CONFIG: Record<number, { cols: number; rows: number; pairs: number }> = {
  1: { cols: 4, rows: 3, pairs: 6 },
  2: { cols: 4, rows: 4, pairs: 8 },
  3: { cols: 6, rows: 5, pairs: 15 },
};
const MISMATCH_DISPLAY_TIME = 2000;

function getDifficulty(): number {
  const slider = document.getElementById('difficulty-slider') as HTMLInputElement | null;
  return slider ? parseInt(slider.value) : 2;
}

function getPlayerCount(): number {
  const sel = document.querySelector('.player-btn.selected') as HTMLElement | null;
  return sel ? parseInt(sel.dataset.players ?? '1') : 1;
}

function updatePlayerDisplay(): void {
  const p1 = document.getElementById('memory-p1')!;
  const p2 = document.getElementById('memory-p2')!;
  p1.classList.toggle('active', currentPlayer === 1);
  if (playerCount === 2) {
    p2.style.display = '';
    p2.classList.toggle('active', currentPlayer === 2);
  } else {
    p2.style.display = 'none';
  }
}

function updateScoreDisplay(): void {
  document.querySelector('#memory-p1 .player-score')!.textContent = String(scores[0]);
  document.querySelector('#memory-p2 .player-score')!.textContent = String(scores[1]);
}

function buildGame(): void {
  const diff = Math.min(getDifficulty(), 3);
  const config = GRID_CONFIG[diff];
  totalPairs = config.pairs;
  matchedCount = 0;
  currentPlayer = 1;
  scores = [0, 0];
  locked = false;
  flippedCards = [];

  playerCount = getPlayerCount();

  const picked = shuffle(sounds).slice(0, config.pairs);

  const cardData: CardData[] = [];
  picked.forEach((s, i) => {
    cardData.push({ pairIndex: i, emoji: s.emoji, name: s.name, filename: s.filename });
    cardData.push({ pairIndex: i, emoji: s.emoji, name: s.name, filename: s.filename });
  });
  cards = shuffle(cardData);

  const grid = document.getElementById('memory-grid')!;
  grid.innerHTML = '';
  grid.className = '';
  grid.style.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${config.rows}, 1fr)`;

  if (config.pairs >= 15) {
    grid.classList.add('grid-small');
  }

  cards.forEach((card, idx) => {
    const el = document.createElement('div');
    el.className = 'memory-card';
    el.dataset.index = String(idx);
    el.dataset.pairIndex = String(card.pairIndex);
    el.innerHTML =
      '<div class="card-inner">' +
      '<div class="card-front">?</div>' +
      '<div class="card-back"><span class="emoji">' +
      card.emoji +
      '</span></div>' +
      '</div>';

    el.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        handleCardTap(el, idx);
      },
      { passive: false },
    );
    el.addEventListener('click', (e) => {
      e.preventDefault();
      handleCardTap(el, idx);
    });
    grid.appendChild(el);
  });

  updatePlayerDisplay();
  updateScoreDisplay();
}

function handleCardTap(el: HTMLElement, idx: number): void {
  if (locked) return;
  if (el.classList.contains('flipped')) return;
  if (el.classList.contains('matched')) return;

  el.classList.add('flipped');
  flippedCards.push({ el, idx, card: cards[idx] });

  if (flippedCards.length === 2) {
    locked = true;
    const [a, b] = flippedCards;

    if (a.card.pairIndex === b.card.pairIndex) {
      a.el.classList.add('matched');
      b.el.classList.add('matched');
      matchedCount++;
      scores[currentPlayer - 1]++;
      updateScoreDisplay();

      speakText(a.card.name, { rate: 1.0, pitch: 1.3 });

      const audio = new Audio(`${a.card.filename}.mp3`);
      audio.volume = 0.6;
      audio.play().catch(() => {});

      flippedCards = [];
      locked = false;

      if (matchedCount === totalPairs) {
        setTimeout(celebrateWin, 1000);
      }
    } else {
      setTimeout(() => {
        a.el.classList.remove('flipped');
        b.el.classList.remove('flipped');
        flippedCards = [];

        if (playerCount === 2) {
          currentPlayer = currentPlayer === 1 ? 2 : 1;
          updatePlayerDisplay();
        }
        locked = false;
      }, MISMATCH_DISPLAY_TIME);
    }
  }
}

function celebrateWin(): void {
  spawnConfetti(document.getElementById('memory-screen')!);
  playCheer();

  let msg: string;
  if (playerCount === 1) {
    msg = 'You win!';
  } else if (scores[0] > scores[1]) {
    msg = 'Player 1 wins!';
  } else if (scores[1] > scores[0]) {
    msg = 'Player 2 wins!';
  } else {
    msg = "It's a tie!";
  }
  speakText(msg, { rate: 1.0, pitch: 1.3 });

  setTimeout(() => {
    spawnConfetti(document.getElementById('memory-screen')!);
    speakText('Great job!', { rate: 1.0, pitch: 1.3 });
  }, 1500);

  setTimeout(() => {
    if (isMobile) exitFullscreen();
    stopMemory();
  }, 4500);
}

async function startMemory(): Promise<void> {
  if (isMobile) await enterFullscreen();

  document.getElementById('start-screen')!.style.display = 'none';
  document.getElementById('memory-screen')!.style.display = 'flex';
  memoryActive = true;

  speechSynthesis.getVoices();
  buildGame();
}

function stopMemory(): void {
  speechSynthesis.cancel();
  document.getElementById('start-screen')!.style.display = 'block';
  document.getElementById('memory-screen')!.style.display = 'none';
  memoryActive = false;
}

export async function initMemory(): Promise<void> {
  sounds = await loadSounds();

  document.getElementById('memory-btn')!.addEventListener('click', startMemory);

  document.querySelectorAll('.player-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector('.player-btn.selected')?.classList.remove('selected');
      btn.classList.add('selected');
    });
  });

  setupEscapeHold(
    () => memoryActive,
    () => {
      if (isMobile) exitFullscreen();
      stopMemory();
    },
  );
  setupFullscreenExit(
    () => memoryActive,
    () => stopMemory(),
  );
  preventContextMenu(() => memoryActive);
}
