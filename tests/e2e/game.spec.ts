import { expect, test, type Page } from '@playwright/test';
import { GAME_WIDTH, MAP_COLS, MAP_ROWS, TILE } from '../../src/config/tuning';
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

/**
 * Opens the game and starts a battle from the title screen. With ?seed= that's a
 * one-off skirmish; without, a campaign, whose briefing comes first.
 */
async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`./${query}`);
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  if (!/seed=/i.test(query)) {
    await waitForScene(page, 'Briefing');
    await page.keyboard.press('Enter');
  }
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
  // Map 7: the run east spots no aliens (spotting a pod stops a move short).
  await openGame(page, '?seed=7');
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
  // The mover got there: the click wasn't taken as selecting the squadmate. (Which marine
  // is selected afterwards isn't checked: if the move used both points, the next marine
  // is selected automatically.)
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      const u = s.units.find((v) => v.id === mover.id);
      return s.busy ? 'running' : `${u?.x},${u?.y}`;
    })
    .toBe(`${target.x},${target.y}`);
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
 * Map 33: once the first marine moves as far east as a normal move allows, one alien is
 * in range and in sight, and the other is still hidden in the fog. Selects that marine,
 * moves it, and returns it with a target it can shoot.
 */
const SHOT_SEED = '?seed=33';

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

test('aliens start hidden and dormant; spotting one wakes its whole pod', async ({ page }) => {
  await openGame(page, SHOT_SEED);
  const start = await snapshot(page);
  const aliens = start.units.filter((u) => u.side === 'alien');
  expect(aliens.every((u) => !u.seen && u.dormant)).toBe(true);
  expect(start.units.filter((u) => u.side === 'marine').every((u) => u.seen)).toBe(true);
  const { alien } = await moveEastForAShot(page);
  const after = await snapshot(page);
  const target = after.units.find((u) => u.id === alien.id);
  expect(target).toMatchObject({ seen: true, dormant: false });
  // The rest of the target's pod woke with it; the other pod still waits, unseen.
  const awake = after.units.filter((u) => u.side === 'alien' && !u.dormant);
  const asleep = after.units.filter((u) => u.side === 'alien' && u.dormant);
  expect(awake).toHaveLength(2);
  expect(asleep).toHaveLength(2);
  expect(asleep.every((u) => !u.seen)).toBe(true);
});

test('a move cut short by a sighting leaves its unused squares as a free move', async ({
  page,
}) => {
  await openGame(page, SHOT_SEED);
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  // Map 33: a dash north to (4,4) spots a pod after 8 squares, at (4,6). Both points are
  // spent, and the 2 squares not walked are left as a free move.
  const dash = { x: 4, y: 4 };
  await clickTile(page, dash.x, dash.y);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
  const stopped = await snapshot(page);
  const m = stopped.units.find((u) => u.id === marine.id);
  if (!m) throw new Error('marine gone');
  expect(m).toMatchObject({ x: 4, y: 6, ap: 0, freeSteps: 2 });
  // The marine stays selected, and its free squares cost nothing.
  expect(stopped.selected).toBe(marine.id);
  const free = stopped.reachable.filter((t) => t.cost === 0);
  expect(free.length).toBeGreaterThan(0);
  const back = free.reduce((a, b) => (b.y > a.y ? b : a));
  await clickTile(page, back.x, back.y);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
  const after = (await snapshot(page)).units.find((u) => u.id === marine.id);
  expect(after).toMatchObject({ x: back.x, y: back.y, ap: m.ap, freeSteps: 0 });
});

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

test('an alien the marine cannot shoot (in the fog, behind trees, out of range) cannot be aimed at', async ({
  page,
}) => {
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

test('R reloads an empty clip for one action point, and does nothing when full', async ({
  page,
}) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  expect(marine.ammo).toBe(3);
  await clickTile(page, marine.x, marine.y);
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  expect((await snapshot(page)).units.find((u) => u.id === marine.id)).toMatchObject({
    ammo: 3,
    ap: 2,
  });

  await page.evaluate((id) => window.__game?.setAmmo(id, 0), marine.id);
  await page.keyboard.press('r');
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      const u = s.units.find((v) => v.id === marine.id);
      return s.busy ? 'reloading' : `${u?.ammo},${u?.ap}`;
    })
    .toBe('3,1');
});

test('O puts a marine on overwatch, and it fires when an alien moves into sight', async ({
  page,
}) => {
  // Plays a whole alien turn with animations: near 30 s on a loaded machine (T1).
  test.setTimeout(60_000);
  // Wake a pod first: dormant aliens wait instead of advancing.
  await openGame(page, SHOT_SEED);
  await moveEastForAShot(page);
  const marines = (await snapshot(page)).units.filter((u) => u.side === 'marine');
  // Every marine watches, so whichever way the aliens come, someone sees them.
  for (const m of marines) {
    await clickTile(page, m.x, m.y);
    await page.keyboard.press('o');
    await expect
      .poll(async () => (await snapshot(page)).units.find((u) => u.id === m.id)?.overwatch)
      .toBe(true);
    // Ready for the next order, or (after the last marine) the alien turn has begun.
    await expect
      .poll(async () => {
        const s = await snapshot(page);
        return !s.busy || s.turn === 'alien';
      })
      .toBe(true);
  }
  // With every marine out of points the turn ends by itself; wait for round 2.
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return s.turn === 'marine' && !s.busy ? s.round : 0;
      },
      { timeout: 30_000 },
    )
    .toBe(2);
  const after = await snapshot(page);
  // Overwatch has ended for everyone, and at least one marine fired a reaction shot.
  expect(after.units.filter((u) => u.side === 'marine').every((u) => !u.overwatch)).toBe(true);
  const fired = after.units.filter((u) => u.side === 'marine' && (u.ammo ?? 3) < 3);
  expect(fired.length).toBeGreaterThan(0);
});

test('effect sprites are reused, not made new for every shot and hit', async ({ page }) => {
  // Plays a whole alien turn with animations: near 30 s on a loaded machine (T1).
  test.setTimeout(60_000);
  // Two full rounds of fighting on map 33: shots, hits, misses and alien attacks.
  await openGame(page, SHOT_SEED);
  const { alien } = await moveEastForAShot(page);
  await clickTile(page, alien.x, alien.y);
  await page.keyboard.press('Enter');
  for (const round of [2, 3]) {
    await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
    await page.keyboard.press('e');
    await expect
      .poll(
        async () => {
          const s = await snapshot(page);
          return s.turn === 'marine' && !s.busy ? s.round : 0;
        },
        { timeout: 60_000 },
      )
      .toBe(round);
  }
  const s = await snapshot(page);
  expect(s.lastShot).not.toBeNull();
  // Every effect after the first few reused a sprite: a handful are ever on screen at once.
  expect(s.fxSprites).toBeGreaterThan(0);
  expect(s.fxSprites).toBeLessThanOrEqual(6);
  expect(s.fxUses).toBeGreaterThan(s.fxSprites);
});

test('holding G down enters grenade mode once, without flickering back out', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  // A second keydown without a keyup is a key repeat, as when G is held. (Two, not
  // three: an odd number of toggles would end in grenade mode anyway.)
  await page.keyboard.down('g');
  await page.keyboard.down('g');
  await page.keyboard.up('g');
  await expect.poll(async () => (await snapshot(page)).mode).toBe('grenade');
  await page.waitForTimeout(200);
  expect((await snapshot(page)).mode).toBe('grenade');
  expect((await snapshot(page)).selected).toBe(marine.id);
});

test('H opens the help over a paused battle; keys go to the help until it closes', async ({
  page,
}) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  await page.keyboard.press('h');
  await expect.poll(() => activeScenes(page)).toContain('Help');
  await page.waitForTimeout(300);
  expect(await activeScenes(page)).toContain('Help'); // the opening press didn't close it
  // E and Esc while the help is open don't reach the battle.
  await page.keyboard.press('e');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect.poll(() => activeScenes(page)).not.toContain('Help');
  const s = await snapshot(page);
  expect(s.turn).toBe('marine');
  expect(s.selected).toBe(marine.id);
  // H opens it again, and H closes it.
  await page.keyboard.press('h');
  await expect.poll(() => activeScenes(page)).toContain('Help');
  await page.waitForTimeout(200);
  await page.keyboard.press('h');
  await expect.poll(() => activeScenes(page)).not.toContain('Help');
});

test('H on the title shows the help; Esc goes back to the title', async ({ page }) => {
  await page.goto('./');
  await waitForScene(page, 'Title');
  await page.keyboard.press('h');
  await expect.poll(() => activeScenes(page)).toContain('Help');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await expect.poll(() => activeScenes(page)).toEqual(['Title']);
});

test('G enters grenade mode and Esc leaves it', async ({ page }) => {
  await openGame(page, '?seed=42');
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  expect(marine.grenades).toBe(1);
  await clickTile(page, marine.x, marine.y);
  await page.keyboard.press('g');
  await expect.poll(async () => (await snapshot(page)).mode).toBe('grenade');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).mode).toBe('move');
  expect((await snapshot(page)).selected).toBe(marine.id); // Esc left grenade mode, not the marine

  await page.keyboard.press('Escape'); // and Esc again deselects
});

test('a grenade hits an alien for 2 and leaves it exposed', async ({ page }) => {
  // Plays a whole alien turn with animations: near 30 s on a loaded machine (T1).
  test.setTimeout(60_000);
  // Wake a pod (dormant aliens wait), then end turns until an alien comes within 8 tiles.
  await openGame(page, SHOT_SEED);
  await moveEastForAShot(page);
  type U = GameSnapshot['units'][number];
  let pair: { m: U; a: U; d: number } | undefined;
  for (let round = 1; round <= 5 && !pair; round++) {
    const s = await snapshot(page);
    const living = (side: string): U[] => s.units.filter((u) => u.side === side && u.hp > 0);
    pair = living('marine')
      .flatMap((m) => living('alien').map((a) => ({ m, a, d: Math.hypot(a.x - m.x, a.y - m.y) })))
      .filter((p) => p.d <= 8 && p.d > 2) // in range, and far enough not to hit the thrower
      .sort((p, q) => p.d - q.d)[0];
    if (pair) break;
    await page.locator('#game canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('e');
    await expect
      .poll(
        async () => {
          const t = await snapshot(page);
          return t.turn === 'marine' && !t.busy ? t.round : 0;
        },
        { timeout: 30_000 },
      )
      .toBe(round + 1);
  }
  if (!pair) throw new Error('no marine came within throwing range of an alien by round 5');
  await clickTile(page, pair.m.x, pair.m.y);
  await page.keyboard.press('g');
  await expect.poll(async () => (await snapshot(page)).mode).toBe('grenade');
  await clickTile(page, pair.a.x, pair.a.y);
  await expect
    .poll(async () => {
      const t = await snapshot(page);
      const u = t.units.find((v) => v.id === pair.m.id);
      return t.busy ? 'throwing' : `${u?.grenades},${u?.ap},${t.mode}`;
    })
    .toBe('0,0,move');
  const hit = (await snapshot(page)).units.find((u) => u.id === pair.a.id);
  expect(hit?.hp).toBe(Math.max(0, pair.a.hp - 2));
  expect(hit?.exposed).toBe((hit?.hp ?? 0) > 0);
});

test('Tab and 1-4 pick marines; Tab skips marines with no actions left', async ({ page }) => {
  await openGame(page, '?seed=42');
  const ids = (await snapshot(page)).units.filter((u) => u.side === 'marine').map((u) => u.id);
  await page.locator('#game canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await snapshot(page)).selected).toBe(ids[0]);
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await snapshot(page)).selected).toBe(ids[1]);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(async () => (await snapshot(page)).selected).toBe(ids[0]);
  await page.keyboard.press('3');
  await expect.poll(async () => (await snapshot(page)).selected).toBe(ids[2]);
  // Marine 3 goes on overwatch (no actions left), so the next marine is picked for us...
  await page.keyboard.press('o');
  // The pick waits for the overwatch animation, whose game clock slows when the frame
  // rate drops on a loaded machine (T1).
  await expect.poll(async () => (await snapshot(page)).selected, { timeout: 15_000 }).toBe(ids[3]);
  // ...and Tab from marine 2 skips marine 3.
  await page.keyboard.press('2');
  await page.keyboard.press('Tab');
  await expect.poll(async () => (await snapshot(page)).selected).toBe(ids[3]);
});

test('F aims at the best target, then cycles; Enter fires', async ({ page }) => {
  await openGame(page, SHOT_SEED);
  await moveEastForAShot(page);
  const { shootable } = await snapshot(page);
  await page.keyboard.press('f');
  await expect.poll(async () => (await snapshot(page)).aimTarget).toBe(shootable[0]);
  await page.keyboard.press('f');
  // With one target F stays on it; with more it moves to the next.
  await expect
    .poll(async () => (await snapshot(page)).aimTarget)
    .toBe(shootable[1 % shootable.length]);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await snapshot(page)).lastShot?.targetId)
    .toBe(shootable[1 % shootable.length]);
});

test('E ends the turn: awake aliens act, dormant pods wait, then round 2 begins', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openGame(page, SHOT_SEED);
  await moveEastForAShot(page); // spots one pod; the other stays dormant
  const before = await snapshot(page);
  expect(before).toMatchObject({ turn: 'marine', round: 1 });
  await page.keyboard.press('e');
  await expect.poll(async () => (await snapshot(page)).turn).toBe('alien');
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return s.turn === 'marine' && !s.busy ? s.round : 0;
      },
      { timeout: 30_000 },
    )
    .toBe(2);
  const after = await snapshot(page);
  const was = (id: string) => before.units.find((u) => u.id === id);
  const aliens = after.units.filter((u) => u.side === 'alien');
  // The dormant pod didn't move.
  for (const a of aliens.filter((u) => was(u.id)?.dormant)) {
    expect({ x: a.x, y: a.y }).toEqual({ x: was(a.id)?.x, y: was(a.id)?.y });
  }
  // The awake pod acted: one of them moved, or a marine was hurt.
  const moved = aliens.some(
    (a) => !was(a.id)?.dormant && (a.x !== was(a.id)?.x || a.y !== was(a.id)?.y),
  );
  const hurt = after.units.some((u) => u.side === 'marine' && u.hp < (was(u.id)?.hp ?? 0));
  expect(moved || hurt).toBe(true);
  expect(after.units.filter((u) => u.side === 'marine' && u.hp > 0).every((u) => u.ap === 2)).toBe(
    true,
  );
});

test('the End Turn button ends the turn', async ({ page }) => {
  await openGame(page, '?seed=42');
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  // The button sits at the right end of the info bar's second line.
  await page.mouse.click(box.x + (GAME_WIDTH - 25) * zoom, box.y + (MAP_ROWS * TILE + 21) * zoom);
  await expect.poll(async () => (await snapshot(page)).turn).toBe('alien');
});

test('?landscape=ship opens an alien ship map with no errors (M4.3)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openGame(page, '?seed=7&landscape=ship');
  const snap = await snapshot(page);
  // The hull lines the top two rows; the field below has cover.
  expect(snap.layout.slice(0, 2 * MAP_COLS)).toBe('h'.repeat(2 * MAP_COLS));
  expect(snap.layout.slice(2 * MAP_COLS)).toMatch(/[tpc]/);
  expect(errors).toEqual([]);
});

test('?landscape=crash opens a crash site map with no errors (M4.3)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openGame(page, '?seed=42&landscape=crash');
  const snap = await snapshot(page);
  // Trees line the top; the field has the ship's wreckage (w) and scrap (s).
  expect(snap.layout.slice(0, 2 * MAP_COLS)).toBe('p'.repeat(2 * MAP_COLS));
  expect(snap.layout.slice(2 * MAP_COLS)).toMatch(/w/);
  expect(snap.layout.slice(2 * MAP_COLS)).toMatch(/s/);
  expect(errors).toEqual([]);
});

test('the title screen starts a campaign with its button', async ({ page }) => {
  await page.goto('./');
  await waitForScene(page, 'Title');
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  // START CAMPAIGN is centred at y = 172; the briefing comes first.
  await page.mouse.click(box.x + (GAME_WIDTH / 2) * zoom, box.y + 172 * zoom);
  await waitForScene(page, 'Briefing');
});

test('without ?seed= each new game gets a different map', async ({ page }) => {
  await openGame(page);
  const first = (await snapshot(page)).mapSeed;
  // On a desktop the prompt says CLICK (T3).
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).prompt).toBe('Click a marine to select it');
  await page.reload();
  await waitForScene(page, 'Title');
  // The first campaign is saved now, so the title offers to continue it: N starts anew.
  await page.keyboard.press('n');
  await waitForScene(page, 'Briefing');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  expect((await snapshot(page)).mapSeed).not.toBe(first);
});

/** Ends the current battle by setting one side's health to 0 (test hook). */
async function wipeOut(page: Page, side: 'alien' | 'marine'): Promise<void> {
  for (const u of (await snapshot(page)).units.filter((v) => v.side === side)) {
    await page.evaluate((id) => window.__game?.setHp(id, 0), u.id);
  }
  await expect.poll(() => activeScenes(page), { timeout: 15_000 }).toContain('Result');
}

/**
 * On the supply drop after a won mission (M5.10): press 1, 2 or 3 and wait for the
 * pick to be saved and the usual briefing to show.
 */
async function pickSupply(page: Page, key: '1' | '2' | '3' = '1'): Promise<void> {
  await waitForScene(page, 'Briefing');
  await page.keyboard.press(key);
  await expect
    .poll(() =>
      page.evaluate((k) => {
        const text = window.localStorage.getItem(k);
        return text
          ? (JSON.parse(text) as { campaign: { supply: unknown } }).campaign.supply
          : null;
      }, SAVE_KEY),
    )
    .not.toBeNull();
}

test('a campaign runs mission after mission with the same squad', async ({ page }) => {
  test.setTimeout(90_000);
  await openGame(page, '?campaign=7');
  const first = await snapshot(page);
  expect(first.campaign).toMatchObject({ mission: 0, attempt: 0 });
  const squad = first.units.filter((u) => u.side === 'marine').map((u) => u.name);
  // Mission 1 fields walkers only (M5.8).
  expect(first.units.filter((u) => u.side === 'alien').every((u) => u.kind === 'walker')).toBe(
    true,
  );
  // Mission 1 won: Enter goes to the supply drop, then the briefing, then the mission.
  await wipeOut(page, 'alien');
  await page.keyboard.press('Enter');
  await pickSupply(page);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const second = await snapshot(page);
  expect(second.campaign).toMatchObject({ mission: 1, attempt: 0 });
  expect(second.mapSeed).not.toBe(first.mapSeed);
  expect(second.units.filter((u) => u.side === 'marine').map((u) => u.name)).toEqual(squad);
});

test('a lost campaign mission is retried on a new map; REPLAY keeps the map', async ({ page }) => {
  await openGame(page, '?campaign=7');
  const first = await snapshot(page);
  await wipeOut(page, 'marine');
  // R replays the same map: same mission, same try.
  await page.keyboard.press('r');
  await expect.poll(() => activeScenes(page)).not.toContain('Result');
  const replay = await snapshot(page);
  expect(replay.campaign).toMatchObject({ mission: 0, attempt: 0 });
  expect(replay.mapSeed).toBe(first.mapSeed);
  // Lost again: Enter retries the mission on a new map.
  await wipeOut(page, 'marine');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Briefing');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const retry = await snapshot(page);
  expect(retry.campaign).toMatchObject({ mission: 0, attempt: 1 });
  expect(retry.mapSeed).not.toBe(first.mapSeed);
});

test('wins earn XP and promotions; a replayed win earns none (M5.2)', async ({ page }) => {
  test.setTimeout(90_000);
  await openGame(page, '?campaign=7');
  expect((await snapshot(page)).campaign?.xp).toEqual([0, 0, 0, 0]);
  // Mission 1 won: everyone gets the mission bonus. R replays the same map.
  await wipeOut(page, 'alien');
  await page.keyboard.press('r');
  await expect.poll(() => activeScenes(page)).not.toContain('Result');
  const replay = await snapshot(page);
  expect(replay.replaying).toBe(true);
  expect(replay.campaign?.xp).toEqual([10, 10, 10, 10]);
  // Closing the browser mid-replay and continuing still knows it is a replay. (The
  // plain address: ?campaign= would start that campaign afresh.)
  await page.goto('./');
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  expect((await snapshot(page)).replaying).toBe(true);
  // The replayed win earns nothing; the debrief says so.
  await wipeOut(page, 'alien');
  await page.keyboard.press('Enter');
  await pickSupply(page);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const second = await snapshot(page);
  expect(second.replaying).toBe(false);
  expect(second.campaign).toMatchObject({ mission: 1, xp: [10, 10, 10, 10] });
  expect(second.units.filter((u) => u.side === 'marine').every((u) => u.rank === 0)).toBe(true);
  // Mission 2 won: 20 XP each makes them all Squaddies.
  await wipeOut(page, 'alien');
  await page.keyboard.press('Enter');
  await pickSupply(page);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const third = await snapshot(page);
  expect(third.campaign?.xp).toEqual([20, 20, 20, 20]);
  expect(third.units.filter((u) => u.side === 'marine').every((u) => u.rank === 1)).toBe(true);
});

test('a fallen marine returns next mission, counted on the Wall of Shame (M5.3)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openGame(page, '?campaign=7');
  const first = await snapshot(page);
  expect(first.campaign?.deaths).toEqual([0, 0, 0, 0]);
  const m1 = first.units.find((u) => u.id === 'm1');
  if (!m1) throw new Error('no m1');
  await page.evaluate((id) => window.__game?.setHp(id, 0), m1.id);
  await wipeOut(page, 'alien');
  expect((await snapshot(page)).campaign?.deaths).toEqual([1, 0, 0, 0]);
  await page.keyboard.press('Enter');
  await pickSupply(page);
  // S opens the squad page; S again closes it.
  await page.keyboard.press('s');
  await expect.poll(() => activeScenes(page)).toContain('Squad');
  await page.keyboard.press('s');
  await expect.poll(() => activeScenes(page)).not.toContain('Squad');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const next = await snapshot(page);
  expect(next.campaign?.deaths).toEqual([1, 0, 0, 0]);
  const back = next.units.find((u) => u.id === 'm1');
  expect(back?.name).toBe(m1.name);
  expect(back?.hp).toBe(back?.maxHp);
});

test('winning all six missions completes the campaign', async ({ page }) => {
  test.setTimeout(120_000);
  await openGame(page, '?campaign=7');
  const alienCounts: number[] = [];
  for (let mission = 0; mission < 6; mission++) {
    const s = await snapshot(page);
    expect(s.campaign?.mission).toBe(mission);
    alienCounts.push(s.units.filter((u) => u.side === 'alien').length);
    await wipeOut(page, 'alien');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Briefing');
    if (mission < 5) {
      await pickSupply(page);
      await page.keyboard.press('Enter');
      await waitForScene(page, 'Battle');
    }
  }
  // The gentle ramp: 4, 4, 6, 6, 9 aliens; mission 6 is the boss and its two escort
  // groups (M5.6).
  expect(alienCounts).toEqual([4, 4, 6, 6, 9, 5]);
  // The briefing now shows the campaign victory; Enter goes back to the title.
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Title');
});

test('in the final mission, killing the boss alone wins the campaign (M5.6)', async ({ page }) => {
  test.setTimeout(120_000);
  await openGame(page, '?campaign=7');
  for (let mission = 0; mission < 5; mission++) {
    await wipeOut(page, 'alien');
    await page.keyboard.press('Enter');
    await pickSupply(page);
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Battle');
  }
  const s = await snapshot(page);
  expect(s.campaign?.mission).toBe(5);
  // On the alien ship: its hull lines the top row.
  expect(s.layout.slice(0, MAP_COLS)).toBe('h'.repeat(MAP_COLS));
  const boss = s.units.find((u) => u.kind === 'overseer');
  if (!boss) throw new Error('no boss in the final mission');
  // Only the boss goes down; its escorts are still standing.
  await page.evaluate((id) => window.__game?.setHp(id, 0), boss.id);
  await expect.poll(() => activeScenes(page)).toContain('Result');
  const after = await snapshot(page);
  expect(after.units.filter((u) => u.side === 'alien' && u.hp > 0).length).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Briefing');
  // The briefing shows the campaign victory; Enter goes back to the title.
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Title');
});

test('wiping out the aliens shows the win screen; Enter plays again', async ({ page }) => {
  await openGame(page, '?seed=42');
  const before = await snapshot(page);
  for (const a of before.units.filter((u) => u.side === 'alien')) {
    await page.evaluate((id) => window.__game?.setHp(id, 0), a.id);
  }
  await expect.poll(() => activeScenes(page), { timeout: 15_000 }).toContain('Result');
  expect((await snapshot(page)).over).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page)).not.toContain('Result');
  const after = await snapshot(page);
  expect(after.over).toBe(false);
  expect(after.mapSeed).not.toBe(before.mapSeed);
  expect(after.units.every((u) => u.hp > 0)).toBe(true);
});

test('R on the result screen replays the same map from the start', async ({ page }) => {
  await openGame(page, '?seed=42');
  const before = await snapshot(page);
  for (const a of before.units.filter((u) => u.side === 'alien')) {
    await page.evaluate((id) => window.__game?.setHp(id, 0), a.id);
  }
  await expect.poll(() => activeScenes(page), { timeout: 15_000 }).toContain('Result');
  await page.keyboard.press('r');
  await expect.poll(() => activeScenes(page)).not.toContain('Result');
  const after = await snapshot(page);
  expect(after.over).toBe(false);
  expect(after.round).toBe(1);
  // The same map and the same starting positions, everyone back to full health.
  expect(after.mapSeed).toBe(before.mapSeed);
  expect(after.layout).toBe(before.layout);
  expect(after.units).toEqual(before.units);
});

test('the map seed in the URL rebuilds the same map', async ({ page }) => {
  // ?seed=42 makes map 42 or, if that layout fails validation, a later one; either way
  // ?seed=<map seed> must give exactly that map back.
  await openGame(page, '?seed=42');
  const first = await snapshot(page);
  await openGame(page, `?seed=${first.mapSeed}`);
  const again = await snapshot(page);
  expect(again.mapSeed).toBe(first.mapSeed);
  expect(again.layout).toBe(first.layout);
  expect(again.units).toEqual(first.units);
});

test('losing the squad shows the loss screen; Esc goes to the title', async ({ page }) => {
  await openGame(page, '?seed=42');
  for (const m of (await snapshot(page)).units.filter((u) => u.side === 'marine')) {
    await page.evaluate((id) => window.__game?.setHp(id, 0), m.id);
  }
  await expect.poll(() => activeScenes(page), { timeout: 15_000 }).toContain('Result');
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

test('Space fast-forwards the alien turn, and the speed resets when it ends (M5.11)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openGame(page, '?seed=7');
  expect((await snapshot(page)).fast).toBe(false);
  await page.keyboard.press('e');
  await expect.poll(async () => (await snapshot(page)).busy).toBe(true);
  // One press, straight after the turn starts: a short alien turn (dormant pods) ends
  // in a couple of seconds, so toggling back and forth would race it.
  await page.keyboard.press(' ');
  await expect.poll(async () => (await snapshot(page)).fast).toBe(true);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 40_000 }).toBe(false);
  const after = await snapshot(page);
  expect(after.fast).toBe(false);
  expect(after.round).toBe(2);
});

test('a fixed-seed turn plays out exactly the same every time', async ({ page }) => {
  // Two full rounds, alien turns included, run back to back: more than the 30 s default.
  test.setTimeout(60_000);
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

/** What a resumed battle must match: where everyone is and what they have left. */
function unitState(s: GameSnapshot): unknown[] {
  return s.units.map(({ id, x, y, hp, ap, ammo, overwatch, grenades, dormant, poison }) => ({
    id,
    x,
    y,
    hp,
    ap,
    ammo,
    overwatch,
    grenades,
    dormant,
    poison,
  }));
}

const SAVE_KEY = 'extrat.campaign';

test('closing the browser mid-mission resumes the same turn (M5.5)', async ({ page }) => {
  test.setTimeout(90_000);
  await openGame(page);
  // Play a turn: a marine moves, the turn ends, the aliens act.
  const marine = (await snapshot(page)).units.find((u) => u.side === 'marine');
  if (!marine) throw new Error('no marine');
  await clickTile(page, marine.x, marine.y);
  const dest = (await snapshot(page)).reachable.find((t) => t.cost === 1);
  if (!dest) throw new Error('nowhere to move');
  await clickTile(page, dest.x, dest.y);
  await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
  await page.keyboard.press('e');
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return s.turn === 'marine' && !s.busy ? s.round : 0;
      },
      { timeout: 60_000 },
    )
    .toBe(2);
  const before = await snapshot(page);
  // "Close the browser": reload the page, then continue from the title.
  await page.reload();
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const after = await snapshot(page);
  expect(after.round).toBe(2);
  expect(after.turn).toBe('marine');
  expect(after.mapSeed).toBe(before.mapSeed);
  expect(after.layout).toBe(before.layout);
  expect(after.campaign).toEqual(before.campaign);
  expect(unitState(after)).toEqual(unitState(before));
});

test('a campaign saved between missions resumes at the next briefing', async ({ page }) => {
  await openGame(page);
  await wipeOut(page, 'alien');
  await page.reload();
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await pickSupply(page);
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  expect((await snapshot(page)).campaign).toMatchObject({ mission: 1, attempt: 0 });
});

test('a won mission brings a supply drop for every marine, next mission only (M5.10)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openGame(page, '?campaign=7');
  const first = await snapshot(page);
  const marines = (s: typeof first): typeof first.units =>
    s.units.filter((u) => u.side === 'marine');
  // Mission 1 has no supply.
  expect(first.campaign?.supply).toBeNull();
  await wipeOut(page, 'alien');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Briefing');
  // Enter doesn't skip the pick; the supply drop waits for one.
  await page.keyboard.press('Enter');
  await expect.poll(() => activeScenes(page)).not.toContain('Battle');
  // 2 picks armour, and it survives closing the browser at the briefing.
  await pickSupply(page, '2');
  await page.goto('./');
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Briefing');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const second = await snapshot(page);
  expect(second.campaign).toMatchObject({ mission: 1, supply: 'armour' });
  for (const m of marines(second)) expect(m.maxHp).toBe((marines(first)[0]?.maxHp ?? 0) + 1);
  // Mission 2 lost: the retry keeps the armour.
  await wipeOut(page, 'marine');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Briefing');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  expect((await snapshot(page)).campaign).toMatchObject({
    mission: 1,
    attempt: 1,
    supply: 'armour',
  });
  // Won: the next mission's drop is a new pick. 1 is grenades.
  await wipeOut(page, 'alien');
  await page.keyboard.press('Enter');
  await pickSupply(page, '1');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Battle');
  const third = await snapshot(page);
  expect(third.campaign).toMatchObject({ mission: 2, supply: 'grenades' });
  for (const m of marines(third)) {
    expect(m.maxHp).toBe(marines(first)[0]?.maxHp);
    expect(m.grenades).toBe((marines(first)[0]?.grenades ?? 0) + 1);
  }
});

test('a damaged save is cleared with a message, never loaded', async ({ page }) => {
  await page.goto('./');
  await waitForScene(page, 'Title');
  for (const junk of ['{not json', JSON.stringify({ v: 1, campaign: { admin: true } })]) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      [SAVE_KEY, junk],
    );
    await page.reload();
    await waitForScene(page, 'Title');
    // The title shows a new campaign (no CONTINUE), and the bad save is gone.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), SAVE_KEY)).toBeNull();
  }
});

test('a save that passes the shape checks but not the map is cleared on continue', async ({
  page,
}) => {
  await openGame(page);
  // Move a living marine into a blocked tile in the saved copy.
  const s = await snapshot(page);
  const blocked = [...s.layout].findIndex((c) => c !== '.');
  await page.evaluate(
    ([k, i, cols]) => {
      const save = JSON.parse(window.localStorage.getItem(k as string) ?? '{}');
      const m = save.battle.units.find((u: { id: string }) => u.id.startsWith('m'));
      m.x = (i as number) % (cols as number);
      m.y = Math.floor((i as number) / (cols as number));
      window.localStorage.setItem(k as string, JSON.stringify(save));
    },
    [SAVE_KEY, blocked, MAP_COLS],
  );
  await page.reload();
  await waitForScene(page, 'Title');
  await page.keyboard.press('Enter'); // CONTINUE
  await waitForScene(page, 'Title'); // back on the title, with the message
  await expect
    .poll(() => page.evaluate((k) => window.localStorage.getItem(k), SAVE_KEY))
    .toBeNull();
  expect(await activeScenes(page)).toEqual(['Title']);
});

test('a skirmish (?seed=) never touches the campaign save', async ({ page }) => {
  await openGame(page, '?seed=42');
  await wipeOut(page, 'alien');
  expect(await page.evaluate((k) => window.localStorage.getItem(k), SAVE_KEY)).toBeNull();
});

test('a desktop window never shows the turn-sideways notice, even when tall', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('./');
  await waitForScene(page, 'Title');
  await expect(page.locator('#rotate')).toBeHidden();
});
