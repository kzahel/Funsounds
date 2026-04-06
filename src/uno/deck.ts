import { shuffle } from '../utils';
import {
  COLORS, NUMBER_VALUES, ACTION_VALUES,
  type UnoCard, type CardValue,
} from './types';
import { state } from './state';

export function createDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  state.nextCardId = 0;

  if (state.sounds.length >= 10) {
    state.emojiValues = shuffle(state.sounds.map(s => s.emoji)).slice(0, 10);
  } else {
    state.emojiValues = ['🐕','🐱','🐸','🦁','🐘','🎸','🚀','⭐','🌈','🎵'];
  }

  function emojiFor(value: CardValue): string | undefined {
    if (state.theme !== 'emoji') return undefined;
    const idx = NUMBER_VALUES.indexOf(value);
    if (idx >= 0) return state.emojiValues[idx];
    if (value === 'skip') return '🚫';
    if (value === 'reverse') return '🔄';
    if (value === 'draw2') return '💥';
    if (value === 'wild') return '🌈';
    if (value === 'wild4') return '🌪️';
    return undefined;
  }

  for (const color of COLORS) {
    deck.push({ id: state.nextCardId++, color, value: '0', emoji: emojiFor('0') });
    for (let n = 1; n <= 9; n++) {
      const v = `${n}` as CardValue;
      deck.push({ id: state.nextCardId++, color, value: v, emoji: emojiFor(v) });
      deck.push({ id: state.nextCardId++, color, value: v, emoji: emojiFor(v) });
    }
    for (const action of ACTION_VALUES) {
      deck.push({ id: state.nextCardId++, color, value: action, emoji: emojiFor(action) });
      deck.push({ id: state.nextCardId++, color, value: action, emoji: emojiFor(action) });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: state.nextCardId++, color: 'wild', value: 'wild', emoji: emojiFor('wild') });
    deck.push({ id: state.nextCardId++, color: 'wild', value: 'wild4', emoji: emojiFor('wild4') });
  }

  return shuffle(deck);
}

export function reshuffleDiscard(): void {
  if (state.discardPile.length <= 1) return;
  const top = state.discardPile.pop()!;
  const rest = state.discardPile.splice(0);
  state.drawPile.push(...shuffle(rest));
  state.discardPile.push(top);
}

export function drawFromPile(): UnoCard | null {
  if (state.drawPile.length === 0) reshuffleDiscard();
  return state.drawPile.length > 0 ? state.drawPile.pop()! : null;
}

export function canPlayCard(card: UnoCard): boolean {
  if (state.gameOver || state.animating || state.awaitingColorPick) return false;
  const top = state.discardPile[state.discardPile.length - 1];
  if (!top) return true;

  if (state.pendingDraw > 0) {
    if (state.ruleset === 'intermediate') {
      if (top.value === 'draw2' && card.value === 'draw2') return true;
      if (top.value === 'wild4' && card.value === 'wild4') return true;
    }
    return false;
  }

  if (state.pendingSkip) {
    if (state.ruleset === 'intermediate' && card.value === 'skip') return true;
    return false;
  }

  if (card.color === 'wild') return true;
  if (card.color === state.currentColor) return true;
  if (card.value === top.value) return true;
  return false;
}

export function hasPlayableCard(hand: UnoCard[]): boolean {
  return hand.some(c => canPlayCard(c));
}
