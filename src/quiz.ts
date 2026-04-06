import type { SoundEntry } from './types';
import {
  isMobile,
  shuffle,
  pickRandom,
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
let quizActive = false;
let currentAnswer: QuizAnswer | null = null;
let roundLocked = false;
let quizMode = 'objects';
let difficulty = 2;
let firstRound = true;
let starsEarned = 0;
let lostStarThisRound = false;
const STARS_TO_WIN = 5;

interface QuizAnswer {
  key: string;
  speech: string;
  filename?: string;
  duration?: number;
}

interface QuizChoice {
  key: string;
  display?: string;
  css?: string;
  renderType: 'emoji' | 'text' | 'color';
}

const DIFFICULTY: Record<number, { choiceCount: number; label: string }> = {
  1: { choiceCount: 2, label: 'Easy' },
  2: { choiceCount: 4, label: 'Normal' },
  3: { choiceCount: 6, label: 'Hard' },
  4: { choiceCount: 4, label: 'Expert' },
};
let expertUnlocked = false;

// Object quiz: tiered by familiarity
const OBJECTS_EASY = new Set([
  'dog', 'cat', 'cow', 'pig', 'duck', 'horse', 'bird', 'frog',
  'car', 'train', 'bus', 'bell', 'drum', 'phone', 'lion', 'bear',
]);
const OBJECTS_NORMAL = new Set([
  ...OBJECTS_EASY,
  'elephant', 'rooster', 'bee', 'sheep', 'owl', 'monkey', 'whale',
  'dolphin', 'penguin', 'snake', 'fox', 'airplane', 'rocket',
  'firetruck', 'helicopter', 'motorcycle', 'tractor', 'bicycle',
  'ship', 'trumpet', 'piano', 'guitar', 'basketball', 'soccer',
]);
const OBJECTS_HARD = new Set([
  ...OBJECTS_NORMAL,
  'wolf', 'parrot', 'bat', 'alligator', 'hippo', 'giraffe',
  'squirrel', 'chick', 'turkey', 'cricket', 'violin', 'saxophone',
  'trombone', 'bongo', 'hammer', 'scissors', 'ghost', 'dragon',
  'unicorn', 'fairy',
]);

const ALPHA_EASY = 'A B C D O S X Z'.split(' ');
const ALPHA_ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const COLORS_EASY = [
  { key: 'red', name: 'red', css: '#e74c3c' },
  { key: 'blue', name: 'blue', css: '#3498db' },
  { key: 'green', name: 'green', css: '#2ecc71' },
  { key: 'yellow', name: 'yellow', css: '#f1c40f' },
];
const COLORS_NORMAL = [
  ...COLORS_EASY,
  { key: 'orange', name: 'orange', css: '#e67e22' },
  { key: 'purple', name: 'purple', css: '#9b59b6' },
  { key: 'black', name: 'black', css: '#2c3e50' },
  { key: 'white', name: 'white', css: '#ecf0f1' },
  { key: 'brown', name: 'brown', css: '#8B4513' },
  { key: 'pink', name: 'pink', css: '#ff69b4' },
];
const COLORS_HARD = [
  ...COLORS_NORMAL,
  { key: 'turquoise', name: 'turquoise', css: '#1abc9c' },
  { key: 'magenta', name: 'magenta', css: '#ff00ff' },
  { key: 'gold', name: 'gold', css: '#ffd700' },
  { key: 'navy', name: 'navy', css: '#1a3a5c' },
  { key: 'lime', name: 'lime', css: '#32cd32' },
  { key: 'coral', name: 'coral', css: '#ff7f50' },
  { key: 'lavender', name: 'lavender', css: '#b57edc' },
  { key: 'teal', name: 'teal', css: '#008080' },
  { key: 'maroon', name: 'maroon', css: '#800000' },
  { key: 'peach', name: 'peach', css: '#ffb07c' },
  { key: 'olive', name: 'olive', css: '#808000' },
  { key: 'salmon', name: 'salmon', css: '#fa8072' },
  { key: 'crimson', name: 'crimson', css: '#dc143c' },
  { key: 'indigo', name: 'indigo', css: '#4b0082' },
  { key: 'beige', name: 'beige', css: '#f5f5dc' },
  { key: 'silver', name: 'silver', css: '#c0c0c0' },
];

const COLOR_CONFLICTS = [
  ['red', 'crimson', 'maroon'],
  ['yellow', 'gold'],
  ['white', 'beige', 'silver'],
  ['blue', 'navy', 'indigo'],
  ['green', 'lime', 'olive', 'teal'],
  ['purple', 'lavender', 'indigo', 'magenta'],
  ['pink', 'magenta', 'salmon', 'coral'],
  ['orange', 'coral', 'peach', 'salmon'],
  ['brown', 'maroon', 'olive'],
  ['turquoise', 'teal'],
];

function getColorConflicts(key: string): Set<string> {
  const conflicts = new Set<string>();
  for (const group of COLOR_CONFLICTS) {
    if (group.includes(key)) {
      for (const k of group) conflicts.add(k);
    }
  }
  conflicts.delete(key);
  return conflicts;
}

const NUMBERS_EASY = [1, 2, 3, 4, 5];
const NUMBERS_NORMAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const NUMBERS_HARD: number[] = [];
for (let i = 1; i <= 20; i++) NUMBERS_HARD.push(i);

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      btn.classList.remove('speaking');
      resolve();
    };

    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.85;
    utter.pitch = 1.1;
    utter.volume = 1;
    const voices = speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang.startsWith('en') && v.name.includes('Female')) ||
      voices.find((v) => v.lang.startsWith('en'));
    if (preferred) utter.voice = preferred;

    const btn = document.getElementById('quiz-speaker')!;
    btn.classList.add('speaking');

    utter.onend = done;
    utter.onerror = done;
    setTimeout(done, 3000);

    speechSynthesis.speak(utter);
  });
}

function buildExpertSpeech(answer: { key: string }, choices: QuizChoice[]): string {
  const otherNames = choices.filter((c) => c.key !== answer.key).map((c) => c.key);
  const listed = otherNames.join(', ');
  if (firstRound) {
    return `I see ${listed}. Which one is missing?`;
  }
  return `${listed}. What's missing?`;
}

function pickChoicesForMode(): { answer: QuizAnswer; choices: QuizChoice[] } {
  const isExpert = difficulty === 4;
  const numChoices = DIFFICULTY[difficulty].choiceCount;

  if (quizMode === 'objects') {
    const nameSet = isExpert
      ? OBJECTS_NORMAL
      : difficulty === 1
        ? OBJECTS_EASY
        : difficulty === 2
          ? OBJECTS_NORMAL
          : OBJECTS_HARD;
    const pool = sounds.filter((s) => nameSet.has(s.name));
    const answer = pickRandom(pool);
    const others = shuffle(pool.filter((s) => s.name !== answer.name)).slice(0, numChoices - 1);
    const choices = shuffle([answer, ...others]);
    const mapped: QuizChoice[] = choices.map((c) => ({ key: c.name, display: c.emoji, renderType: 'emoji' }));
    const speech = isExpert
      ? buildExpertSpeech({ key: answer.name }, mapped)
      : firstRound
        ? `Where is the ${answer.name}?`
        : answer.name;
    return {
      answer: { key: answer.name, speech, filename: answer.filename, duration: answer.duration },
      choices: mapped,
    };
  }

  if (quizMode === 'alphabet') {
    const pool = isExpert ? ALPHA_ALL : difficulty === 1 ? ALPHA_EASY : ALPHA_ALL;
    const answer = pickRandom(pool);
    const others = shuffle(pool.filter((l) => l !== answer)).slice(0, numChoices - 1);
    const choices = shuffle([answer, ...others]);
    const mapped: QuizChoice[] = choices.map((c) => ({ key: c, display: c, renderType: 'text' }));
    const speech = isExpert
      ? buildExpertSpeech({ key: answer }, mapped)
      : firstRound
        ? `Where is the letter ${answer}?`
        : answer;
    return { answer: { key: answer, speech }, choices: mapped };
  }

  if (quizMode === 'colors') {
    const pool = isExpert
      ? COLORS_NORMAL
      : difficulty === 1
        ? COLORS_EASY
        : difficulty === 2
          ? COLORS_NORMAL
          : COLORS_HARD;
    const answer = pickRandom(pool);
    const conflicts = getColorConflicts(answer.key);
    const others = shuffle(pool.filter((c) => c.key !== answer.key && !conflicts.has(c.key))).slice(
      0,
      numChoices - 1,
    );
    const choices = shuffle([answer, ...others]);
    const mapped: QuizChoice[] = choices.map((c) => ({ key: c.key, css: c.css, renderType: 'color' }));
    const speech = isExpert
      ? buildExpertSpeech({ key: answer.key }, mapped)
      : firstRound
        ? `Where is ${answer.name}?`
        : answer.name;
    return { answer: { key: answer.key, speech }, choices: mapped };
  }

  // numbers
  const pool = isExpert
    ? NUMBERS_NORMAL
    : difficulty === 1
      ? NUMBERS_EASY
      : difficulty === 2
        ? NUMBERS_NORMAL
        : NUMBERS_HARD;
  const answer = pickRandom(pool);
  const others = shuffle(pool.filter((n) => n !== answer)).slice(0, numChoices - 1);
  const choices = shuffle([answer, ...others]);
  const mapped: QuizChoice[] = choices.map((c) => ({ key: String(c), display: String(c), renderType: 'text' }));
  const speech = isExpert
    ? buildExpertSpeech({ key: String(answer) }, mapped)
    : firstRound
      ? `Where is the number ${answer}?`
      : String(answer);
  return { answer: { key: String(answer), speech }, choices: mapped };
}

function updateGridLayout(count: number): void {
  const grid = document.getElementById('quiz-grid')!;
  if (count <= 2) {
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gridTemplateRows = '1fr';
  } else if (count <= 4) {
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gridTemplateRows = '1fr 1fr';
  } else {
    grid.style.gridTemplateColumns = '1fr 1fr 1fr';
    grid.style.gridTemplateRows = '1fr 1fr';
  }
}

function initStarBar(): void {
  starsEarned = 0;
  const bar = document.getElementById('star-bar')!;
  bar.innerHTML = '';
  for (let i = 0; i < STARS_TO_WIN; i++) {
    const slot = document.createElement('span');
    slot.className = 'star-slot';
    slot.textContent = '\u2B50';
    bar.appendChild(slot);
  }
}

function awardStar(): void {
  const slots = document.querySelectorAll('.star-slot');
  if (starsEarned < slots.length) {
    slots[starsEarned].classList.add('earned');
  }
  starsEarned++;
}

function removeStar(): void {
  if (starsEarned <= 0) return;
  starsEarned--;
  const slots = document.querySelectorAll('.star-slot');
  if (starsEarned < slots.length) {
    slots[starsEarned].classList.remove('earned');
  }
}

function playFinale(): void {
  const overlay = document.getElementById('finale-overlay')!;
  overlay.innerHTML = '';
  overlay.classList.add('active');

  const stars: HTMLElement[] = [];
  for (let i = 0; i < STARS_TO_WIN; i++) {
    const star = document.createElement('div');
    star.className = 'finale-star roaming';
    star.textContent = '\u2B50';
    star.style.left = (15 + Math.random() * 70) + 'vw';
    star.style.top = (15 + Math.random() * 60) + 'vh';
    star.style.animationDuration = (2 + Math.random() * 2) + 's';
    star.style.animationDelay = (Math.random() * 0.5) + 's';
    overlay.appendChild(star);
    stars.push(star);
  }

  spawnConfetti(document.getElementById('quiz-screen')!);
  playCheer();
  setTimeout(() => spawnConfetti(document.getElementById('quiz-screen')!), 800);

  setTimeout(() => {
    stars.forEach((s) => {
      s.classList.remove('roaming');
      s.style.opacity = '0';
      s.style.transition = 'opacity 0.5s';
    });
    const big = document.createElement('div');
    big.className = 'finale-star grow';
    big.textContent = '\u2B50';
    big.style.left = '50%';
    big.style.top = '50%';
    big.style.fontSize = '4rem';
    overlay.appendChild(big);
  }, 3000);

  setTimeout(() => {
    overlay.classList.remove('active');
    overlay.innerHTML = '';
    if (isMobile) exitFullscreen();
    stopQuiz();
  }, 5000);
}

async function startRound(): Promise<void> {
  roundLocked = false;
  lostStarThisRound = false;
  const { answer, choices } = pickChoicesForMode();
  currentAnswer = answer;

  const grid = document.getElementById('quiz-grid')!;
  grid.innerHTML = '';
  updateGridLayout(choices.length);

  choices.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-btn fade-in';
    btn.dataset.key = c.key;

    if (c.renderType === 'color') {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.background = c.css!;
      btn.appendChild(swatch);
    } else {
      const span = document.createElement('span');
      span.className = 'emoji';
      span.textContent = c.display!;
      if (c.renderType === 'text') span.classList.add('text-choice');
      btn.appendChild(span);
    }

    btn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        handleQuizTap(btn);
      },
      { passive: false },
    );
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleQuizTap(btn);
    });
    grid.appendChild(btn);
  });

  await new Promise((r) => setTimeout(r, 400));
  await speak(answer.speech);
  firstRound = false;
}

function handleQuizTap(btn: HTMLElement): void {
  if (roundLocked || !currentAnswer) return;

  if (btn.dataset.key === currentAnswer.key) {
    roundLocked = true;
    btn.classList.add('correct');
    awardStar();

    const isLastStar = starsEarned >= STARS_TO_WIN;

    const afterCheer = () => {
      if (isLastStar) {
        setTimeout(playFinale, 500);
      } else {
        startRound();
      }
    };

    if (currentAnswer.filename) {
      const objAudio = new Audio(`${currentAnswer.filename}.mp3`);
      objAudio.volume = 0.7;
      objAudio.play().catch(() => {});

      let cheered = false;
      const doCheer = () => {
        if (cheered) return;
        cheered = true;
        spawnConfetti(document.getElementById('quiz-screen')!);
        playCheer();
        setTimeout(afterCheer, 2500);
      };
      objAudio.addEventListener('ended', doCheer, { once: true });
      setTimeout(doCheer, 1500);
    } else {
      spawnConfetti(document.getElementById('quiz-screen')!);
      playCheer();
      setTimeout(afterCheer, 2500);
    }
  } else {
    if (!lostStarThisRound) {
      lostStarThisRound = true;
      removeStar();
    }
    if (btn.querySelector('.wrong-x')) return;
    const x = document.createElement('div');
    x.className = 'wrong-x';
    x.textContent = '\u2717';
    btn.appendChild(x);
    setTimeout(() => {
      if (x.parentNode) x.remove();
    }, 600);
  }
}

async function startQuiz(): Promise<void> {
  if (isMobile) await enterFullscreen();

  document.getElementById('start-screen')!.style.display = 'none';
  document.getElementById('quiz-screen')!.style.display = 'flex';
  quizActive = true;

  speechSynthesis.getVoices();
  firstRound = true;
  initStarBar();
  await startRound();
}

function stopQuiz(): void {
  speechSynthesis.cancel();
  document.getElementById('start-screen')!.style.display = 'block';
  document.getElementById('quiz-screen')!.style.display = 'none';
  document.getElementById('confetti-container')!.innerHTML = '';
  const overlay = document.getElementById('finale-overlay')!;
  overlay.classList.remove('active');
  overlay.innerHTML = '';
  quizActive = false;
}

function unlockExpert(): void {
  if (expertUnlocked) return;
  expertUnlocked = true;
  const slider = document.getElementById('difficulty-slider') as HTMLInputElement;
  slider.max = '4';
  const label = document.getElementById('difficulty-label')!;
  label.textContent = DIFFICULTY[parseInt(slider.value)].label;
  label.style.color = '#ffd93d';
  setTimeout(() => {
    label.style.color = '';
  }, 1500);
}

export async function initQuiz(): Promise<void> {
  sounds = await loadSounds();

  // Secret expert unlock: tap title 5 times
  let titleTaps = 0;
  let titleTapTimer: ReturnType<typeof setTimeout> | null = null;
  const title = document.querySelector('#start-screen h1')!;
  title.addEventListener('click', () => {
    titleTaps++;
    if (titleTapTimer) clearTimeout(titleTapTimer);
    titleTapTimer = setTimeout(() => {
      titleTaps = 0;
    }, 2000);
    if (titleTaps >= 5) {
      titleTaps = 0;
      unlockExpert();
    }
  });

  // Mode selector
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector('.mode-btn.selected')?.classList.remove('selected');
      btn.classList.add('selected');
      quizMode = (btn as HTMLElement).dataset.mode ?? 'objects';
    });
  });

  // Difficulty slider
  const slider = document.getElementById('difficulty-slider') as HTMLInputElement;
  const label = document.getElementById('difficulty-label')!;
  slider.addEventListener('input', () => {
    difficulty = parseInt(slider.value);
    label.textContent = DIFFICULTY[difficulty].label;
  });

  document.getElementById('quiz-btn')!.addEventListener('click', startQuiz);

  const speakerHandler = () => {
    if (currentAnswer && !roundLocked) {
      speak(currentAnswer.speech);
    }
  };
  document
    .getElementById('quiz-speaker')!
    .addEventListener('touchstart', (e) => { e.preventDefault(); speakerHandler(); }, { passive: false });
  document.getElementById('quiz-speaker')!.addEventListener('click', speakerHandler);

  setupEscapeHold(
    () => quizActive,
    () => {
      if (isMobile) exitFullscreen();
      stopQuiz();
    },
  );
  setupFullscreenExit(
    () => quizActive,
    () => stopQuiz(),
  );
  preventContextMenu(() => quizActive);
}
