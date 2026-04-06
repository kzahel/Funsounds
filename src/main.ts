import { initFreePlay } from './freeplay';
import { initQuiz } from './quiz';
import { initMemory } from './memory';
import { initUno } from './uno';

async function init() {
  await Promise.all([initFreePlay(), initQuiz(), initMemory(), initUno()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
