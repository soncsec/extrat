import { describe, expect, it } from 'vitest';
import { GRENADE, MAP_COLS, MAP_ROWS, RANKS, UNITS, XP } from '../../src/config/tuning';
import {
  apply,
  clipSize,
  createBattle,
  shotOdds,
  unitById,
  type BattleState,
  type Unit,
} from '../../src/logic/battle';
import { awardXp, battleXp, newCampaign, rankForXp, squadRanks } from '../../src/logic/campaign';
import { generateForest, type BattleMap } from '../../src/logic/map';

/** An open map with no props. */
function openMap(cols = 16, rows = 7): BattleMap {
  return {
    cols,
    rows,
    seed: 0,
    tiles: Array.from({ length: cols * rows }, () => ({ prop: null, anchor: false })),
    decals: [],
  } as BattleMap;
}

/** Marine 'm' and an awake alien 'a' on an open map, on the marines' turn. */
function duel(marine: Partial<Unit>, alien: Partial<Unit>): BattleState {
  const base = createBattle(generateForest(1, MAP_COLS, MAP_ROWS), 1);
  const m = base.units.find((u) => u.side === 'marine') as Unit;
  const a = base.units.find((u) => u.side === 'alien') as Unit;
  return {
    ...base,
    map: openMap(),
    turn: 'marine',
    units: [
      { ...m, id: 'm', x: 2, y: 3, ...marine },
      { ...a, id: 'a', x: 6, y: 3, dormant: false, ...alien },
    ],
  };
}

/** The first random state for which the marine's shot gives `want`. */
function shootUntil(s: BattleState, want: (next: BattleState) => boolean): BattleState {
  for (let rng = 1; rng < 500; rng++) {
    const next = apply({ ...s, rng }, { type: 'shoot', unitId: 'm', targetId: 'a' });
    if (want(next)) return next;
  }
  throw new Error('no random state gives that result');
}

describe('ranks', () => {
  it('go up with XP, and start at Rookie', () => {
    expect(rankForXp(0)).toBe(0);
    RANKS.forEach((r, i) => {
      expect(rankForXp(r.xp)).toBe(i);
      if (r.xp > 0) expect(rankForXp(r.xp - 1)).toBe(i - 1);
    });
    expect(rankForXp(XP.max)).toBe(RANKS.length - 1);
  });

  it('only ever add aim, health, grenades and ammo', () => {
    for (let i = 1; i < RANKS.length; i++) {
      const [lower, higher] = [RANKS[i - 1], RANKS[i]] as [
        (typeof RANKS)[number],
        (typeof RANKS)[number],
      ];
      expect(higher.xp).toBeGreaterThan(lower.xp);
      expect(higher.aim).toBeGreaterThanOrEqual(lower.aim);
      expect(higher.hp).toBeGreaterThanOrEqual(lower.hp);
      expect(higher.grenades).toBeGreaterThanOrEqual(lower.grenades);
      expect(higher.ammo).toBeGreaterThanOrEqual(lower.ammo);
    }
    // Every promotion is felt: each rank adds something over the one before.
    for (let i = 1; i < RANKS.length; i++) {
      const [lower, higher] = [RANKS[i - 1], RANKS[i]] as [
        (typeof RANKS)[number],
        (typeof RANKS)[number],
      ];
      const sum = (r: (typeof RANKS)[number]): number => r.aim + r.hp + r.grenades + r.ammo;
      expect(sum(higher)).toBeGreaterThan(sum(lower));
    }
  });

  it('give marines their rank`s grenades and clip; a reload fills the bigger clip', () => {
    const map = generateForest(3, MAP_COLS, MAP_ROWS);
    const b = createBattle(map, map.seed, { ranks: [0, 2, 3, 4] });
    const marines = b.units.filter((u) => u.side === 'marine');
    expect(marines.map((u) => u.grenades)).toEqual(
      [0, 2, 3, 4].map((r) => GRENADE.perMarine + (RANKS[r] as (typeof RANKS)[number]).grenades),
    );
    expect(marines.map((u) => u.ammo)).toEqual(
      [0, 2, 3, 4].map((r) => UNITS.marine.ammo + (RANKS[r] as (typeof RANKS)[number]).ammo),
    );
    const lt = marines[3] as Unit;
    expect(clipSize(lt)).toBe(UNITS.marine.ammo + (RANKS[4] as (typeof RANKS)[number]).ammo);
    const empty = {
      ...b,
      turn: 'marine' as const,
      units: b.units.map((u) => (u.id === lt.id ? { ...u, ammo: 0 } : u)),
    };
    expect(unitById(apply(empty, { type: 'reload', unitId: lt.id }), lt.id)?.ammo).toBe(
      clipSize(lt),
    );
    expect(b.units.filter((u) => u.side === 'alien').every((u) => clipSize(u) === null)).toBe(true);
  });

  it('give marines their rank`s health in battle; aliens stay rank 0', () => {
    const map = generateForest(3, MAP_COLS, MAP_ROWS);
    const b = createBattle(map, map.seed, { ranks: [0, 2, 4, 9] });
    const marines = b.units.filter((u) => u.side === 'marine');
    expect(marines.map((u) => u.rank)).toEqual([0, 2, 4, 4]);
    for (const m of marines) {
      const extra = (RANKS[m.rank] as (typeof RANKS)[number]).hp;
      expect(m).toMatchObject({ hp: UNITS.marine.hp + extra, maxHp: UNITS.marine.hp + extra });
    }
    expect(b.units.filter((u) => u.side === 'alien').every((u) => u.rank === 0)).toBe(true);
  });

  it('add their aim bonus to the hit chance', () => {
    const rookie = shotOdds(duel({ rank: 0 }, {}), 'm', 'a');
    const top = RANKS.length - 1;
    const veteran = shotOdds(duel({ rank: top }, {}), 'm', 'a');
    expect(veteran?.aim).toBe((rookie?.aim ?? 0) + (RANKS[top]?.aim ?? 0));
    expect((veteran?.hit ?? 0) - (rookie?.hit ?? 0)).toBe(RANKS[top]?.aim);
  });
});

describe('hits', () => {
  it('count every shot that lands on an enemy, kills included; misses count nothing', () => {
    const tough = duel({}, { hp: 9 });
    expect(
      unitById(
        shootUntil(tough, (n) => n.lastShot?.hit === true),
        'm',
      ),
    ).toMatchObject({
      hits: 1,
      kills: 0,
    });
    expect(
      unitById(
        shootUntil(tough, (n) => n.lastShot?.hit === false),
        'm',
      )?.hits,
    ).toBe(0);
    const weak = duel({}, { hp: 1 });
    expect(
      unitById(
        shootUntil(weak, (n) => n.lastShot?.killed === true),
        'm',
      ),
    ).toMatchObject({
      hits: 1,
      kills: 1,
    });
  });

  it('count a grenade once per enemy it hits, not for squad mates', () => {
    const s = duel({ x: 2, y: 3 }, { x: 6, y: 3, hp: 9 });
    const mate = { ...(s.units[0] as Unit), id: 'm2', x: 6, y: 4 };
    const next = apply(
      { ...s, units: [...s.units, mate] },
      { type: 'throw', unitId: 'm', at: { x: 6, y: 3 } },
    );
    expect(next.lastThrow?.hits).toHaveLength(2);
    expect(unitById(next, 'm')).toMatchObject({ hits: 1, kills: 0 });
  });
});

describe('kills', () => {
  it('count a killing shot for the shooter, but not a wound or a miss', () => {
    const s = duel({}, { hp: 1 });
    expect(
      unitById(
        shootUntil(s, (n) => n.lastShot?.killed === true),
        'm',
      )?.kills,
    ).toBe(1);
    expect(
      unitById(
        shootUntil(s, (n) => n.lastShot?.hit === false),
        'm',
      )?.kills,
    ).toBe(0);
    const tough = duel({}, { hp: 9 });
    const wounded = shootUntil(tough, (n) => n.lastShot?.hit === true);
    expect(unitById(wounded, 'm')?.kills).toBe(0);
  });

  it('count enemies a grenade kills for the thrower, not squad mates', () => {
    const s = duel({ x: 2, y: 3 }, { x: 6, y: 3, hp: GRENADE.damage });
    const mate = { ...(s.units[0] as Unit), id: 'm2', x: 6, y: 4, hp: GRENADE.damage };
    const next = apply(
      { ...s, units: [...s.units, mate] },
      {
        type: 'throw',
        unitId: 'm',
        at: { x: 6, y: 3 },
      },
    );
    expect(next.lastThrow?.hits.filter((h) => h.killed)).toHaveLength(2);
    expect(unitById(next, 'm')?.kills).toBe(1);
  });
});

describe('XP', () => {
  const c = newCampaign(4);

  it('is earned per hit and per kill, plus the mission bonus for everyone on a win', () => {
    const map = generateForest(c.mapSeed, MAP_COLS, MAP_ROWS);
    const b = createBattle(map, map.seed, { names: c.squad });
    const withKills = {
      ...b,
      units: b.units.map((u) =>
        u.id === 'm2' ? { ...u, kills: 3, hits: 5 } : u.id === 'm3' ? { ...u, hits: 2 } : u,
      ),
    };
    expect(battleXp(withKills, true)).toEqual([
      XP.missionWon,
      XP.missionWon + 3 * XP.kill + 5 * XP.hit,
      XP.missionWon + 2 * XP.hit,
      XP.missionWon,
    ]);
    expect(battleXp(withKills, false)).toEqual([0, 3 * XP.kill + 5 * XP.hit, 2 * XP.hit, 0]);
  });

  it('adds up, promotes, and is capped', () => {
    const first = awardXp(c, [20, 10, 0, 50]);
    expect(first.campaign.xp).toEqual([20, 10, 0, 50]);
    expect(squadRanks(first.campaign)).toEqual([1, 0, 0, 2]);
    expect(first.promotions).toEqual([
      { name: c.squad[0], rank: 1 },
      { name: c.squad[3], rank: 2 },
    ]);
    const second = awardXp(first.campaign, [0, 10, 0, 0]);
    expect(second.promotions).toEqual([{ name: c.squad[1], rank: 1 }]);
    expect(awardXp(c, [XP.max * 2, -5, 0, 0]).campaign.xp).toEqual([XP.max, 0, 0, 0]);
    // The campaign it was given is left as it was.
    expect(c.xp).toEqual([0, 0, 0, 0]);
  });
});
