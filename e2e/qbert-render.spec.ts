import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

interface Fixture {
  description: string;
  renderTime?: number;
  assertions: Record<string, unknown>;
  state: Record<string, unknown>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');
const fixtureFiles = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();

for (const file of fixtureFiles) {
  const fixture: Fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf-8'));
  const name = file.replace('.json', '');

  test.describe(`Q*bert render: ${name}`, () => {
    test(`renders correctly — ${fixture.description}`, async ({ page }) => {
      await page.goto('/Funsounds/qbert-harness.html');
      await page.waitForSelector('[data-harness-ready="true"]');

      // Inject the game state and render
      const renderTime = fixture.renderTime ?? 0;
      await page.evaluate(
        ({ state, time }) => {
          (window as unknown as Record<string, Function>).__qbertRender(state, time);
        },
        { state: fixture.state, time: renderTime },
      );

      // Small wait for DOM to settle and transitions to start
      await page.waitForTimeout(100);

      // ---- DOM assertions ----
      const a = fixture.assertions;

      // HUD values
      if (a.hudScore !== undefined) {
        await expect(page.locator('#qb-score')).toHaveText(String(a.hudScore));
      }
      if (a.hudLevel !== undefined) {
        await expect(page.locator('#qb-level')).toHaveText(String(a.hudLevel));
      }
      if (a.hudLives !== undefined) {
        await expect(page.locator('#qb-lives')).toHaveText(String(a.hudLives));
      }

      // Player visibility
      if (a.playerVisible !== undefined) {
        const player = page.locator('.qb-player');
        if (a.playerVisible) {
          await expect(player).toBeVisible();
        } else {
          await expect(player).not.toBeVisible();
        }
      }

      // Player alive (opacity check)
      if (a.playerAlive !== undefined) {
        const opacity = await page.locator('.qb-player').evaluate((el) => getComputedStyle(el).opacity);
        if (a.playerAlive) {
          expect(Number(opacity)).toBeGreaterThan(0.5);
        } else {
          expect(Number(opacity)).toBeLessThanOrEqual(0.5);
        }
      }

      // Enemy count
      if (a.enemyCount !== undefined) {
        const enemies = page.locator('.qb-entity:not(.qb-player)');
        await expect(enemies).toHaveCount(Number(a.enemyCount));
      }

      // Enemy types present
      if (Array.isArray(a.enemyTypes)) {
        const enemyTexts = await page.locator('.qb-entity:not(.qb-player)').allTextContents();
        const emojiMap: Record<string, string> = {
          red_ball: '\u{1F534}',
          coily_ball: '\u{1F7E3}',
          coily: '\u{1F40D}',
          slick: '\u{1F49A}',
          sam: '\u{1F49C}',
        };
        for (const type of a.enemyTypes as string[]) {
          const emoji = emojiMap[type];
          expect(enemyTexts.some((t) => t.includes(emoji))).toBe(true);
        }
      }

      // Cube counts
      if (a.totalCubes !== undefined) {
        await expect(page.locator('.qb-cube')).toHaveCount(Number(a.totalCubes));
      }

      // Disc assertions
      if (a.discCount !== undefined) {
        await expect(page.locator('.qb-disc')).toHaveCount(Number(a.discCount));
      }
      if (a.visibleDiscCount !== undefined) {
        const visibleDiscs = page.locator('.qb-disc:not([style*="display: none"])');
        await expect(visibleDiscs).toHaveCount(Number(a.visibleDiscCount));
      }

      // ---- Screenshot comparison ----
      await expect(page).toHaveScreenshot(`${name}.png`, {
        maxDiffPixelRatio: 0.01,
      });
    });
  });
}
