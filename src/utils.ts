import type { SoundEntry, SoundsData } from './types';

export const isMobile =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 2);

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function loadSounds(): Promise<SoundEntry[]> {
  try {
    const response = await fetch('toddler_sounds.json');
    const data: SoundsData = await response.json();
    return data.sounds;
  } catch (error) {
    console.error('Failed to load sounds:', error);
    return [];
  }
}

export function speakText(text: string, options?: { rate?: number; pitch?: number }): void {
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = options?.rate ?? 0.9;
  utter.pitch = options?.pitch ?? 1.1;
  utter.volume = 1;
  const voices = speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith('en') && v.name.includes('Female')) ||
    voices.find((v) => v.lang.startsWith('en'));
  if (preferred) utter.voice = preferred;
  speechSynthesis.speak(utter);
}

export async function enterFullscreen(): Promise<boolean> {
  const elem = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
    msRequestFullscreen?: () => Promise<void>;
  };
  try {
    if (elem.requestFullscreen) await elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) await elem.msRequestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export function exitFullscreen(): void {
  const doc = document as Document & {
    webkitExitFullscreen?: () => void;
    msExitFullscreen?: () => void;
  };
  if (doc.exitFullscreen) doc.exitFullscreen();
  else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  else if (doc.msExitFullscreen) doc.msExitFullscreen();
}

export function isFullscreen(): boolean {
  const doc = document as Document & {
    webkitFullscreenElement?: Element;
    msFullscreenElement?: Element;
  };
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement);
}

const CONFETTI_COLORS = ['#ff6b9d', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6b6b', '#c084fc', '#fb923c'];

export function spawnConfetti(container?: HTMLElement): void {
  const cont = document.createElement('div');
  cont.style.cssText =
    'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2000;overflow:hidden;';
  (container ?? document.body).appendChild(cont);
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    cont.appendChild(piece);
  }
  setTimeout(() => {
    if (cont.parentNode) cont.remove();
  }, 4000);
}

export function playCheer(): void {
  const cheerFiles = ['sounds/party', 'sounds/clapping'];
  for (const file of cheerFiles) {
    const audio = new Audio(`${file}.mp3`);
    audio.volume = 0.6;
    audio.play().catch(() => {});
  }
  const utter = new SpeechSynthesisUtterance('Yay!');
  utter.rate = 1.0;
  utter.pitch = 1.4;
  utter.volume = 1;
  speechSynthesis.speak(utter);
}

export const ESCAPE_HOLD_TIME = 1500;

/**
 * Creates an escape-hold handler that calls `onExit` when Escape is held for ESCAPE_HOLD_TIME ms.
 * Returns a cleanup function to remove listeners and interval.
 */
export function setupEscapeHold(isActive: () => boolean, onExit: () => void): () => void {
  let escapeHeldStart: number | null = null;

  function handleKeyDown(event: KeyboardEvent) {
    if (!isActive()) return;
    if (event.key === 'Escape') {
      if (!escapeHeldStart) escapeHeldStart = Date.now();
      event.preventDefault();
      return;
    }
    event.preventDefault();
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (!isActive()) return;
    if (event.key === 'Escape') {
      if (escapeHeldStart && Date.now() - escapeHeldStart >= ESCAPE_HOLD_TIME) {
        onExit();
      }
      escapeHeldStart = null;
    }
  }

  function checkHold() {
    if (!isActive()) return;
    if (escapeHeldStart && Date.now() - escapeHeldStart >= ESCAPE_HOLD_TIME) {
      onExit();
    }
  }

  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keyup', handleKeyUp, true);
  const interval = setInterval(checkHold, 100);

  return () => {
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keyup', handleKeyUp, true);
    clearInterval(interval);
  };
}

export function setupFullscreenExit(isActive: () => boolean, onExit: () => void): () => void {
  function handler() {
    if (!isMobile || !isActive()) return;
    if (!isFullscreen()) onExit();
  }
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}

export function preventContextMenu(isActive: () => boolean): () => void {
  function handler(e: Event) {
    if (isActive()) e.preventDefault();
  }
  document.addEventListener('contextmenu', handler);
  return () => document.removeEventListener('contextmenu', handler);
}
