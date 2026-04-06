import { loadSounds, setupEscapeHold, setupFullscreenExit, preventContextMenu } from '../utils';
import { state } from './state';
import { startGame, humanPlay, humanDraw, humanEndTurn, onUnoCalled, exitGame } from './game';
import type { Ruleset, Theme } from './types';

function setupEvents(): void {
  const screen = document.getElementById('uno-screen')!;

  screen.addEventListener('click', (e) => {
    const cardEl = (e.target as HTMLElement).closest('.uno-hand-card[data-card-id]') as HTMLElement;
    if (cardEl) {
      const id = parseInt(cardEl.dataset.cardId!, 10);
      const card = state.players[state.humanIndex].hand.find(c => c.id === id);
      if (card) humanPlay(card);
      return;
    }

    if ((e.target as HTMLElement).closest('#uno-draw-pile')) {
      humanDraw();
      return;
    }

    if ((e.target as HTMLElement).closest('#uno-uno-btn')) {
      onUnoCalled();
      return;
    }

    if ((e.target as HTMLElement).closest('#uno-done-btn')) {
      humanEndTurn();
      return;
    }
  });

  setupEscapeHold(() => state.gameActive, exitGame);
  setupFullscreenExit(() => state.gameActive, exitGame);
  preventContextMenu(() => state.gameActive);
}

function setupConfig(): void {
  document.querySelectorAll('[data-ai-count]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-ai-count]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.aiCount = parseInt((btn as HTMLElement).dataset.aiCount!, 10);
    });
  });

  document.querySelectorAll('[data-uno-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-uno-theme]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.theme = (btn as HTMLElement).dataset.unoTheme as Theme;
    });
  });

  document.querySelectorAll('[data-uno-rules]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-uno-rules]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.ruleset = (btn as HTMLElement).dataset.unoRules as Ruleset;
      state.showAiHands = state.ruleset === 'beginner';
    });
  });

  document.getElementById('uno-btn')!.addEventListener('click', () => {
    state.gameActive = true;
    state.showAiHands = state.ruleset === 'beginner';
    startGame();
  });
}

export async function initUno(): Promise<void> {
  state.sounds = await loadSounds();
  setupConfig();
  setupEvents();
}
