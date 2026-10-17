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

test('a selected marine runs to a clicked tile and spends an action point', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  await expect.poll(async () => (await snapshot(page)).reachable.length).toBeGreaterThan(0);
  // The farthest reachable tile to the east, so the run is easy to see.
  const target = (await snapshot(page)).reachable.reduce((a, b) => (b.x > a.x ? b : a));
  await clickTile(page, target.x, target.y);
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      const u = s.units.find((v) => v.id === marine.id);
      return s.busy ? 'running' : `${u?.x},${u?.y},${u?.ap}`;
    })
    .toBe(`${target.x},${target.y},${marine.ap - 1}`);
});

test('clicking a tile out of range does not move the marine', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  await clickTile(page, 12, 13);
  await page.waitForTimeout(500);
  const after = (await snapshot(page)).units.find((u) => u.id === marine.id);
  expect(after).toMatchObject({ x: marine.x, y: marine.y, ap: marine.ap });
});

test('a marine aims at an alien, fires, and the shot is resolved', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  // Move east first so an alien is in range.
  await clickTile(page, marine.x, marine.y);
  const target = (await snapshot(page)).reachable.reduce((a, b) => (b.x > a.x ? b : a));
  await clickTile(page, target.x, target.y);
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  const s = await snapshot(page);
  const me = s.units.find((u) => u.id === marine.id);
  if (!me) throw new Error('marine vanished');
  const alien = s.units
    .filter((u) => u.side === 'alien')
    .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  if (!alien) throw new Error('no alien');

  await clickTile(page, alien.x, alien.y);
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBe(alien.id);
  expect((await snapshot(page)).lastShot).toBeNull();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snapshot(page)).lastShot?.targetId).toBe(alien.id);
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);

  const after = await snapshot(page);
  const shot = after.lastShot;
  if (!shot) throw new Error('no shot');
  expect(after.units.find((u) => u.id === marine.id)?.ap).toBe(0);
  expect(after.units.find((u) => u.id === alien.id)?.hp).toBe(Math.max(0, alien.hp - shot.damage));
  expect(after.aimTarget).toBeNull();
});

test('Esc cancels aiming before the shot', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  const target = (await snapshot(page)).reachable.reduce((a, b) => (b.x > a.x ? b : a));
  await clickTile(page, target.x, target.y);
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);
  const s = await snapshot(page);
  const me = s.units.find((u) => u.id === marine.id);
  const alien = s.units
    .filter((u) => u.side === 'alien')
    .sort(
      (a, b) =>
        Math.hypot(a.x - (me?.x ?? 0), a.y - (me?.y ?? 0)) -
        Math.hypot(b.x - (me?.x ?? 0), b.y - (me?.y ?? 0)),
    )[0];
  if (!alien) throw new Error('no alien');
  await clickTile(page, alien.x, alien.y);
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBe(alien.id);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBeNull();
  const after = await snapshot(page);
  expect(after.selected).toBe(marine.id);
  expect(after.lastShot).toBeNull();
});

test('?seed= in the URL sets the random seed', async ({ page }) => {
  await openGame(page, '?seed=42');
  expect((await snapshot(page)).seed).toBe(42);
});
