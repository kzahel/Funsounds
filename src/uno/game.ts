import { shuffle, pickRandom, speakText, playCheer, spawnConfetti, isMobile, enterFullscreen } from '../utils';
import { state } from './state';
import { createDeck, drawFromPile, canPlayCard, hasPlayableCard } from './deck';
import {
  render, reconcileHand, renderAiArea, renderCenter, renderStatus,
  snapshotHand, flipAnimateHand, animateOverlay,
  cardHtml, flashMessage, getRect, isHumanTurnReady,
} from './renderer';
import {
  COLORS, AI_NAMES, ANIM_MS, AI_THINK_MS, delay,
  type CardColor, type CardValue, type UnoCard,
} from './types';

// ── Color Picker ──

export function showColorPicker(): Promise<CardColor> {
  const COLOR_HEX: Record<string, string> = {
    red: '#e53e3e', yellow: '#ecc94b', green: '#38a169', blue: '#3182ce',
  };
  return new Promise(resolve => {
    state.awaitingColorPick = true;
    render();
    const picker = document.getElementById('uno-color-picker')!;
    picker.style.display = 'flex';
    picker.innerHTML = COLORS.map(c =>
      `<button class="uno-cpick-btn" data-color="${c}" style="background:${COLOR_HEX[c]}"></button>`
    ).join('');

    function pick(e: Event) {
      const btn = (e.target as HTMLElement).closest('[data-color]') as HTMLElement;
      if (!btn) return;
      picker.removeEventListener('click', pick);
      picker.style.display = 'none';
      state.awaitingColorPick = false;
      resolve(btn.dataset.color as CardColor);
    }
    picker.addEventListener('click', pick);
  });
}

// ── UNO Timer ──

export function startUnoTimer(): void {
  clearUnoTimer();
  const btn = document.getElementById('uno-uno-btn')!;
  btn.style.display = 'flex';
  state.unoDeadline = Date.now() + 3000;

  function tick() {
    const remaining = Math.max(0, state.unoDeadline - Date.now());
    const pct = remaining / 3000;
    const ring = btn.querySelector('.uno-timer-ring') as SVGCircleElement;
    if (ring) ring.style.strokeDashoffset = `${(1 - pct) * 188}`;
    if (remaining <= 0) { onUnoTimeout(); return; }
    state.unoRafId = requestAnimationFrame(tick);
  }

  btn.innerHTML = `<svg class="uno-timer-svg" viewBox="0 0 64 64">` +
    `<circle class="uno-timer-bg" cx="32" cy="32" r="30"/>` +
    `<circle class="uno-timer-ring" cx="32" cy="32" r="30"/>` +
    `</svg><span class="uno-timer-text">UNO!</span>`;

  state.unoRafId = requestAnimationFrame(tick);
}

export function clearUnoTimer(): void {
  if (state.unoTimerId) { clearTimeout(state.unoTimerId); state.unoTimerId = null; }
  cancelAnimationFrame(state.unoRafId);
  document.getElementById('uno-uno-btn')!.style.display = 'none';
}

export function onUnoCalled(): void {
  state.players[state.humanIndex].calledUno = true;
  clearUnoTimer();
  speakText('UNO!', { rate: 1.2, pitch: 1.5 });
  flashMessage('UNO!', '#ffd93d');
}

function onUnoTimeout(): void {
  clearUnoTimer();
  const human = state.players[state.humanIndex];
  human.calledUno = false;
  const card = drawFromPile();
  if (card) {
    human.hand.push(card);
    flashMessage('Forgot UNO! +1 penalty', '#e53e3e');
  }
  render();
}

// ── Card Effects ──

function playCardSound(value: CardValue): void {
  switch (value) {
    case 'reverse': speakText('Reverse!', { rate: 1.1, pitch: 0.8 }); break;
    case 'skip': speakText('Skip!', { rate: 1.2, pitch: 1.3 }); break;
    case 'draw2': speakText('Plus two!', { rate: 1.1, pitch: 1.0 }); break;
    case 'wild': speakText('Wild card!', { rate: 1.0, pitch: 1.2 }); break;
    case 'wild4': speakText('Plus four!', { rate: 1.0, pitch: 0.9 }); break;
  }
}

function applyEffects(card: UnoCard): void {
  playCardSound(card.value);
  switch (card.value) {
    case 'reverse':
      state.direction = (state.direction === 1 ? -1 : 1) as 1 | -1;
      if (state.players.length === 2) {
        state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
      }
      flashMessage(state.direction === 1 ? '⟲ Reversed!' : '⟳ Reversed!', '#c084fc');
      break;
    case 'skip':
      if (state.ruleset === 'intermediate') {
        state.pendingSkip = true;
        flashMessage('Skip incoming!', '#ff6b9d');
      } else {
        state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
        flashMessage('⊘ Skip!', '#ff6b9d');
      }
      break;
    case 'draw2':
      state.pendingDraw += 2;
      flashMessage(`+${state.pendingDraw}!`, '#e53e3e');
      break;
    case 'wild4':
      state.pendingDraw += 4;
      flashMessage(`+${state.pendingDraw}!`, '#e53e3e');
      break;
  }
}

function checkWin(playerIdx: number): boolean {
  if (state.players[playerIdx].hand.length === 0) {
    state.gameOver = true;
    render();
    showGameOver(playerIdx);
    return true;
  }
  return false;
}

function checkUno(playerIdx: number): void {
  const player = state.players[playerIdx];
  if (player.hand.length === 1) {
    if (player.isHuman) {
      player.calledUno = false;
      startUnoTimer();
    } else {
      player.calledUno = true;
      flashMessage(`${player.name}: UNO!`, '#ffd93d');
    }
  }
}

function nextPlayer(from: number): number {
  return (from + state.direction + state.players.length) % state.players.length;
}

function aiPickColor(playerIdx: number): CardColor {
  const hand = state.players[playerIdx].hand;
  const counts: Record<string, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) {
    if (c.color !== 'wild') counts[c.color]++;
  }
  let best: CardColor = 'red';
  let max = -1;
  for (const color of COLORS) {
    if (counts[color] > max) { max = counts[color]; best = color; }
  }
  return best;
}

// ── Animated Actions ──

/**
 * Play a card: animate it from its position to the discard pile,
 * FLIP-animate remaining hand cards into their new positions.
 */
async function executePlay(playerIdx: number, card: UnoCard): Promise<void> {
  state.animating = true;
  const player = state.players[playerIdx];
  const cardIdx = player.hand.findIndex(c => c.id === card.id);
  if (cardIdx < 0) { state.animating = false; return; }

  // Get the card's current position before any DOM changes
  const fromEl = document.querySelector(`[data-card-id="${card.id}"]`);
  const fromRect = fromEl ? fromEl.getBoundingClientRect() : getRect('#uno-hand');
  const toRect = getRect('#uno-discard-area');

  // Snapshot hand positions before removal
  const before = snapshotHand();

  // Remove card from hand state
  player.hand.splice(cardIdx, 1);

  // Hide the source card immediately (it will be removed by reconcile)
  if (fromEl) (fromEl as HTMLElement).style.visibility = 'hidden';

  // Reconcile hand DOM (removed card disappears, others shift)
  reconcileHand();

  // Animate: overlay flies to discard + remaining cards slide into place
  await Promise.all([
    animateOverlay(cardHtml(card, true, 'uno-flying'), fromRect, toRect, ANIM_MS),
    flipAnimateHand(before, undefined, undefined, ANIM_MS),
  ]);

  state.discardPile.push(card);
  if (card.color !== 'wild') {
    state.currentColor = card.color as CardColor;
  }
  state.animating = false;
  render();
}

/**
 * Draw multiple pending cards with staggered FLIP animations.
 */
async function executeDrawPending(playerIdx: number): Promise<void> {
  state.animating = true;
  const player = state.players[playerIdx];
  const count = state.pendingDraw;
  state.pendingDraw = 0;

  speakText(`${player.name === 'You' ? 'You draw' : player.name + ' draws'} ${count}!`, { rate: 1.1, pitch: 1.2 });
  flashMessage(`${player.name} draws ${count}!`, '#ff6b9d');

  for (let i = 0; i < count; i++) {
    const card = drawFromPile();
    if (!card) break;

    const drawPileRect = getRect('#uno-draw-pile .uno-pile-card');

    if (player.isHuman) {
      // Snapshot → add card → reconcile → FLIP from draw pile
      const before = snapshotHand();
      player.hand.push(card);
      reconcileHand();
      renderCenter(); // update draw pile count
      await flipAnimateHand(before, new Set([card.id]), drawPileRect, 250);
    } else {
      player.hand.push(card);
      renderAiArea();
      renderCenter();
      // Animate overlay to AI area
      const aiEls = document.querySelectorAll('.uno-ai-player');
      const aiIdx = playerIdx > state.humanIndex ? playerIdx - 1 : playerIdx;
      const toRect = aiEls[aiIdx]?.getBoundingClientRect() ?? drawPileRect;
      await animateOverlay(cardHtml(card, false, 'uno-flying'), drawPileRect, toRect, 250);
    }
    await delay(100);
  }
  state.animating = false;
  render();
}

/**
 * Draw a single card with FLIP animation.
 */
async function executeDrawOne(playerIdx: number): Promise<void> {
  state.animating = true;
  const player = state.players[playerIdx];
  const card = drawFromPile();
  if (!card) { state.animating = false; render(); return; }

  const drawPileRect = getRect('#uno-draw-pile .uno-pile-card');

  if (player.isHuman) {
    const before = snapshotHand();
    player.hand.push(card);
    reconcileHand();
    renderCenter();
    await flipAnimateHand(before, new Set([card.id]), drawPileRect, ANIM_MS);
  } else {
    player.hand.push(card);
    renderAiArea();
    renderCenter();
    const aiEls = document.querySelectorAll('.uno-ai-player');
    const aiIdx = playerIdx > state.humanIndex ? playerIdx - 1 : playerIdx;
    const toRect = aiEls[aiIdx]?.getBoundingClientRect() ?? drawPileRect;
    await animateOverlay(cardHtml(card, false, 'uno-flying'), drawPileRect, toRect, ANIM_MS);
  }
  state.animating = false;
  render();
}

// ── Turn Flow ──

export async function startGame(): Promise<void> {
  const deck = createDeck();
  state.direction = 1;
  state.pendingDraw = 0;
  state.pendingSkip = false;
  state.gameOver = false;
  state.animating = false;
  state.turnLock = false;
  state.awaitingColorPick = false;
  state.hasDrawnThisTurn = false;
  state.pendingWildCard = null;
  clearUnoTimer();

  state.humanIndex = 0;
  state.players = [{ name: 'You', hand: [], isHuman: true, calledUno: false }];
  for (let i = 0; i < state.aiCount; i++) {
    state.players.push({ name: AI_NAMES[i], hand: [], isHuman: false, calledUno: false });
  }

  state.drawPile = deck;
  state.discardPile = [];

  document.getElementById('start-screen')!.style.display = 'none';
  const screen = document.getElementById('uno-screen')!;
  screen.style.display = 'flex';

  if (isMobile) enterFullscreen();

  render();

  // Deal 7 cards each with staggered FLIP animations
  state.animating = true;
  for (let round = 0; round < 7; round++) {
    const before = snapshotHand();
    const newIds = new Set<number>();
    for (let p = 0; p < state.players.length; p++) {
      const card = drawFromPile();
      if (!card) continue;
      state.players[p].hand.push(card);
      if (p === state.humanIndex) newIds.add(card.id);
    }
    renderAiArea();
    renderCenter();
    reconcileHand();
    const drawPileRect = getRect('#uno-draw-pile .uno-pile-card');
    await flipAnimateHand(before, newIds, drawPileRect, 200);
    await delay(60);
  }

  // Flip starting card
  let startCard = drawFromPile()!;
  while (startCard.value === 'wild4') {
    state.drawPile.unshift(startCard);
    state.drawPile = shuffle(state.drawPile);
    startCard = drawFromPile()!;
  }
  state.discardPile.push(startCard);
  state.currentColor = startCard.color === 'wild' ? pickRandom(COLORS) : startCard.color as CardColor;

  state.currentPlayerIdx = 0;
  if (startCard.value === 'skip') {
    state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
  } else if (startCard.value === 'reverse') {
    state.direction = -1;
    if (state.players.length === 2) state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
  } else if (startCard.value === 'draw2') {
    state.pendingDraw = 2;
  }

  state.animating = false;
  render();
  await runTurn();
}

async function runTurn(): Promise<void> {
  if (state.gameOver) return;
  render();

  const player = state.players[state.currentPlayerIdx];

  // Handle pending skip
  if (state.pendingSkip) {
    if (state.ruleset === 'intermediate' && player.hand.some(c => c.value === 'skip')) {
      if (!player.isHuman) {
        await delay(AI_THINK_MS);
        const skipCard = player.hand.find(c => c.value === 'skip')!;
        await executePlay(state.currentPlayerIdx, skipCard);
        state.pendingSkip = true;
        state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
        await runTurn();
        return;
      }
      render();
      return;
    }
    state.pendingSkip = false;
    flashMessage(`${player.name} skipped!`, '#ff6b9d');
    await delay(800);
    state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
    await runTurn();
    return;
  }

  // Handle pending draw in beginner mode for AI
  if (state.pendingDraw > 0 && !player.isHuman && state.ruleset === 'beginner') {
    await delay(AI_THINK_MS);
    await executeDrawPending(state.currentPlayerIdx);
  }

  // AI turn
  if (!player.isHuman) {
    await aiTurn(state.currentPlayerIdx);
    return;
  }

  // Human's turn
  state.turnLock = false;
  state.hasDrawnThisTurn = false;

  if (state.pendingDraw > 0 && state.ruleset === 'beginner') {
    render();
    return;
  }

  render();
}

async function aiTurn(playerIdx: number): Promise<void> {
  const player = state.players[playerIdx];
  await delay(AI_THINK_MS);

  if (state.pendingDraw > 0) {
    if (state.ruleset === 'intermediate') {
      const stackCard = player.hand.find(c => canPlayCard(c));
      if (stackCard) {
        await executePlay(playerIdx, stackCard);
        if (stackCard.color === 'wild') state.currentColor = aiPickColor(playerIdx);
        applyEffects(stackCard);
        if (checkWin(playerIdx)) return;
        checkUno(playerIdx);
        state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
        await runTurn();
        return;
      }
    }
    await executeDrawPending(playerIdx);
  }

  const playable = player.hand.filter(c => canPlayCard(c));
  if (playable.length > 0) {
    const nonWild = playable.filter(c => c.color !== 'wild');
    const card = nonWild.length > 0 ? nonWild[0] : playable[0];

    await executePlay(playerIdx, card);
    if (card.color === 'wild') state.currentColor = aiPickColor(playerIdx);
    applyEffects(card);
    if (checkWin(playerIdx)) return;
    checkUno(playerIdx);
    await delay(400);
    state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
    await runTurn();
    return;
  }

  await executeDrawOne(playerIdx);
  await delay(400);
  state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
  await runTurn();
}

export async function humanPlay(card: UnoCard): Promise<void> {
  if (state.turnLock || state.animating || state.gameOver || state.currentPlayerIdx !== state.humanIndex) return;
  if (!canPlayCard(card)) return;

  state.turnLock = true;
  clearUnoTimer();

  if (card.color === 'wild') {
    await executePlay(state.humanIndex, card);
    const color = await showColorPicker();
    state.currentColor = color;
    applyEffects(card);
    render();
    if (checkWin(state.humanIndex)) return;
    checkUno(state.humanIndex);
    await delay(300);
    state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
    await runTurn();
    return;
  }

  if (state.pendingSkip && card.value === 'skip') {
    state.pendingSkip = false;
    await executePlay(state.humanIndex, card);
    state.pendingSkip = true;
    if (checkWin(state.humanIndex)) return;
    checkUno(state.humanIndex);
    state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
    await runTurn();
    return;
  }

  await executePlay(state.humanIndex, card);
  applyEffects(card);
  if (checkWin(state.humanIndex)) return;
  checkUno(state.humanIndex);
  await delay(300);
  state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
  await runTurn();
}

export async function humanDraw(): Promise<void> {
  if (state.turnLock || state.animating || state.gameOver ||
      state.currentPlayerIdx !== state.humanIndex || state.awaitingColorPick) return;
  if (state.hasDrawnThisTurn) return;

  state.turnLock = true;

  if (state.pendingDraw > 0) {
    await executeDrawPending(state.humanIndex);
    state.hasDrawnThisTurn = true;
    state.turnLock = false;
    render();
    return;
  }

  await executeDrawOne(state.humanIndex);
  state.hasDrawnThisTurn = true;
  state.turnLock = false;
  render();
}

export function humanEndTurn(): void {
  if (state.turnLock || state.animating || state.gameOver ||
      state.currentPlayerIdx !== state.humanIndex) return;
  state.turnLock = true;
  state.currentPlayerIdx = nextPlayer(state.currentPlayerIdx);
  state.hasDrawnThisTurn = false;
  runTurn();
}

// ── Game Over ──

function showGameOver(winnerIdx: number): void {
  const overlay = document.getElementById('uno-game-over')!;
  const winner = state.players[winnerIdx];
  overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="uno-go-content">` +
    `<h2>${winner.isHuman ? 'You win!' : winner.name + ' wins!'}</h2>` +
    `<button class="uno-go-btn" id="uno-play-again">Play Again</button>` +
    `<button class="uno-go-btn uno-go-menu" id="uno-go-menu">Menu</button>` +
    `</div>`;

  if (winner.isHuman) { playCheer(); spawnConfetti(); }

  document.getElementById('uno-play-again')!.addEventListener('click', () => {
    overlay.style.display = 'none';
    startGame();
  });
  document.getElementById('uno-go-menu')!.addEventListener('click', () => {
    overlay.style.display = 'none';
    exitGame();
  });
}

export function exitGame(): void {
  state.gameActive = false;
  state.gameOver = true;
  clearUnoTimer();
  document.getElementById('uno-screen')!.style.display = 'none';
  document.getElementById('start-screen')!.style.display = '';
}
