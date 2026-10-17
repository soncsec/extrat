import { expect, test, type Page } from '@playwright/test';
import type { GameSnapshot } from '../../src/scenes/BattleScene';

/** Records console errors, uncaught exceptions and requests to other hosts. */
function watchPage(page: Page): { errors: string[]; foreignRequests: string[] } {
  const errors: string[] = [];
  const foreignRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && url.hostname !== 'localhost') {
      foreignRequests.push(req.url());
    }
  });
  return { errors, foreignRequests };
}

async function snapshot(page: Page): Promise<GameSnapshot> {
  const snap = await page.evaluate(() => window.__game?.snapshot() ?? null);
  if (!snap) throw new Error('game scene is not running');
  return snap;
}

async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`./${query}`);
  await expect
    .poll(() => page.evaluate(() => window.__game?.scene() ?? null), { timeout: 15_000 })
    .toBe('Battle');
}

test('boots with no console errors and no third-party requests', async ({ page }) => {
  const watched = watchPage(page);
  await openGame(page);
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(watched.errors).toEqual([]);
  expect(watched.foreignRequests).toEqual([]);
});

test('the same seed always draws the same map', async ({ page }) => {
  await openGame(page, '?seed=777');
  const first = await snapshot(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__game?.scene() ?? null)).toBe('Battle');
  expect((await snapshot(page)).layout).toBe(first.layout);
});

test('N generates a different map', async ({ page }) => {
  await openGame(page, '?seed=777');
  const before = await snapshot(page);
  await page.locator('#game canvas').click();
  await page.keyboard.press('n');
  await expect.poll(async () => (await snapshot(page)).mapSeed).not.toBe(before.mapSeed);
  expect((await snapshot(page)).layout).not.toBe(before.layout);
});

test('?seed= in the URL sets the random seed', async ({ page }) => {
  await openGame(page, '?seed=42');
  expect((await snapshot(page)).seed).toBe(42);
});
