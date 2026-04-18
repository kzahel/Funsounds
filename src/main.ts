import { initFreePlay } from './freeplay';
import { initQuiz } from './quiz';
import { initMemory } from './memory';
import { initFlyingComets } from './flying-comets';
import { initUno } from './uno/index';
import { initQbert } from './qbert/index';
import { initTrain } from './train/index';
import { initFarm } from './farm/index';

async function init() {
  await Promise.all([initFreePlay(), initQuiz(), initMemory(), initFlyingComets(), initUno(), initQbert(), initTrain(), initFarm()]);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
