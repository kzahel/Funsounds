import { initFreePlay } from './freeplay';
import { initQuiz } from './quiz';
import { initMemory } from './memory';

async function init() {
  await Promise.all([initFreePlay(), initQuiz(), initMemory()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
