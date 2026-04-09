import { state } from './state';
import { canPlayCard } from './deck';
import { ANIM_MS, CARD_DISPLAY, COLOR_HEX, type UnoCard } from './types';

// ── Card HTML ──

export function cardDisplayVal(card: UnoCard): string {
  if (state.theme === 'emoji' && card.emoji) return card.emoji;
  return CARD_DISPLAY[card.value] ?? card.value;
}

export function cardHtml(card: UnoCard, faceUp = true, extra = ''): string {
  if (!faceUp) {
    return `<div class="uno-card uno-back ${extra}"><span class="uno-card-val">UNO</span></div>`;
  }
  const cc = card.color === 'wild' ? 'wild' : card.color;
  const val = cardDisplayVal(card);
  const isEmoji = state.theme === 'emoji' && card.emoji;
  const emojiClass = isEmoji ? ' emoji-val' : '';
  return `<div class="uno-card ${cc}${emojiClass} ${extra}" data-card-id="${card.id}">` +
    `<span class="uno-card-tl">${val}</span>` +
    `<span class="uno-card-val">${val}</span>` +
    `<span class="uno-card-br">${val}</span>` +
    `</div>`;
}

function createCardElement(card: UnoCard, faceUp: boolean, extraClass: string): HTMLElement {
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(card, faceUp, extraClass);
  return tmp.firstElementChild as HTMLElement;
}

// ── FLIP Animation System ──
//
// FLIP = First, Last, Invert, Play
// 1. Snapshot current card positions (First)
// 2. Make DOM changes (add/remove cards)
// 3. Measure new positions (Last)
// 4. Apply inverse transforms so cards appear at old positions (Invert)
// 5. Animate to identity transform (Play)

export function snapshotHand(): Map<number, DOMRect> {
  const map = new Map<number, DOMRect>();
  const handEl = document.getElementById('uno-hand')!;
  for (const child of handEl.children) {
    const htmlEl = child as HTMLElement;
    const id = parseInt(htmlEl.dataset.cardId ?? '', 10);
    if (!isNaN(id)) map.set(id, htmlEl.getBoundingClientRect());
  }
  return map;
}

/** Reconcile hand DOM elements to match state, keyed by card ID. */
export function reconcileHand(): void {
  const handEl = document.getElementById('uno-hand')!;
  const wrapperEl = document.getElementById('uno-hand-wrapper')!;
  const human = state.players[state.humanIndex];
  if (!human) return;

  const isMyTurn = isHumanTurnReady();
  wrapperEl.classList.toggle('my-turn', isMyTurn);

  const desiredIds = new Set(human.hand.map(c => c.id));

  // Index existing DOM elements by card ID
  const existing = new Map<number, HTMLElement>();
  for (const child of Array.from(handEl.children)) {
    const htmlEl = child as HTMLElement;
    const id = parseInt(htmlEl.dataset.cardId ?? '', 10);
    if (!isNaN(id)) {
      if (desiredIds.has(id)) {
        existing.set(id, htmlEl);
      } else {
        htmlEl.remove();
      }
    } else {
      htmlEl.remove();
    }
  }

  // Add/reorder elements to match hand order
  let prevNode: HTMLElement | null = null;
  for (const card of human.hand) {
    let el = existing.get(card.id);
    if (!el) {
      el = createCardElement(card, true, 'uno-hand-card');
    }

    // Update playability classes
    const playable = isMyTurn && canPlayCard(card) && !state.awaitingColorPick;
    el.classList.toggle('playable', playable);
    el.classList.toggle('dimmed', isMyTurn && !state.awaitingColorPick && !playable);

    // Ensure correct DOM order
    const correctNext: Element | null = prevNode ? prevNode.nextElementSibling : handEl.firstElementChild;
    if (correctNext !== el) {
      if (prevNode) {
        prevNode.after(el);
      } else {
        handEl.prepend(el);
      }
    }
    prevNode = el;
  }
}

/**
 * FLIP-animate hand cards from old positions to new positions.
 * Call after reconcileHand() with the snapshot taken before DOM changes.
 *
 * @param before - Position snapshot from before DOM changes
 * @param newCardIds - IDs of newly added cards (animate from sourceRect)
 * @param sourceRect - Origin rect for new cards (e.g., draw pile)
 * @param duration - Animation duration in ms
 */
export function flipAnimateHand(
  before: Map<number, DOMRect>,
  newCardIds?: Set<number>,
  sourceRect?: DOMRect,
  duration = ANIM_MS,
): Promise<void> {
  const handEl = document.getElementById('uno-hand')!;
  const cards = handEl.querySelectorAll<HTMLElement>('[data-card-id]');

  let anyAnimated = false;

  for (const el of cards) {
    const id = parseInt(el.dataset.cardId!, 10);
    const newRect = el.getBoundingClientRect();

    let dx = 0, dy = 0;

    if (newCardIds?.has(id) && sourceRect) {
      // New card: animate from source position (e.g., draw pile)
      dx = (sourceRect.left + sourceRect.width / 2) - (newRect.left + newRect.width / 2);
      dy = (sourceRect.top + sourceRect.height / 2) - (newRect.top + newRect.height / 2);
      anyAnimated = true;
    } else if (before.has(id)) {
      // Existing card: animate from old position
      const oldRect = before.get(id)!;
      dx = (oldRect.left + oldRect.width / 2) - (newRect.left + newRect.width / 2);
      dy = (oldRect.top + oldRect.height / 2) - (newRect.top + newRect.height / 2);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      anyAnimated = true;
    } else {
      continue;
    }

    // Apply inverse transform (card appears at old position)
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  if (!anyAnimated) return Promise.resolve();

  // Force layout so browser registers the starting transforms
  handEl.offsetHeight;

  // Animate to final positions (remove transforms)
  for (const el of cards) {
    if (el.style.transform && el.style.transform !== 'none') {
      el.style.transition = `transform ${duration}ms cubic-bezier(.4,0,.2,1)`;
      el.style.transform = '';
    }
  }

  return new Promise(resolve => {
    setTimeout(() => {
      for (const el of cards) {
        el.style.transition = '';
        el.style.transform = '';
      }
      resolve();
    }, duration + 20);
  });
}

// ── Overlay animation (for cards flying to discard pile) ──

export function animateOverlay(
  html: string,
  fromRect: DOMRect,
  toRect: DOMRect,
  duration = ANIM_MS,
): Promise<void> {
  return new Promise(resolve => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const el = wrapper.firstElementChild as HTMLElement;
    el.style.position = 'fixed';
    el.style.zIndex = '5000';
    el.style.pointerEvents = 'none';
    el.style.left = '0px';
    el.style.top = '0px';

    // Append hidden to measure the card's actual rendered size
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    const cardW = el.offsetWidth;
    const cardH = el.offsetHeight;
    el.style.visibility = '';

    const startX = fromRect.left + fromRect.width / 2 - cardW / 2;
    const startY = fromRect.top + fromRect.height / 2 - cardH / 2;
    const endX = toRect.left + toRect.width / 2 - cardW / 2;
    const endY = toRect.top + toRect.height / 2 - cardH / 2;

    el.style.transform = `translate(${startX}px, ${startY}px)`;

    // Force layout so browser registers start position before transition
    el.offsetHeight;

    el.style.transition = `transform ${duration}ms cubic-bezier(.4,0,.2,1)`;
    el.style.transform = `translate(${endX}px, ${endY}px)`;

    const cleanup = () => { if (el.parentNode) el.remove(); resolve(); };
    el.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, duration + 50);
  });
}

// ── Area renderers ──

export function isHumanTurnReady(): boolean {
  return state.currentPlayerIdx === state.humanIndex &&
    !state.gameOver && !state.animating && !state.turnLock;
}

export function render(): void {
  renderAiArea();
  renderCenter();
  reconcileHand();
  renderStatus();
}

export function renderAiArea(): void {
  const area = document.getElementById('uno-ai-area')!;
  let html = '';
  for (let i = 0; i < state.players.length; i++) {
    if (i === state.humanIndex) continue;
    const p = state.players[i];
    const isActive = i === state.currentPlayerIdx && !state.gameOver;
    const activeClass = isActive ? ' active' : '';
    html += `<div class="uno-ai-player${activeClass}">`;
    html += `<span class="uno-ai-name">${p.name}</span>`;
    html += `<span class="uno-ai-count">${p.hand.length} card${p.hand.length !== 1 ? 's' : ''}</span>`;
    html += `<div class="uno-ai-cards">`;
    for (let j = 0; j < Math.min(p.hand.length, 15); j++) {
      html += cardHtml(p.hand[j], state.showAiHands, 'uno-mini');
    }
    if (p.hand.length > 15) html += `<span class="uno-ai-more">+${p.hand.length - 15}</span>`;
    html += `</div></div>`;
  }
  area.innerHTML = html;
}

export function renderCenter(): void {
  const drawEl = document.getElementById('uno-draw-pile')!;
  const discardEl = document.getElementById('uno-discard-area')!;
  const colorEl = document.getElementById('uno-color-indicator')!;
  const dirEl = document.getElementById('uno-direction')!;

  const humanReady = isHumanTurnReady() && !state.awaitingColorPick;
  const drawClass = humanReady && !state.pendingSkip && !state.hasDrawnThisTurn ? ' drawable' : '';
  drawEl.innerHTML = `<div class="uno-card uno-back uno-pile-card${drawClass}">` +
    `<span class="uno-card-val">UNO</span>` +
    `<span class="uno-pile-count">${state.drawPile.length}</span></div>`;

  if (state.discardPile.length > 0) {
    const top = state.discardPile[state.discardPile.length - 1];
    discardEl.innerHTML = cardHtml(top, true, 'uno-pile-card');
  } else {
    discardEl.innerHTML = '<div class="uno-card uno-empty uno-pile-card"></div>';
  }

  colorEl.innerHTML = `<div class="uno-color-dot" style="background:${COLOR_HEX[state.currentColor]}"></div>`;
  dirEl.textContent = state.direction === 1 ? '→' : '←';
}

export function renderStatus(): void {
  const el = document.getElementById('uno-status')!;
  if (state.gameOver) { el.textContent = ''; return; }
  if (state.animating) {
    el.textContent = state.players[state.currentPlayerIdx].name + '...';
    return;
  }
  const p = state.players[state.currentPlayerIdx];
  if (state.currentPlayerIdx === state.humanIndex) {
    if (state.awaitingColorPick) {
      el.textContent = 'Pick a color!';
    } else if (state.pendingDraw > 0 && state.ruleset === 'beginner') {
      el.textContent = `You must draw ${state.pendingDraw} cards! Tap the draw pile.`;
    } else if (state.pendingDraw > 0 && state.ruleset === 'intermediate') {
      const stackable = state.players[state.humanIndex].hand.some(c => canPlayCard(c));
      el.textContent = stackable
        ? `+${state.pendingDraw} incoming! Stack or tap draw pile.`
        : `You must draw ${state.pendingDraw} cards! Tap the draw pile.`;
    } else if (state.pendingSkip && state.ruleset === 'beginner') {
      el.textContent = 'You are skipped!';
    } else if (state.pendingSkip && state.ruleset === 'intermediate') {
      const canDeflect = state.players[state.humanIndex].hand.some(c => c.value === 'skip');
      el.textContent = canDeflect
        ? 'Play a Skip to deflect, or tap Done to get skipped!'
        : 'You are skipped!';
    } else if (state.hasDrawnThisTurn) {
      el.textContent = 'Play a card or tap Done.';
    } else {
      el.textContent = 'Your turn! Play a card or draw.';
    }
  } else {
    el.textContent = `${p.name} is thinking...`;
  }

  const doneBtn = document.getElementById('uno-done-btn')!;
  const canAcceptSkip = state.pendingSkip && state.ruleset === 'intermediate' &&
    state.players[state.humanIndex].hand.some(c => c.value === 'skip');
  const showDone = isHumanTurnReady() && !state.awaitingColorPick && state.pendingDraw === 0 &&
    ((!state.pendingSkip && state.hasDrawnThisTurn) || canAcceptSkip);
  doneBtn.style.display = showDone ? 'block' : 'none';
}

export function flashMessage(text: string, color = '#fff'): void {
  const el = document.createElement('div');
  el.className = 'uno-flash';
  el.textContent = text;
  el.style.color = color;
  document.getElementById('uno-screen')!.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

export function getRect(selector: string): DOMRect {
  const el = document.querySelector(selector);
  if (el) return el.getBoundingClientRect();
  return new DOMRect(window.innerWidth / 2 - 35, window.innerHeight / 2 - 52, 70, 105);
}
