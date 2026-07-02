import { initFreePlay } from './freeplay';
import { initQuiz } from './quiz';
import { initMemory } from './memory';
import { initFlyingComets } from './flying-comets';
import { initUno } from './uno/index';
import { initQbert } from './qbert/index';
import { initTrain } from './train/index';
import { initFarm } from './farm/index';
import { initJumper } from './jumper/index';

type GameId = 'freeplay' | 'quiz' | 'memory' | 'comets' | 'jumper' | 'qbert' | 'train' | 'farm' | 'uno';
type JumperModeId = 'practice' | 'easy' | 'hard' | 'buddy' | 'wedding';

interface DeepLink {
  game: GameId;
  mode?: string;
  difficulty?: number;
  players?: number;
  aiCount?: number;
  unoTheme?: string;
  unoRules?: string;
}

const GAME_ALIASES: Record<string, GameId> = {
  play: 'freeplay',
  freeplay: 'freeplay',
  'free-play': 'freeplay',
  sounds: 'freeplay',
  quiz: 'quiz',
  memory: 'memory',
  'memory-game': 'memory',
  comet: 'comets',
  comets: 'comets',
  'flying-comets': 'comets',
  'flying-comments': 'comets',
  jumper: 'jumper',
  barrelhop: 'jumper',
  'barrel-hop': 'jumper',
  qbert: 'qbert',
  'q-bert': 'qbert',
  train: 'train',
  trains: 'train',
  'train-builder': 'train',
  farm: 'farm',
  uno: 'uno',
};

const JUMPER_MODE_ALIASES: Record<string, JumperModeId> = {
  practice: 'practice',
  easy: 'easy',
  over: 'easy',
  'jump-over': 'easy',
  jumpover: 'easy',
  hard: 'hard',
  on: 'hard',
  'jump-on': 'hard',
  jumpon: 'hard',
  buddy: 'buddy',
  buddies: 'buddy',
  wedding: 'wedding',
  'buddy-wedding': 'wedding',
};

const FREEPLAY_MODE_ALIASES = new Set(['objects', 'alphabet', 'colors', 'numbers', 'sounds']);
const UNO_THEMES = new Set(['classic', 'emoji']);
const UNO_RULES = new Set(['beginner', 'intermediate']);

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashParts(): string[] {
  const hash = window.location.hash.slice(1).trim();
  if (!hash || hash.includes('=')) return [];
  return hash
    .replace(/^!?\//, '')
    .split('/')
    .map((part) => decodeURIComponent(part))
    .filter(Boolean);
}

function hashParams(): URLSearchParams {
  const hash = window.location.hash.slice(1).trim();
  if (!hash.includes('=')) return new URLSearchParams();
  return new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : hash);
}

function firstParam(sources: URLSearchParams[], names: string[]): string | null {
  for (const source of sources) {
    for (const name of names) {
      const value = source.get(name);
      if (value) return value;
    }
  }
  return null;
}

function firstIntParam(sources: URLSearchParams[], names: string[]): number | undefined {
  const value = firstParam(sources, names);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDeepLink(): DeepLink | null {
  const query = new URLSearchParams(window.location.search);
  const hashQuery = hashParams();
  const sources = [query, hashQuery];
  const parts = hashParts();

  const rawGame = firstParam(sources, ['game', 'play']) ?? parts[0] ?? null;
  const rawMode = firstParam(sources, ['mode', 'jpMode', 'jumperMode', 'barrelHop']) ?? parts[1] ?? null;
  const gameToken = normalizeToken(rawGame);
  const jumperModeFromGame = JUMPER_MODE_ALIASES[gameToken];
  const game = jumperModeFromGame ? 'jumper' : GAME_ALIASES[gameToken];
  if (!game) return null;

  return {
    game,
    mode: jumperModeFromGame ?? rawMode ?? undefined,
    difficulty: firstIntParam(sources, ['difficulty', 'level']),
    players: firstIntParam(sources, ['players']),
    aiCount: firstIntParam(sources, ['ai', 'aiCount']),
    unoTheme: firstParam(sources, ['theme']) ?? undefined,
    unoRules: firstParam(sources, ['rules']) ?? undefined,
  };
}

function clickSelector(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    console.warn(`Deep link target not found: ${selector}`);
    return false;
  }
  el.click();
  return true;
}

function setDifficulty(value: number | undefined): void {
  if (value === undefined) return;
  const slider = document.getElementById('difficulty-slider') as HTMLInputElement | null;
  if (!slider) return;
  const min = Number.parseInt(slider.min || '1', 10);
  const max = Number.parseInt(slider.max || '3', 10);
  slider.value = String(Math.max(min, Math.min(max, value)));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectButton(selector: string): void {
  clickSelector(selector);
}

function applyDeepLink(link: DeepLink): void {
  setDifficulty(link.difficulty);

  switch (link.game) {
    case 'freeplay': {
      const mode = normalizeToken(link.mode);
      if (FREEPLAY_MODE_ALIASES.has(mode)) selectButton(`.mode-btn[data-mode="${mode}"]`);
      clickSelector('#start-btn');
      break;
    }
    case 'quiz': {
      const mode = normalizeToken(link.mode);
      if (FREEPLAY_MODE_ALIASES.has(mode)) selectButton(`.mode-btn[data-mode="${mode}"]`);
      clickSelector('#quiz-btn');
      break;
    }
    case 'memory': {
      if (link.players === 1 || link.players === 2) selectButton(`.player-btn[data-players="${link.players}"]`);
      clickSelector('#memory-btn');
      break;
    }
    case 'comets':
      clickSelector('#flying-comments-btn');
      break;
    case 'jumper': {
      const mode = JUMPER_MODE_ALIASES[normalizeToken(link.mode)] ?? 'easy';
      clickSelector(`[data-jp-mode="${mode}"]`);
      break;
    }
    case 'qbert':
      clickSelector('#qbert-btn');
      break;
    case 'train':
      clickSelector('#train-btn');
      break;
    case 'farm':
      clickSelector('#farm-btn');
      break;
    case 'uno': {
      if (link.aiCount !== undefined) {
        const aiCount = Math.max(1, Math.min(3, link.aiCount));
        selectButton(`[data-ai-count="${aiCount}"]`);
      }
      const theme = normalizeToken(link.unoTheme);
      if (UNO_THEMES.has(theme)) selectButton(`[data-uno-theme="${theme}"]`);
      const rules = normalizeToken(link.unoRules);
      if (UNO_RULES.has(rules)) selectButton(`[data-uno-rules="${rules}"]`);
      clickSelector('#uno-btn');
      break;
    }
  }
}

function currentDifficulty(): number | undefined {
  const slider = document.getElementById('difficulty-slider') as HTMLInputElement | null;
  if (!slider) return undefined;
  const parsed = Number.parseInt(slider.value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function selectedData(selector: string, dataName: string): string | undefined {
  const el = document.querySelector<HTMLElement>(selector);
  return el?.dataset[dataName];
}

function currentFreePlayLink(game: 'freeplay' | 'quiz'): DeepLink {
  return {
    game,
    mode: selectedData('.mode-btn.selected', 'mode') ?? 'objects',
    difficulty: currentDifficulty(),
  };
}

function currentMemoryLink(): DeepLink {
  return {
    game: 'memory',
    players: Number.parseInt(selectedData('.player-btn.selected', 'players') ?? '1', 10),
    difficulty: currentDifficulty(),
  };
}

function currentUnoLink(): DeepLink {
  return {
    game: 'uno',
    aiCount: Number.parseInt(selectedData('[data-ai-count].selected', 'aiCount') ?? '1', 10),
    unoTheme: selectedData('[data-uno-theme].selected', 'unoTheme') ?? 'classic',
    unoRules: selectedData('[data-uno-rules].selected', 'unoRules') ?? 'beginner',
  };
}

function buildDeepLinkHref(link: DeepLink): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();

  if (link.game === 'jumper') {
    const mode = JUMPER_MODE_ALIASES[normalizeToken(link.mode)] ?? 'easy';
    if (mode === 'buddy' || mode === 'wedding') {
      params.set('game', mode);
    } else {
      params.set('game', 'jumper');
      params.set('mode', mode);
    }
  } else {
    params.set('game', link.game);
  }

  if ((link.game === 'freeplay' || link.game === 'quiz') && link.mode) {
    params.set('mode', normalizeToken(link.mode));
  }
  if (link.difficulty !== undefined) params.set('difficulty', String(link.difficulty));
  if (link.players !== undefined) params.set('players', String(link.players));
  if (link.aiCount !== undefined) params.set('ai', String(link.aiCount));
  if (link.unoTheme) params.set('theme', normalizeToken(link.unoTheme));
  if (link.unoRules) params.set('rules', normalizeToken(link.unoRules));

  url.search = params.toString();
  url.hash = '';
  return url.href;
}

function updateAddressToDeepLink(link: DeepLink): void {
  window.history.replaceState(null, '', buildDeepLinkHref(link));
}

function launchLinkForElement(el: HTMLElement): DeepLink | null {
  if (el.dataset.jpMode) return { game: 'jumper', mode: el.dataset.jpMode };
  switch (el.id) {
    case 'start-btn':
      return currentFreePlayLink('freeplay');
    case 'quiz-btn':
      return currentFreePlayLink('quiz');
    case 'memory-btn':
      return currentMemoryLink();
    case 'flying-comments-btn':
      return { game: 'comets' };
    case 'qbert-btn':
      return { game: 'qbert' };
    case 'train-btn':
      return { game: 'train' };
    case 'farm-btn':
      return { game: 'farm' };
    case 'uno-btn':
      return currentUnoLink();
    default:
      return null;
  }
}

function installLaunchUrlUpdates(): void {
  document
    .querySelectorAll<HTMLElement>('#start-btn, #quiz-btn, #memory-btn, #flying-comments-btn, [data-jp-mode], #qbert-btn, #train-btn, #farm-btn, #uno-btn')
    .forEach((el) => {
      el.addEventListener('click', () => {
        const link = launchLinkForElement(el);
        if (link) updateAddressToDeepLink(link);
      });
    });
}

async function init() {
  await Promise.all([initFreePlay(), initQuiz(), initMemory(), initFlyingComets(), initUno(), initQbert(), initTrain(), initFarm(), initJumper()]);
  installLaunchUrlUpdates();
  const deepLink = parseDeepLink();
  if (deepLink) applyDeepLink(deepLink);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
