import { initFreePlay } from './freeplay';
import { initQuiz } from './quiz';
import { initMemory } from './memory';
import { initFlyingComments } from './flying-comments';
import { initUno } from './uno/index';

async function init() {
  await Promise.all([initFreePlay(), initQuiz(), initMemory(), initFlyingComments(), initUno()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
