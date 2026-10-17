import { expect, test, type Page } from '@playwright/test';
import { GAME_WIDTH, TILE } from '../../src/config/tuning';
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

/** Clicks the middle of map tile (x, y). */
async function clickTile(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  await page.mouse.click(
    box.x + (x * TILE + TILE / 2) * zoom,
    box.y + (y * TILE + TILE / 2) * zoom,
  );
}

test('clicking a marine selects it and Esc deselects', async ({ page }) => {
  await openGame(page, '?seed=42');
  const { units } = await snapshot(page);
  const marine = units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  expect((await snapshot(page)).selected).toBeNull();
  await clickTile(page, marine.x, marine.y);
  await expect.poll(async () => (await snapshot(page)).selected).toBe(marine.id);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).selected).toBeNull();
});

test("clicking a marine's head also selects it", async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine' && u.y > 2);
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y - 1);
  await expect.poll(async () => (await snapshot(page)).selected).toBe(marine.id);
});

test('clicking an alien does not select it', async ({ page }) => {
  await openGame(page, '?seed=42');
  const alien = (await snapshot(page)).units.find((u) => u.side === 'alien');
  if (!alien) throw new Error('no alien');
  await clickTile(page, alien.x, alien.y);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).selected).toBeNull();
});

test('?seed= in the URL sets the random seed', async ({ page }) => {
  await openGame(page, '?seed=42');
  expect((await snapshot(page)).seed).toBe(42);
});
