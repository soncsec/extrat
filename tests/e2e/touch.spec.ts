import { expect, test, type Page } from '@playwright/test';
import { GAME_HEIGHT, GAME_WIDTH, TILE } from '../../src/config/tuning';
import type { GameSnapshot } from '../../src/scenes/BattleScene';

/**
 * Phones and tablets (owner decision 2026-10-18): a phone held sideways, with a
 * touchscreen and 3 device pixels per CSS pixel.
 */
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true });

async function snapshot(page: Page): Promise<GameSnapshot> {
  const snap = await page.evaluate(() => window.__game?.snapshot() ?? null);
  if (!snap) throw new Error('game scene is not running');
  return snap;
}

async function waitForScene(page: Page, key: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__game?.scene() ?? null), { timeout: 15_000 })
    .toBe(key);
}

/** Taps the middle of map tile (x, y) with a finger. */
async function tapTile(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  await page.touchscreen.tap(
    box.x + (x * TILE + TILE / 2) * zoom,
    box.y + (y * TILE + TILE / 2) * zoom,
  );
}

/** Taps a point given in game pixels. */
async function tapAt(page: Page, gx: number, gy: number): Promise<void> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  await page.touchscreen.tap(box.x + gx * zoom, box.y + gy * zoom);
}

test('a phone shows the game bigger than 1x, and every art pixel on whole screen pixels', async ({
  page,
}) => {
  await page.goto('./?seed=42');
  await waitForScene(page, 'Title');
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  expect(zoom).toBeCloseTo(4 / 3, 2);
  expect(Math.abs(zoom * 3 - Math.round(zoom * 3))).toBeLessThan(0.01);
  expect(box.height).toBeLessThanOrEqual(390);
  expect(box.height).toBeCloseTo(GAME_HEIGHT * zoom, 0);
});

test('a tap on a tile shows the move; a second tap on it makes the move', async ({ page }) => {
  await page.goto('./?seed=42');
  await waitForScene(page, 'Title');
  await tapAt(page, GAME_WIDTH / 2, 172); // START MISSION
  await waitForScene(page, 'Battle');
  // With nothing selected, the prompt says TAP, not CLICK (T3).
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).prompt).toBe('Tap a marine to select it');
  const start = await snapshot(page);
  const marine = start.units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await tapTile(page, marine.x, marine.y);
  await expect.poll(async () => (await snapshot(page)).selected).toBe(marine.id);
  const dest = (await snapshot(page)).reachable.find((t) => t.cost === 1);
  if (!dest) throw new Error('nowhere to move');
  // First tap: a preview only.
  await tapTile(page, dest.x, dest.y);
  const previewed = await snapshot(page);
  expect(previewed.pending).toEqual({ x: dest.x, y: dest.y });
  expect(previewed.units.find((u) => u.id === marine.id)).toMatchObject({
    x: marine.x,
    y: marine.y,
  });
  // Second tap on the same tile: the move.
  await tapTile(page, dest.x, dest.y);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
  const moved = await snapshot(page);
  expect(moved.units.find((u) => u.id === marine.id)).toMatchObject({ x: dest.x, y: dest.y });
  expect(moved.pending).toBeNull();
});

test('tapping a different tile moves the preview instead of moving', async ({ page }) => {
  await page.goto('./?seed=42');
  await waitForScene(page, 'Title');
  await tapAt(page, GAME_WIDTH / 2, 172);
  await waitForScene(page, 'Battle');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await tapTile(page, marine.x, marine.y);
  await expect.poll(async () => (await snapshot(page)).selected).toBe(marine.id);
  const [a, b] = (await snapshot(page)).reachable.filter((t) => t.cost === 1);
  if (!a || !b) throw new Error('not enough tiles');
  await tapTile(page, a.x, a.y);
  await tapTile(page, b.x, b.y);
  const s = await snapshot(page);
  expect(s.pending).toEqual({ x: b.x, y: b.y });
  expect(s.units.find((u) => u.id === marine.id)).toMatchObject({ x: marine.x, y: marine.y });
});

test('the ? button opens the help, and a tap turns its pages and closes it', async ({ page }) => {
  await page.goto('./?seed=42');
  await waitForScene(page, 'Title');
  await tapAt(page, GAME_WIDTH / 2, 172);
  await waitForScene(page, 'Battle');
  await tapAt(page, GAME_WIDTH - 10, 10);
  await expect.poll(() => page.evaluate(() => window.__game?.scenes() ?? [])).toContain('Help');
  // The tap that opened it doesn't also turn the page or move anyone.
  await tapAt(page, GAME_WIDTH / 2, GAME_HEIGHT / 2);
  await tapAt(page, GAME_WIDTH / 2, GAME_HEIGHT / 2);
  await expect.poll(() => page.evaluate(() => window.__game?.scenes() ?? [])).not.toContain('Help');
  await waitForScene(page, 'Battle');
});

test.describe('held upright', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('asks for the device to be turned sideways', async ({ page }) => {
    await page.goto('./');
    await waitForScene(page, 'Title');
    await expect(page.locator('#rotate')).toBeVisible();
    await expect(page.locator('#rotate')).toContainText(/sideways/i);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#rotate')).toBeHidden();
  });
});

test('a tap during the alien turn fast-forwards it, and the speed resets after (M5.11)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('./?seed=7');
  await waitForScene(page, 'Title');
  await tapAt(page, GAME_WIDTH / 2, 172); // START MISSION
  await waitForScene(page, 'Battle');
  // The alien turn here is short (the pods are dormant), and on a loaded machine a tap
  // could land after it ends. At a quarter speed it lasts long enough; the tap's
  // fast-forward replaces that speed, and the end of the turn puts it back to normal.
  await page.evaluate(() => window.__game?.setSpeed(0.25));
  await page.keyboard.press('e');
  await expect.poll(async () => (await snapshot(page)).busy).toBe(true);
  await tapTile(page, 5, 5);
  await expect.poll(async () => (await snapshot(page)).fast).toBe(true);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 40_000 }).toBe(false);
  expect((await snapshot(page)).fast).toBe(false);
});
