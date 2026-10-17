import { expect, test, type Page } from '@playwright/test';
import { GAME_WIDTH, MAP_ROWS, TILE } from '../../src/config/tuning';
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

async function waitForScene(page: Page, key: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__game?.scene() ?? null), { timeout: 15_000 })
    .toBe(key);
}

/** Opens the game and starts a battle from the title screen. */
async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`./${query}`);
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
}

const activeScenes = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__game?.scenes() ?? []);

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
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
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
  const target = (await snapshot(page)).reachable
    .filter((t) => t.cost === 1)
    .reduce((a, b) => (b.x > a.x ? b : a));
  await clickTile(page, target.x, target.y);
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      const u = s.units.find((v) => v.id === marine.id);
      return s.busy ? 'running' : `${u?.x},${u?.y},${u?.ap}`;
    })
    .toBe(`${target.x},${target.y},${marine.ap - 1}`);
});

test('a dash to a yellow tile uses both action points', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  const dash = (await snapshot(page)).reachable.find((t) => t.cost === 2);
  if (!dash) throw new Error('no dash tile');
  await clickTile(page, dash.x, dash.y);
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      const u = s.units.find((v) => v.id === marine.id);
      return s.busy ? 'running' : `${u?.x},${u?.y},${u?.ap}`;
    })
    .toBe(`${dash.x},${dash.y},0`);
});

test('a marine can move onto the tile just above a squadmate', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marines = (await snapshot(page)).units.filter((u) => u.side === 'marine');
  const mover = marines[0];
  if (!mover) throw new Error('no marine');
  await clickTile(page, mover.x, mover.y);
  const { reachable } = await snapshot(page);
  // That tile is also where the squadmate's head is drawn.
  const target = marines
    .slice(1)
    .map((m) => ({ x: m.x, y: m.y - 1 }))
    .find((t) => reachable.some((r) => r.x === t.x && r.y === t.y));
  if (!target) throw new Error('no squadmate with a reachable tile above it on this map');
  await clickTile(page, target.x, target.y);
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      const u = s.units.find((v) => v.id === mover.id);
      return s.busy ? 'running' : `${s.selected} ${u?.x},${u?.y}`;
    })
    .toBe(`${mover.id} ${target.x},${target.y}`);
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

/**
 * Map 1: once the first marine moves as far east as it can, an alien is in range
 * and in sight. Selects that marine, moves it, and returns it with a target it can shoot.
 */
const SHOT_SEED = '?seed=1';

async function moveEastForAShot(
  page: Page,
): Promise<{ marineId: string; alien: GameSnapshot['units'][number] }> {
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  const dest = (await snapshot(page)).reachable
    .filter((t) => t.cost === 1)
    .reduce((a, b) => (b.x > a.x ? b : a));
  await clickTile(page, dest.x, dest.y);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
  const s = await snapshot(page);
  const alien = s.units.find((u) => u.id === s.shootable[0]);
  if (!alien)
    throw new Error(`no shootable alien on ${SHOT_SEED} (the map generator may have changed)`);
  return { marineId: marine.id, alien };
}

test('a marine aims at an alien, fires, and the shot is resolved', async ({ page }) => {
  await openGame(page, SHOT_SEED);
  const { marineId, alien } = await moveEastForAShot(page);
  await clickTile(page, alien.x, alien.y);
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBe(alien.id);
  const aimed = await snapshot(page);
  expect(aimed.lastShot).toBeNull();
  const odds = aimed.aimOdds;
  if (!odds) throw new Error('no odds shown while aiming');
  expect(odds.hit).toBe(odds.aim + odds.range - odds.coverPenalty);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snapshot(page)).lastShot?.targetId).toBe(alien.id);
  await expect.poll(async () => (await snapshot(page)).busy).toBe(false);

  const after = await snapshot(page);
  const shot = after.lastShot;
  if (!shot) throw new Error('no shot');
  expect(shot.chance).toBe(odds.hit); // the shot used the odds the panel showed
  expect(after.units.find((u) => u.id === marineId)?.ap).toBe(0);
  expect(after.units.find((u) => u.id === alien.id)?.hp).toBe(Math.max(0, alien.hp - shot.damage));
  expect(after.aimTarget).toBeNull();
});

test('Esc cancels aiming before the shot', async ({ page }) => {
  await openGame(page, SHOT_SEED);
  const { marineId, alien } = await moveEastForAShot(page);
  await clickTile(page, alien.x, alien.y);
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBe(alien.id);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBeNull();
  const after = await snapshot(page);
  expect(after.selected).toBe(marineId);
  expect(after.lastShot).toBeNull();
});

test('an alien behind a tree or out of range cannot be aimed at', async ({ page }) => {
  await openGame(page, SHOT_SEED);
  const { alien } = await moveEastForAShot(page);
  const s = await snapshot(page);
  const blocked = s.units.find(
    (u) => u.side === 'alien' && u.hp > 0 && !s.shootable.includes(u.id),
  );
  if (!blocked) throw new Error(`expected an alien that can't be shot on ${SHOT_SEED}`);
  await clickTile(page, blocked.x, blocked.y);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).aimTarget).toBeNull();
  // The shootable one still can be.
  await clickTile(page, alien.x, alien.y);
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBe(alien.id);
});

test('E ends the turn; the aliens advance, then round 2 begins', async ({ page }) => {
  await openGame(page, '?seed=42');
  const before = await snapshot(page);
  expect(before).toMatchObject({ turn: 'marine', round: 1 });
  await page.locator('#game canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('e');
  await expect.poll(async () => (await snapshot(page)).turn).toBe('alien');
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return s.turn === 'marine' && !s.busy ? s.round : 0;
      },
      { timeout: 20_000 },
    )
    .toBe(2);
  const after = await snapshot(page);
  const westmost = (s: typeof after): number =>
    Math.min(...s.units.filter((u) => u.side === 'alien').map((u) => u.x));
  expect(westmost(after)).toBeLessThan(westmost(before));
  expect(after.units.filter((u) => u.side === 'marine').every((u) => u.ap === 2)).toBe(true);
});

test('the End Turn button ends the turn', async ({ page }) => {
  await openGame(page, '?seed=42');
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  // The button sits at the right end of the info bar's first line.
  await page.mouse.click(box.x + (GAME_WIDTH - 25) * zoom, box.y + (MAP_ROWS * TILE + 9) * zoom);
  await expect.poll(async () => (await snapshot(page)).turn).toBe('alien');
});

test('the title screen starts a mission with its button', async ({ page }) => {
  await page.goto('./');
  await waitForScene(page, 'Title');
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  // START MISSION is centred at y = 172.
  await page.mouse.click(box.x + (GAME_WIDTH / 2) * zoom, box.y + 172 * zoom);
  await waitForScene(page, 'Battle');
});

test('without ?seed= each new game gets a different map', async ({ page }) => {
  await openGame(page);
  const first = (await snapshot(page)).mapSeed;
  await page.reload();
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  expect((await snapshot(page)).mapSeed).not.toBe(first);
});

test('wiping out the aliens shows the win screen; Enter plays again', async ({ page }) => {
  await openGame(page, '?seed=42');
  const before = await snapshot(page);
  for (const a of before.units.filter((u) => u.side === 'alien')) {
    await page.evaluate((id) => window.__game?.setHp(id, 0), a.id);
  }
  await expect.poll(() => activeScenes(page)).toContain('Result');
  expect((await snapshot(page)).over).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page)).not.toContain('Result');
  const after = await snapshot(page);
  expect(after.over).toBe(false);
  expect(after.mapSeed).not.toBe(before.mapSeed);
  expect(after.units.every((u) => u.hp > 0)).toBe(true);
});

test('losing the squad shows the loss screen; Esc goes to the title', async ({ page }) => {
  await openGame(page, '?seed=42');
  for (const m of (await snapshot(page)).units.filter((u) => u.side === 'marine')) {
    await page.evaluate((id) => window.__game?.setHp(id, 0), m.id);
  }
  await expect.poll(() => activeScenes(page)).toContain('Result');
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Title');
  expect(await activeScenes(page)).toEqual(['Title']);
});

/** Plays one scripted turn on SHOT_SEED: move east, shoot, end the turn, let the aliens act. */
async function scriptedTurn(page: Page): Promise<GameSnapshot> {
  const { alien } = await moveEastForAShot(page);
  await clickTile(page, alien.x, alien.y);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snapshot(page)).lastShot).not.toBeNull();
  // The other marines still have action points, so the turn goes on until E is pressed.
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
  await page.keyboard.press('e');
  await expect
    .poll(
      async () => {
        const t = await snapshot(page);
        return t.turn === 'marine' && !t.busy ? t.round : 0;
      },
      { timeout: 20_000 },
    )
    .toBe(2);
  return snapshot(page);
}

test('a fixed-seed turn plays out exactly the same every time', async ({ page }) => {
  await openGame(page, SHOT_SEED);
  const start = await snapshot(page);
  const first = await scriptedTurn(page);
  await page.reload();
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const second = await scriptedTurn(page);
  expect(second.units).toEqual(first.units);
  expect(second.lastShot).toEqual(first.lastShot);
  // The aliens acted on their turn: one of them moved, or a marine was hurt.
  const was = (id: string): GameSnapshot['units'][number] | undefined =>
    start.units.find((u) => u.id === id);
  const alienMoved = first.units.some(
    (u) => u.side === 'alien' && (u.x !== was(u.id)?.x || u.y !== was(u.id)?.y),
  );
  const marineHurt = first.units.some((u) => u.side === 'marine' && u.hp < (was(u.id)?.hp ?? 0));
  expect(alienMoved || marineHurt).toBe(true);
});

test('?seed= in the URL sets the random seed', async ({ page }) => {
  await openGame(page, '?seed=42');
  expect((await snapshot(page)).seed).toBe(42);
});
