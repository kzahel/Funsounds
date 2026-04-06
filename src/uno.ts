import {
  shuffle, pickRandom, loadSounds, speakText, playCheer, spawnConfetti,
  setupEscapeHold, setupFullscreenExit, preventContextMenu,
  enterFullscreen, isMobile,
} from './utils';
import type { SoundEntry } from './types';

// === Types ===

type CardColor = 'red' | 'yellow' | 'green' | 'blue';
type WildColor = CardColor | 'wild';
type CardValue = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'skip'|'reverse'|'draw2'|'wild'|'wild4';

interface UnoCard {
  id: number;
  color: WildColor;
  value: CardValue;
  emoji?: string;
}

interface UnoPlayer {
  name: string;
  hand: UnoCard[];
  isHuman: boolean;
  calledUno: boolean;
}

type Ruleset = 'beginner' | 'intermediate';
type Theme = 'classic' | 'emoji';

// === State ===

let players: UnoPlayer[] = [];
let drawPile: UnoCard[] = [];
let discardPile: UnoCard[] = [];
let currentPlayerIdx = 0;
let direction: 1 | -1 = 1;
let currentColor: CardColor = 'red';
let pendingDraw = 0;
let pendingSkip = false;
let ruleset: Ruleset = 'beginner';
let theme: Theme = 'classic';
let gameActive = false;
let gameOver = false;
let showAiHands = false;
let nextCardId = 0;
let sounds: SoundEntry[] = [];
let emojiValues: string[] = [];
let unoTimerId: number | null = null;
let unoDeadline = 0;
let unoRafId = 0;
let animating = false;
let humanIndex = 0;
let aiCount = 1;
let awaitingColorPick = false;
let pendingWildCard: UnoCard | null = null;

// === Constants ===

const COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue'];
const NUMBER_VALUES: CardValue[] = ['0','1','2','3','4','5','6','7','8','9'];
const ACTION_VALUES: CardValue[] = ['skip', 'reverse', 'draw2'];
const UNO_TIMER_MS = 3000;
const AI_THINK_MS = 800;
const ANIM_MS = 350;

const CARD_DISPLAY: Record<string, string> = {
  skip: '⊘', reverse: '⟲', draw2: '+2', wild: '★', wild4: '+4',
};

const COLOR_HEX: Record<string, string> = {
  red: '#e53e3e', yellow: '#ecc94b', green: '#38a169', blue: '#3182ce',
};

const AI_NAMES = ['Bot A', 'Bot B', 'Bot C'];

// === Deck ===

function createDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  nextCardId = 0;

  // Pick 10 random emojis for emoji theme
  if (sounds.length >= 10) {
    emojiValues = shuffle(sounds.map(s => s.emoji)).slice(0, 10);
  } else {
    emojiValues = ['🐕','🐱','🐸','🦁','🐘','🎸','🚀','⭐','🌈','🎵'];
  }

  function emojiFor(value: CardValue): string | undefined {
    if (theme !== 'emoji') return undefined;
    const idx = NUMBER_VALUES.indexOf(value);
    if (idx >= 0) return emojiValues[idx];
    if (value === 'skip') return '🚫';
    if (value === 'reverse') return '🔄';
    if (value === 'draw2') return '💥';
    if (value === 'wild') return '🌈';
    if (value === 'wild4') return '🌪️';
    return undefined;
  }

  for (const color of COLORS) {
    deck.push({ id: nextCardId++, color, value: '0', emoji: emojiFor('0') });
    for (let n = 1; n <= 9; n++) {
      const v = `${n}` as CardValue;
      deck.push({ id: nextCardId++, color, value: v, emoji: emojiFor(v) });
      deck.push({ id: nextCardId++, color, value: v, emoji: emojiFor(v) });
    }
    for (const action of ACTION_VALUES) {
      deck.push({ id: nextCardId++, color, value: action, emoji: emojiFor(action) });
      deck.push({ id: nextCardId++, color, value: action, emoji: emojiFor(action) });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: nextCardId++, color: 'wild', value: 'wild', emoji: emojiFor('wild') });
    deck.push({ id: nextCardId++, color: 'wild', value: 'wild4', emoji: emojiFor('wild4') });
  }

  return shuffle(deck);
}

function reshuffleDiscard(): void {
  if (discardPile.length <= 1) return;
  const top = discardPile.pop()!;
  const rest = discardPile.splice(0);
  drawPile.push(...shuffle(rest));
  discardPile.push(top);
}

function drawFromPile(): UnoCard | null {
  if (drawPile.length === 0) reshuffleDiscard();
  return drawPile.length > 0 ? drawPile.pop()! : null;
}

// === Card Logic ===

function canPlayCard(card: UnoCard): boolean {
  if (gameOver || animating || awaitingColorPick) return false;
  const top = discardPile[discardPile.length - 1];
  if (!top) return true;

  if (pendingDraw > 0) {
    if (ruleset === 'intermediate') {
      if (top.value === 'draw2' && card.value === 'draw2') return true;
      if (top.value === 'wild4' && card.value === 'wild4') return true;
    }
    return false;
  }

  if (pendingSkip) {
    if (ruleset === 'intermediate' && card.value === 'skip') return true;
    return false;
  }

  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.value === top.value) return true;
  return false;
}

function hasPlayableCard(hand: UnoCard[]): boolean {
  return hand.some(c => canPlayCard(c));
}

// === Card HTML ===

function cardDisplayVal(card: UnoCard): string {
  if (theme === 'emoji' && card.emoji) return card.emoji;
  return CARD_DISPLAY[card.value] ?? card.value;
}

function cardHtml(card: UnoCard, faceUp = true, extra = ''): string {
  if (!faceUp) {
    return `<div class="uno-card uno-back ${extra}"><span class="uno-card-val">UNO</span></div>`;
  }
  const cc = card.color === 'wild' ? 'wild' : card.color;
  const val = cardDisplayVal(card);
  const isEmoji = theme === 'emoji' && card.emoji;
  const emojiClass = isEmoji ? ' emoji-val' : '';
  return `<div class="uno-card ${cc}${emojiClass} ${extra}" data-card-id="${card.id}">` +
    `<span class="uno-card-tl">${val}</span>` +
    `<span class="uno-card-val">${val}</span>` +
    `<span class="uno-card-br">${val}</span>` +
    `</div>`;
}

// === Animation ===

function animateCardMove(
  html: string,
  fromRect: DOMRect,
  toRect: DOMRect,
  duration = ANIM_MS,
  flip = false,
): Promise<void> {
  return new Promise(resolve => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const el = wrapper.firstElementChild as HTMLElement;
    el.style.position = 'fixed';
    el.style.left = fromRect.left + 'px';
    el.style.top = fromRect.top + 'px';
    el.style.width = fromRect.width + 'px';
    el.style.height = fromRect.height + 'px';
    el.style.zIndex = '5000';
    el.style.transition = `all ${duration}ms cubic-bezier(.4,.0,.2,1)`;
    el.style.pointerEvents = 'none';
    if (flip) {
      el.style.transform = 'rotateY(180deg)';
    }
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.left = toRect.left + 'px';
        el.style.top = toRect.top + 'px';
        el.style.width = toRect.width + 'px';
        el.style.height = toRect.height + 'px';
        if (flip) el.style.transform = 'rotateY(0deg)';
      });
    });

    const cleanup = () => { el.remove(); resolve(); };
    el.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, duration + 50);
  });
}

function getRect(selector: string): DOMRect {
  const el = document.querySelector(selector);
  if (el) return el.getBoundingClientRect();
  return new DOMRect(window.innerWidth / 2 - 35, window.innerHeight / 2 - 52, 70, 105);
}

function flashMessage(text: string, color = '#fff'): void {
  const el = document.createElement('div');
  el.className = 'uno-flash';
  el.textContent = text;
  el.style.color = color;
  const screen = document.getElementById('uno-screen')!;
  screen.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// === Rendering ===

function render(): void {
  renderAiArea();
  renderCenter();
  renderHand();
  renderStatus();
}

function renderAiArea(): void {
  const area = document.getElementById('uno-ai-area')!;
  let html = '';
  for (let i = 0; i < players.length; i++) {
    if (i === humanIndex) continue;
    const p = players[i];
    const isActive = i === currentPlayerIdx && !gameOver;
    const activeClass = isActive ? ' active' : '';
    html += `<div class="uno-ai-player${activeClass}">`;
    html += `<span class="uno-ai-name">${p.name}</span>`;
    html += `<span class="uno-ai-count">${p.hand.length} card${p.hand.length !== 1 ? 's' : ''}</span>`;
    html += `<div class="uno-ai-cards">`;
    for (let j = 0; j < Math.min(p.hand.length, 15); j++) {
      html += cardHtml(p.hand[j], showAiHands, 'uno-mini');
    }
    if (p.hand.length > 15) html += `<span class="uno-ai-more">+${p.hand.length - 15}</span>`;
    html += `</div></div>`;
  }
  area.innerHTML = html;
}

function renderCenter(): void {
  const drawEl = document.getElementById('uno-draw-pile')!;
  const discardEl = document.getElementById('uno-discard-area')!;
  const colorEl = document.getElementById('uno-color-indicator')!;
  const dirEl = document.getElementById('uno-direction')!;

  // Draw pile
  const isHumanTurn = currentPlayerIdx === humanIndex && !gameOver && !animating && !awaitingColorPick;
  const mustDraw = isHumanTurn && pendingDraw > 0 && !hasPlayableCard(players[humanIndex].hand);
  const canVoluntaryDraw = isHumanTurn && pendingDraw === 0 && !pendingSkip && !hasPlayableCard(players[humanIndex].hand);
  const drawClass = mustDraw || canVoluntaryDraw ? ' drawable' : '';
  drawEl.innerHTML = `<div class="uno-card uno-back uno-pile-card${drawClass}">` +
    `<span class="uno-card-val">UNO</span>` +
    `<span class="uno-pile-count">${drawPile.length}</span></div>`;

  // Discard pile
  if (discardPile.length > 0) {
    const top = discardPile[discardPile.length - 1];
    discardEl.innerHTML = cardHtml(top, true, 'uno-pile-card');
  } else {
    discardEl.innerHTML = '<div class="uno-card uno-empty uno-pile-card"></div>';
  }

  // Current color
  colorEl.innerHTML = `<div class="uno-color-dot" style="background:${COLOR_HEX[currentColor]}"></div>`;

  // Direction
  dirEl.textContent = direction === 1 ? '→' : '←';
}

function renderHand(): void {
  const handEl = document.getElementById('uno-hand')!;
  const human = players[humanIndex];
  if (!human) return;
  const isMyTurn = currentPlayerIdx === humanIndex && !gameOver && !animating;
  let html = '';
  for (const card of human.hand) {
    const playable = isMyTurn && canPlayCard(card) && !awaitingColorPick;
    const cls = playable ? ' playable' : (isMyTurn && !awaitingColorPick ? ' dimmed' : '');
    html += cardHtml(card, true, `uno-hand-card${cls}`);
  }
  handEl.innerHTML = html;
}

function renderStatus(): void {
  const el = document.getElementById('uno-status')!;
  if (gameOver) {
    el.textContent = '';
    return;
  }
  if (animating) {
    el.textContent = players[currentPlayerIdx].name + '...';
    return;
  }
  if (currentPlayerIdx === humanIndex) {
    if (awaitingColorPick) {
      el.textContent = 'Pick a color!';
    } else if (pendingDraw > 0 && ruleset === 'beginner') {
      el.textContent = `You must draw ${pendingDraw} cards! Tap the draw pile.`;
    } else if (pendingDraw > 0 && ruleset === 'intermediate') {
      const stackable = players[humanIndex].hand.some(c => canPlayCard(c));
      el.textContent = stackable
        ? `+${pendingDraw} incoming! Stack or tap draw pile.`
        : `You must draw ${pendingDraw} cards! Tap the draw pile.`;
    } else if (pendingSkip && ruleset === 'beginner') {
      el.textContent = 'You are skipped!';
    } else if (pendingSkip && ruleset === 'intermediate') {
      const canDeflect = players[humanIndex].hand.some(c => c.value === 'skip');
      el.textContent = canDeflect
        ? 'Play a Skip to deflect, or get skipped!'
        : 'You are skipped!';
    } else if (hasPlayableCard(players[humanIndex].hand)) {
      el.textContent = 'Your turn! Play a card.';
    } else {
      el.textContent = 'No playable card. Tap the draw pile.';
    }
  } else {
    el.textContent = `${players[currentPlayerIdx].name} is thinking...`;
  }
}

// === Color Picker ===

function showColorPicker(): Promise<CardColor> {
  return new Promise(resolve => {
    awaitingColorPick = true;
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
      awaitingColorPick = false;
      resolve(btn.dataset.color as CardColor);
    }
    picker.addEventListener('click', pick);
  });
}

// === Uno Button ===

function startUnoTimer(): void {
  clearUnoTimer();
  const btn = document.getElementById('uno-uno-btn')!;
  btn.style.display = 'flex';
  unoDeadline = Date.now() + UNO_TIMER_MS;

  function tick() {
    const remaining = Math.max(0, unoDeadline - Date.now());
    const pct = remaining / UNO_TIMER_MS;
    const ring = btn.querySelector('.uno-timer-ring') as SVGCircleElement;
    if (ring) {
      ring.style.strokeDashoffset = `${(1 - pct) * 188}`;
    }
    if (remaining <= 0) {
      onUnoTimeout();
      return;
    }
    unoRafId = requestAnimationFrame(tick);
  }

  btn.innerHTML = `<svg class="uno-timer-svg" viewBox="0 0 64 64">` +
    `<circle class="uno-timer-bg" cx="32" cy="32" r="30"/>` +
    `<circle class="uno-timer-ring" cx="32" cy="32" r="30"/>` +
    `</svg><span class="uno-timer-text">UNO!</span>`;

  unoRafId = requestAnimationFrame(tick);
}

function clearUnoTimer(): void {
  if (unoTimerId) { clearTimeout(unoTimerId); unoTimerId = null; }
  cancelAnimationFrame(unoRafId);
  const btn = document.getElementById('uno-uno-btn')!;
  btn.style.display = 'none';
}

function onUnoCalled(): void {
  const human = players[humanIndex];
  human.calledUno = true;
  clearUnoTimer();
  speakText('UNO!', { rate: 1.2, pitch: 1.5 });
  flashMessage('UNO!', '#ffd93d');
}

function onUnoTimeout(): void {
  clearUnoTimer();
  const human = players[humanIndex];
  human.calledUno = false;
  // Penalty: draw 1
  const card = drawFromPile();
  if (card) {
    human.hand.push(card);
    flashMessage('Forgot UNO! +1 penalty', '#e53e3e');
  }
  render();
}

// === Game Flow ===

async function startGame(): Promise<void> {
  const deck = createDeck();
  direction = 1;
  pendingDraw = 0;
  pendingSkip = false;
  gameOver = false;
  animating = false;
  awaitingColorPick = false;
  pendingWildCard = null;
  clearUnoTimer();

  // Create players
  humanIndex = 0;
  players = [{ name: 'You', hand: [], isHuman: true, calledUno: false }];
  for (let i = 0; i < aiCount; i++) {
    players.push({ name: AI_NAMES[i], hand: [], isHuman: false, calledUno: false });
  }

  drawPile = deck;
  discardPile = [];

  // Show game screen
  document.getElementById('start-screen')!.style.display = 'none';
  const screen = document.getElementById('uno-screen')!;
  screen.style.display = 'flex';
  if (isMobile) enterFullscreen();

  render();

  // Deal 7 cards each with animation
  animating = true;
  for (let round = 0; round < 7; round++) {
    for (let p = 0; p < players.length; p++) {
      const card = drawFromPile();
      if (!card) continue;
      players[p].hand.push(card);
    }
    render();
    await delay(80);
  }

  // Flip starting card (avoid starting with wild4)
  let startCard = drawFromPile()!;
  while (startCard.value === 'wild4') {
    drawPile.unshift(startCard);
    drawPile = shuffle(drawPile);
    startCard = drawFromPile()!;
  }
  discardPile.push(startCard);
  currentColor = startCard.color === 'wild' ? pickRandom(COLORS) : startCard.color as CardColor;

  // Apply starting card effects
  currentPlayerIdx = 0;
  if (startCard.value === 'skip') {
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
  } else if (startCard.value === 'reverse') {
    direction = -1;
    if (players.length === 2) currentPlayerIdx = nextPlayer(currentPlayerIdx);
  } else if (startCard.value === 'draw2') {
    pendingDraw = 2;
  }

  animating = false;
  render();

  // Start first turn
  await runTurn();
}

function nextPlayer(from: number): number {
  return (from + direction + players.length) % players.length;
}

async function runTurn(): Promise<void> {
  if (gameOver) return;
  render();

  const player = players[currentPlayerIdx];

  // Handle pending skip
  if (pendingSkip) {
    if (ruleset === 'intermediate' && player.hand.some(c => c.value === 'skip')) {
      // Player can deflect - if AI, always deflect
      if (!player.isHuman) {
        await delay(AI_THINK_MS);
        const skipCard = player.hand.find(c => c.value === 'skip')!;
        await executePlay(currentPlayerIdx, skipCard);
        pendingSkip = true; // stays pending for next player
        currentPlayerIdx = nextPlayer(currentPlayerIdx);
        await runTurn();
        return;
      }
      // Human will handle via card click
      render();
      return;
    }
    // Can't deflect - skip this player
    pendingSkip = false;
    flashMessage(`${player.name} skipped!`, '#ff6b9d');
    await delay(800);
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
    await runTurn();
    return;
  }

  // Handle pending draw in beginner mode for AI
  if (pendingDraw > 0 && !player.isHuman && ruleset === 'beginner') {
    await delay(AI_THINK_MS);
    await executeDrawPending(currentPlayerIdx);
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
    await runTurn();
    return;
  }

  // AI turn
  if (!player.isHuman) {
    await aiTurn(currentPlayerIdx);
    return;
  }

  // Handle pending draw for human in beginner (must draw, no stacking)
  if (pendingDraw > 0 && ruleset === 'beginner') {
    // Human sees status message, clicks draw pile to draw
    render();
    return;
  }

  // Human turn - wait for interaction (handled by click events)
  render();
}

async function executePlay(playerIdx: number, card: UnoCard): Promise<void> {
  animating = true;
  const player = players[playerIdx];
  const cardIdx = player.hand.findIndex(c => c.id === card.id);
  if (cardIdx < 0) { animating = false; return; }

  player.hand.splice(cardIdx, 1);

  // Animate card to discard
  const fromEl = document.querySelector(`[data-card-id="${card.id}"]`);
  const fromRect = fromEl ? fromEl.getBoundingClientRect() : getRect('#uno-hand');
  render(); // Remove card from hand visually

  const toRect = getRect('#uno-discard-area .uno-pile-card') || getRect('#uno-discard-area');

  const h = cardHtml(card, true, 'uno-flying');
  await animateCardMove(h, fromRect, toRect, ANIM_MS);

  discardPile.push(card);
  if (card.color !== 'wild') {
    currentColor = card.color as CardColor;
  }
  animating = false;
  render();
}

async function executeDrawPending(playerIdx: number): Promise<void> {
  animating = true;
  const player = players[playerIdx];
  const count = pendingDraw;
  pendingDraw = 0;

  for (let i = 0; i < count; i++) {
    const card = drawFromPile();
    if (!card) break;
    player.hand.push(card);
  }
  flashMessage(`${player.name} draws ${count}!`, '#ff6b9d');
  animating = false;
  render();
  await delay(600);
}

async function executeDrawOne(playerIdx: number): Promise<void> {
  animating = true;
  const player = players[playerIdx];
  const card = drawFromPile();
  if (card) {
    player.hand.push(card);
    // Animate
    const fromRect = getRect('#uno-draw-pile .uno-pile-card');
    render();
    if (player.isHuman) {
      const toRect = getRect('#uno-hand');
      await animateCardMove(cardHtml(card, true, 'uno-flying'), fromRect, toRect, ANIM_MS, true);
    } else {
      const aiEls = document.querySelectorAll('.uno-ai-player');
      const aiIdx = playerIdx > humanIndex ? playerIdx - 1 : playerIdx;
      const toRect = aiEls[aiIdx]?.getBoundingClientRect() ?? fromRect;
      await animateCardMove(cardHtml(card, false, 'uno-flying'), fromRect, toRect, ANIM_MS);
    }
  }
  animating = false;
  render();
}

function applyEffects(card: UnoCard): void {
  switch (card.value) {
    case 'reverse':
      direction = (direction === 1 ? -1 : 1) as 1 | -1;
      if (players.length === 2) {
        // Acts as skip in 2-player
        currentPlayerIdx = nextPlayer(currentPlayerIdx);
      }
      flashMessage(direction === 1 ? '→ Reversed!' : '← Reversed!', '#c084fc');
      break;
    case 'skip':
      if (ruleset === 'intermediate') {
        pendingSkip = true;
      } else {
        currentPlayerIdx = nextPlayer(currentPlayerIdx);
        flashMessage('Skip!', '#ff6b9d');
      }
      break;
    case 'draw2':
      pendingDraw += 2;
      break;
    case 'wild4':
      pendingDraw += 4;
      break;
  }
}

function checkWin(playerIdx: number): boolean {
  if (players[playerIdx].hand.length === 0) {
    gameOver = true;
    render();
    showGameOver(playerIdx);
    return true;
  }
  return false;
}

function checkUno(playerIdx: number): void {
  const player = players[playerIdx];
  if (player.hand.length === 1) {
    if (player.isHuman) {
      player.calledUno = false;
      startUnoTimer();
    } else {
      // AI always calls uno
      player.calledUno = true;
      flashMessage(`${player.name}: UNO!`, '#ffd93d');
    }
  }
}

async function humanPlay(card: UnoCard): Promise<void> {
  if (animating || gameOver || currentPlayerIdx !== humanIndex) return;
  if (!canPlayCard(card)) return;

  clearUnoTimer();

  // Handle wild color pick
  if (card.color === 'wild') {
    await executePlay(humanIndex, card);
    const color = await showColorPicker();
    currentColor = color;
    applyEffects(card);
    render();
    if (checkWin(humanIndex)) return;
    checkUno(humanIndex);
    await delay(300);
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
    await runTurn();
    return;
  }

  // Handle skip deflection
  if (pendingSkip && card.value === 'skip') {
    pendingSkip = false;
    await executePlay(humanIndex, card);
    pendingSkip = true;
    if (checkWin(humanIndex)) return;
    checkUno(humanIndex);
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
    await runTurn();
    return;
  }

  await executePlay(humanIndex, card);
  applyEffects(card);
  if (checkWin(humanIndex)) return;
  checkUno(humanIndex);
  await delay(300);
  currentPlayerIdx = nextPlayer(currentPlayerIdx);
  await runTurn();
}

async function humanDraw(): Promise<void> {
  if (animating || gameOver || currentPlayerIdx !== humanIndex || awaitingColorPick) return;

  // If pending draw, draw those cards
  if (pendingDraw > 0) {
    await executeDrawPending(humanIndex);
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
    await runTurn();
    return;
  }

  if (hasPlayableCard(players[humanIndex].hand)) return;

  await executeDrawOne(humanIndex);
  await delay(400);
  currentPlayerIdx = nextPlayer(currentPlayerIdx);
  await runTurn();
}

// === AI ===

async function aiTurn(playerIdx: number): Promise<void> {
  const player = players[playerIdx];
  await delay(AI_THINK_MS);

  // Handle pending draw
  if (pendingDraw > 0) {
    if (ruleset === 'intermediate') {
      // Try to stack
      const stackCard = player.hand.find(c => canPlayCard(c));
      if (stackCard) {
        await executePlay(playerIdx, stackCard);
        if (stackCard.color === 'wild') {
          currentColor = aiPickColor(playerIdx);
        }
        applyEffects(stackCard);
        if (checkWin(playerIdx)) return;
        checkUno(playerIdx);
        currentPlayerIdx = nextPlayer(currentPlayerIdx);
        await runTurn();
        return;
      }
    }
    await executeDrawPending(playerIdx);
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
    await runTurn();
    return;
  }

  // Find playable cards - greedy AI: play first playable, prefer action cards
  const playable = player.hand.filter(c => canPlayCard(c));
  if (playable.length > 0) {
    // Greedy: prefer highest value cards, then action cards
    // But keep it simple - just play the first one, maybe prefer non-wild
    const nonWild = playable.filter(c => c.color !== 'wild');
    const card = nonWild.length > 0 ? nonWild[0] : playable[0];

    await executePlay(playerIdx, card);
    if (card.color === 'wild') {
      currentColor = aiPickColor(playerIdx);
    }
    applyEffects(card);
    render();
    if (checkWin(playerIdx)) return;
    checkUno(playerIdx);
    await delay(400);
    currentPlayerIdx = nextPlayer(currentPlayerIdx);
    await runTurn();
    return;
  }

  // No playable card - draw one
  await executeDrawOne(playerIdx);
  await delay(400);
  currentPlayerIdx = nextPlayer(currentPlayerIdx);
  await runTurn();
}

function aiPickColor(playerIdx: number): CardColor {
  const hand = players[playerIdx].hand;
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

// === Game Over ===

function showGameOver(winnerIdx: number): void {
  const overlay = document.getElementById('uno-game-over')!;
  const winner = players[winnerIdx];
  overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="uno-go-content">` +
    `<h2>${winner.isHuman ? 'You win!' : winner.name + ' wins!'}</h2>` +
    `<button class="uno-go-btn" id="uno-play-again">Play Again</button>` +
    `<button class="uno-go-btn uno-go-menu" id="uno-go-menu">Menu</button>` +
    `</div>`;

  if (winner.isHuman) {
    playCheer();
    spawnConfetti();
  }

  document.getElementById('uno-play-again')!.addEventListener('click', () => {
    overlay.style.display = 'none';
    startGame();
  });
  document.getElementById('uno-go-menu')!.addEventListener('click', () => {
    overlay.style.display = 'none';
    exitGame();
  });
}

function exitGame(): void {
  gameActive = false;
  gameOver = true;
  clearUnoTimer();
  document.getElementById('uno-screen')!.style.display = 'none';
  document.getElementById('start-screen')!.style.display = '';
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// === Event Handlers ===

function setupEvents(): void {
  const screen = document.getElementById('uno-screen')!;

  // Card click (hand)
  screen.addEventListener('click', (e) => {
    const cardEl = (e.target as HTMLElement).closest('.uno-hand-card[data-card-id]') as HTMLElement;
    if (cardEl) {
      const id = parseInt(cardEl.dataset.cardId!, 10);
      const card = players[humanIndex].hand.find(c => c.id === id);
      if (card) humanPlay(card);
      return;
    }

    // Draw pile click
    const drawEl = (e.target as HTMLElement).closest('#uno-draw-pile');
    if (drawEl) {
      humanDraw();
      return;
    }

    // Uno button click
    const unoBtn = (e.target as HTMLElement).closest('#uno-uno-btn');
    if (unoBtn) {
      onUnoCalled();
      return;
    }
  });

  // Escape to exit
  setupEscapeHold(() => gameActive, exitGame);
  setupFullscreenExit(() => gameActive, exitGame);
  preventContextMenu(() => gameActive);
}

// === Start Screen Config ===

function setupConfig(): void {
  // AI count buttons
  document.querySelectorAll('[data-ai-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ai-count]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      aiCount = parseInt((btn as HTMLElement).dataset.aiCount!, 10);
    });
  });

  // Theme buttons
  document.querySelectorAll('[data-uno-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-uno-theme]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      theme = (btn as HTMLElement).dataset.unoTheme as Theme;
    });
  });

  // Rules buttons
  document.querySelectorAll('[data-uno-rules]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-uno-rules]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      ruleset = (btn as HTMLElement).dataset.unoRules as Ruleset;
      showAiHands = ruleset === 'beginner';
    });
  });

  // Start button
  document.getElementById('uno-btn')!.addEventListener('click', () => {
    gameActive = true;
    showAiHands = ruleset === 'beginner';
    startGame();
  });
}

// === Init ===

export async function initUno(): Promise<void> {
  sounds = await loadSounds();
  setupConfig();
  setupEvents();
}
