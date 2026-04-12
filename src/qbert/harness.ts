/**
 * Test harness entry point for rendering Q*bert game states in Playwright.
 * Exposes window.__qbertRender(state, now?) to render a GameState snapshot.
 */
import type { GameState } from './types';
import { DomRenderer } from './renderer';

let renderer: DomRenderer | null = null;
const container = document.getElementById('qb-pyramid-container')!;

function renderState(state: GameState, now?: number): void {
  if (renderer) renderer.destroy();
  renderer = new DomRenderer();
  renderer.init(container, state);
  renderer.render(state, now ?? 0);
}

// Expose to Playwright
(window as unknown as Record<string, unknown>).__qbertRender = renderState;

// Signal that the harness is ready
document.body.setAttribute('data-harness-ready', 'true');
