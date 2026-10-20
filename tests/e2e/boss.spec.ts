import { expect, test, type Page } from '@playwright/test';
import { BOSS_PRACTICE, GAME_WIDTH, GRENADE, RANKS, TILE } from '../../src/config/tuning';
import type { GameSnapshot } from '../../src/scenes/BattleScene';

/*
 * The final mission's boss on screen (M5.6, second step). The rules have unit tests;
 * these check the scene draws and animates them without errors. A ?boss=1 skirmish on
 * a fixed seed puts the boss and two escort groups on the alien ship.
 */

// VETERAN: the boss at full strength. The plain link is RECRUIT (checked below).
const BOSS_SKIRMISH = '?seed=7&landscape=ship&boss=1&difficulty=veteran';

async function snapshot(page: Page): Promise<GameSnapshot> {
  const snap = await page.evaluate(() => window.__game?.snapshot() ?? null);
  if (!snap) throw new Error('no battle running');
  return snap;
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`./${BOSS_SKIRMISH}`);
  await expect.poll(() => page.evaluate(() => window.__game?.scene() ?? null)).toBe('Title');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__game?.scene() ?? null)).toBe('Battle');
  return errors;
}

const bossOf = (s: GameSnapshot): GameSnapshot['units'][number] => {
  const boss = s.units.find((u) => u.kind === 'overseer');
  if (!boss) throw new Error('no boss');
  return boss;
};

async function clickTile(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('#game canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const zoom = box.width / GAME_WIDTH;
  await page.mouse.click(
    box.x + (x * TILE + TILE / 2) * zoom,
    box.y + (y * TILE + TILE / 2) * zoom,
  );
}

/** Walks the squad toward the boss, turn by turn, until the squad sees it. */
async function approachBoss(page: Page): Promise<void> {
  for (let turn = 0; turn < 6; turn++) {
    for (const key of ['1', '2', '3', '4']) {
      if (bossOf(await snapshot(page)).seen) return;
      await page.keyboard.press(key);
      const s = await snapshot(page);
      if (!s.selected) continue;
      const boss = bossOf(s);
      const dist = (t: { x: number; y: number }): number => Math.hypot(t.x - boss.x, t.y - boss.y);
      const best = s.reachable.filter((t) => t.cost <= 1).sort((a, b) => dist(a) - dist(b))[0];
      if (!best) continue;
      await clickTile(page, best.x, best.y);
      await expect.poll(async () => (await snapshot(page)).busy, { timeout: 20_000 }).toBe(false);
    }
    if (bossOf(await snapshot(page)).seen) return;
    await page.keyboard.press('e');
    await expect
      .poll(
        async () => {
          const s = await snapshot(page);
          return !s.busy && s.turn === 'marine';
        },
        { timeout: 40_000 },
      )
      .toBe(true);
  }
  throw new Error('the squad never saw the boss');
}

test('?boss=1 puts the boss on the ship, dormant, its front to the west', async ({ page }) => {
  const errors = await open(page);
  const s = await snapshot(page);
  const boss = bossOf(s);
  expect(boss).toMatchObject({ dormant: true, front: -1, charging: null, hp: 12, maxHp: 12 });
  // A practice squad like one that fought its way here: Sergeants, with a grenades supply.
  const marines = s.units.filter((u) => u.side === 'marine');
  expect(marines.every((u) => u.rank === BOSS_PRACTICE.rank)).toBe(true);
  expect(
    marines.every(
      (u) => u.grenades === GRENADE.perMarine + (RANKS[BOSS_PRACTICE.rank]?.grenades ?? 0) + 1,
    ),
  ).toBe(true);
  expect(s.units.filter((u) => u.side === 'alien')).toHaveLength(5);
  // Nobody else stands on any of its four tiles.
  const tiles = [0, 1].flatMap((i) => [0, 1].map((j) => ({ x: boss.x + i, y: boss.y - j })));
  for (const u of s.units.filter((v) => v.id !== boss.id)) {
    expect(
      tiles.some((t) => t.x === u.x && t.y === u.y),
      u.id,
    ).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('the boss charges at half health, the squad sees the warning, then it blasts', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = await open(page);
  await approachBoss(page);
  const seen = bossOf(await snapshot(page));
  expect(seen.dormant).toBe(false);
  // Hurt it to half health; on its turn it charges instead of moving.
  await page.keyboard.press('Escape');
  await page.evaluate((id) => window.__game?.setHp(id, 6), seen.id);
  await page.keyboard.press('e');
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return !s.busy && s.turn === 'marine' ? bossOf(s).charging : null;
      },
      { timeout: 60_000 },
    )
    .not.toBeNull();
  const charging = bossOf(await snapshot(page)).charging;
  expect(charging).not.toBeNull();
  // The squad stays put; on its next turn the blast goes off and the charge is spent.
  await page.keyboard.press('e');
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return !s.busy && bossOf(s).charging === null;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test('the plain practice link is RECRUIT: a weaker Overseer (M6.3)', async ({ page }) => {
  await page.goto('./?seed=7&landscape=ship&boss=1');
  await expect
    .poll(() => page.evaluate(() => window.__game?.scene() ?? null), { timeout: 15_000 })
    .toBe('Title');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.__game?.snapshot()?.units.length ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const s = await page.evaluate(() => window.__game?.snapshot());
  const boss = s?.units.find((u) => u.kind === 'overseer');
  expect(boss?.maxHp).toBe(8);
  // One escort group of 2, as in the RECRUIT campaign (owner, 2026-10-20).
  expect(s?.units.filter((u) => u.side === 'alien' && u.kind !== 'overseer')).toHaveLength(2);
});

test('the boss battle starts on any map, wherever the Overseer stands', async ({ page }) => {
  test.setTimeout(90_000);
  // Its idle animation is a single frame: drawing it once crashed on two maps in three.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    await page.goto(`./?seed=${seed}&landscape=ship&boss=1`);
    await expect
      .poll(() => page.evaluate(() => window.__game?.scene() ?? null), { timeout: 15_000 })
      .toBe('Title');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => window.__game?.snapshot()?.units.length ?? 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});
