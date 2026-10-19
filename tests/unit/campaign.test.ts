import { describe, expect, it } from 'vitest';
import { ALIEN_KINDS, BOSS, MAP_COLS, MAP_ROWS, MISSIONS, SKIRMISH } from '../../src/config/tuning';
import { createBattle, MARINE_NAMES } from '../../src/logic/battle';
import {
  afterBattle,
  currentMission,
  isComplete,
  mapSeedFor,
  newCampaign,
  type Campaign,
} from '../../src/logic/campaign';
import { generateForest, generateMap } from '../../src/logic/map';

describe('newCampaign', () => {
  it('starts at mission 1 with a squad of distinct names', () => {
    const c = newCampaign(5);
    expect(c).toMatchObject({ seed: 5, mission: 0, attempt: 0 });
    expect(c.squad).toHaveLength(SKIRMISH.marines);
    expect(new Set(c.squad).size).toBe(SKIRMISH.marines);
    for (const n of c.squad) expect(MARINE_NAMES).toContain(n);
  });

  it('is the same for the same seed, and differs between seeds', () => {
    expect(newCampaign(9)).toEqual(newCampaign(9));
    const seeds = new Set(Array.from({ length: 20 }, (_, i) => newCampaign(i).mapSeed));
    expect(seeds.size).toBeGreaterThan(15);
  });
});

describe('afterBattle', () => {
  const start = newCampaign(42);

  it('moves on to the next mission on a new map after a win', () => {
    const next = afterBattle(start, true, 'next');
    expect(next).toMatchObject({ mission: 1, attempt: 0, squad: start.squad });
    expect(next.mapSeed).toBe(mapSeedFor(42, 1, 0));
    expect(next.mapSeed).not.toBe(start.mapSeed);
  });

  it('retries the same mission on a new map after a loss (M5.4)', () => {
    const retry = afterBattle(start, false, 'retry');
    expect(retry).toMatchObject({ mission: 0, attempt: 1 });
    expect(retry.mapSeed).not.toBe(start.mapSeed);
    expect(afterBattle(retry, false, 'retry').attempt).toBe(2);
  });

  it('replays the same map without moving the campaign on, win or lose', () => {
    expect(afterBattle(start, true, 'replay')).toEqual(start);
    expect(afterBattle(start, false, 'replay')).toEqual(start);
  });

  it('ignores a choice that does not fit the result', () => {
    expect(afterBattle(start, false, 'next')).toBe(start);
    expect(afterBattle(start, true, 'retry')).toBe(start);
  });

  it('is complete after winning the last mission, and stays complete', () => {
    let c: Campaign = start;
    for (let i = 0; i < MISSIONS.length; i++) {
      expect(isComplete(c)).toBe(false);
      c = afterBattle(c, true, 'next');
    }
    expect(isComplete(c)).toBe(true);
    expect(currentMission(c)).toBe(MISSIONS[MISSIONS.length - 1]);
    expect(afterBattle(c, true, 'next')).toBe(c);
  });
});

describe('missions', () => {
  it('ramp up gently: never fewer aliens than the mission before, up to the boss', () => {
    // The final mission is the boss and its escorts instead (M5.6, approved design):
    // fewer aliens, but the Overseer itself. Tested below.
    const ramp = MISSIONS.filter((m) => !('boss' in m && m.boss));
    expect(ramp).toHaveLength(MISSIONS.length - 1);
    const sizes = ramp.map((m) => m.pods.count * m.pods.size);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1] as number);
    }
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0] as number);
  });

  it('end with the boss and its escorts on the alien ship (M5.6)', () => {
    const last = MISSIONS[MISSIONS.length - 1] as (typeof MISSIONS)[number];
    expect(last).toMatchObject({ landscape: 'ship', boss: true, pods: BOSS.escorts });
    expect(MISSIONS.filter((m) => 'boss' in m && m.boss)).toHaveLength(1);
  });

  // 1,200 battles: about 1.5 s on a desktop but over 5 s on CI runners, so this test
  // gets a longer time limit than Vitest's default 5 s.
  it('fit every mission`s alien groups on 200 maps', () => {
    for (const m of MISSIONS) {
      for (let seed = 1; seed <= 200; seed++) {
        const map = generateMap(seed, MAP_COLS, MAP_ROWS, m.landscape);
        expect(map.landscape ?? 'forest').toBe(m.landscape);
        const boss = 'boss' in m && m.boss;
        const b = createBattle(map, map.seed, { pods: m.pods, boss });
        const aliens = b.units.filter((u) => u.side === 'alien');
        // The boss (M5.6) stands in a group of its own, beside its escorts.
        expect(aliens, `seed ${seed}`).toHaveLength(m.pods.count * m.pods.size + (boss ? 1 : 0));
        expect(
          aliens.filter((a) => a.kind === 'overseer'),
          `seed ${seed}`,
        ).toHaveLength(boss ? 1 : 0);
        for (let pod = 0; pod < m.pods.count; pod++) {
          expect(
            aliens.filter((a) => a.pod === pod),
            `seed ${seed} pod ${pod}`,
          ).toHaveLength(m.pods.size);
        }
      }
    }
  }, 30_000);

  it('introduce one alien kind per mission, walkers first, snakes from mission 4', () => {
    expect(MISSIONS[0]?.kinds).toEqual(['walker']);
    for (let i = 1; i < MISSIONS.length; i++) {
      const before = MISSIONS[i - 1]?.kinds ?? [];
      const now = MISSIONS[i]?.kinds ?? [];
      // Never fewer kinds, nothing dropped, and at most one new kind, listed last.
      expect(now.slice(0, before.length)).toEqual(before);
      expect(now.length - before.length).toBeLessThanOrEqual(1);
    }
    const firstSnake = MISSIONS.findIndex((m) => (m.kinds as readonly string[]).includes('snake'));
    expect(firstSnake).toBeGreaterThanOrEqual(3);
    expect([...(MISSIONS[MISSIONS.length - 1]?.kinds ?? [])].sort()).toEqual(
      [...ALIEN_KINDS].sort(),
    );
  });

  it('field only the mission`s kinds, always including the new one, on 100 maps', () => {
    for (const [i, m] of MISSIONS.entries()) {
      const newest = m.kinds[m.kinds.length - 1];
      for (let seed = 1; seed <= 100; seed++) {
        const map = generateMap(seed, MAP_COLS, MAP_ROWS, m.landscape);
        const b = createBattle(map, map.seed, { pods: m.pods, kinds: m.kinds });
        const kinds = b.units.filter((u) => u.side === 'alien').map((u) => u.kind);
        for (const k of kinds) expect(m.kinds, `mission ${i + 1} seed ${seed}`).toContain(k);
        expect(kinds, `mission ${i + 1} seed ${seed}`).toContain(newest);
      }
    }
  }, 30_000);

  it('include the town as mission 2, and end on the alien ship', () => {
    expect(MISSIONS[1]?.landscape).toBe('town');
    expect(MISSIONS[MISSIONS.length - 1]?.landscape).toBe('ship');
  });

  it('use the campaign squad`s names in a battle', () => {
    const c = newCampaign(3);
    const map = generateForest(c.mapSeed, MAP_COLS, MAP_ROWS);
    const b = createBattle(map, map.seed, { names: c.squad });
    expect(b.units.filter((u) => u.side === 'marine').map((u) => u.name)).toEqual(c.squad);
  });
});
