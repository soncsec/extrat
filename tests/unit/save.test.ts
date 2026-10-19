import { describe, expect, it } from 'vitest';
import { MAP_COLS, MAP_ROWS, MISSIONS, XP } from '../../src/config/tuning';
import { apply, createBattle, type BattleState } from '../../src/logic/battle';
import { afterBattle, currentMission, newCampaign, type Campaign } from '../../src/logic/campaign';
import { generateForest, generateMap, isWalkable, type BattleMap } from '../../src/logic/map';
import {
  decodeSave,
  encodeSave,
  MAX_SAVE_LENGTH,
  restoreBattle,
  SAVE_VERSION,
  type Save,
} from '../../src/logic/save';

/** The map a campaign's current mission is fought on. */
const buildMap = (c: Campaign): BattleMap =>
  generateMap(c.mapSeed, MAP_COLS, MAP_ROWS, currentMission(c).landscape);

/** Mission `n` of campaign 11, and its battle as it starts. */
function setup(n = 0): { campaign: Campaign; battle: BattleState } {
  let campaign = newCampaign(11);
  for (let i = 0; i < n; i++) campaign = afterBattle(campaign, true, 'next');
  const map = buildMap(campaign);
  const battle = createBattle(map, map.seed, {
    names: campaign.squad,
    pods: currentMission(campaign).pods,
    kinds: currentMission(campaign).kinds,
  });
  return { campaign, battle };
}

/** The save as plain data, for tampering with. */
function raw(campaign: Campaign, battle: BattleState | null): Save {
  return JSON.parse(encodeSave(campaign, battle)) as Save;
}

const decodes = (data: unknown): boolean => decodeSave(JSON.stringify(data)).ok;

/** A unit as saved before version 5: without the boss's fields (M5.6). */
const preBoss = <T extends object>(u: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(u).filter(([k]) => !['front', 'charging', 'cooldown'].includes(k)),
  ) as Partial<T>;

/** A copy of `o` without `key`. */
function without<T extends object>(o: T, key: keyof T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as Partial<T>;
}

describe('save round trip', () => {
  it('restores a campaign between missions', () => {
    const { campaign } = setup(2);
    const loaded = decodeSave(encodeSave(campaign, null));
    expect(loaded).toEqual({ ok: true, save: { v: SAVE_VERSION, campaign, battle: null } });
  });

  it('restores a battle mid-mission exactly, from the units and the random state', () => {
    const { campaign, battle } = setup(0);
    // Play a little: a marine moves, the turn passes to the aliens and back.
    const m = battle.units.find((u) => u.side === 'marine');
    if (!m) throw new Error('no marine');
    let s = apply(battle, { type: 'move', unitId: m.id, to: { x: m.x, y: m.y + 1 } });
    s = apply(apply(s, { type: 'endTurn' }), { type: 'endTurn' });
    const loaded = decodeSave(encodeSave(campaign, s));
    if (!loaded.ok || !loaded.save.battle) throw new Error('did not load');
    const back = restoreBattle(loaded.save.campaign, loaded.save.battle);
    expect(back).toEqual({ ...s, selected: null, lastMove: null, lastShot: null, lastThrow: null });
  });

  it('works for every mission`s alien groups', () => {
    for (let n = 0; n < MISSIONS.length; n++) {
      const { campaign, battle } = setup(n);
      const loaded = decodeSave(encodeSave(campaign, battle));
      if (!loaded.ok || !loaded.save.battle) throw new Error(`mission ${n} did not load`);
      expect(restoreBattle(campaign, loaded.save.battle), `mission ${n}`).not.toBeNull();
    }
  });
});

describe('save loading rejects anything unexpected', () => {
  const { campaign, battle } = setup(0);
  const good = raw(campaign, battle);

  it('rejects text that is not a save', () => {
    for (const text of ['', 'null', '[]', '42', '"save"', '{', 'undefined', '<script>']) {
      expect(decodeSave(text).ok, text).toBe(false);
    }
    expect(decodeSave('x'.repeat(MAX_SAVE_LENGTH + 1))).toEqual({ ok: false, reason: 'too large' });
  });

  it('rejects another version, extra fields and missing fields', () => {
    expect(decodes({ ...good, v: SAVE_VERSION + 1 })).toBe(false);
    expect(decodes({ ...good, v: 0 })).toBe(false);
    expect(decodes({ ...good, v: String(SAVE_VERSION) })).toBe(false);
    expect(decodes({ ...good, extra: 1 })).toBe(false);
    expect(decodes({ v: 1, campaign: good.campaign })).toBe(false);
    expect(decodes({ ...good, campaign: { ...good.campaign, admin: true } })).toBe(false);
  });

  it('rejects a __proto__ key instead of letting it through', () => {
    const text = encodeSave(campaign, null).replace(
      `"v":${SAVE_VERSION}`,
      `"v":${SAVE_VERSION},"__proto__":{"polluted":1}`,
    );
    expect(text).toContain('__proto__');
    expect(decodeSave(text).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects campaign numbers out of range or that do not fit together', () => {
    const c = good.campaign;
    expect(decodes({ ...good, campaign: { ...c, mission: MISSIONS.length } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, mission: -1 } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, mission: 0.5 } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, seed: '11' } })).toBe(false);
    // A map seed the campaign wouldn't give (e.g. picked to get an easy map).
    expect(decodes({ ...good, campaign: { ...c, mapSeed: c.mapSeed + 1 } })).toBe(false);
  });

  it('rejects a squad that is not four different known marines', () => {
    const c = good.campaign;
    const first = c.squad[0] as string;
    expect(decodes({ ...good, campaign: { ...c, squad: [...c.squad.slice(0, 3), 'Rambo'] } })).toBe(
      false,
    );
    expect(decodes({ ...good, campaign: { ...c, squad: [first, first, first, first] } })).toBe(
      false,
    );
    expect(decodes({ ...good, campaign: { ...c, squad: c.squad.slice(0, 3) } })).toBe(false);
    expect(
      decodes({ ...good, campaign: { ...c, squad: [`<img src=x>`, ...c.squad.slice(1)] } }),
    ).toBe(false);
  });

  it('rejects unit fields of the wrong type or range', () => {
    const b = good.battle;
    if (!b) throw new Error('no battle');
    const unit = b.units[0];
    if (!unit) throw new Error('no unit');
    const withUnit = (u: object): unknown => ({
      ...good,
      battle: { ...b, units: [u, ...b.units.slice(1)] },
    });
    expect(decodes(withUnit({ ...unit, hp: -1 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, ap: 3 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, facing: 0 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, overwatch: 'yes' }))).toBe(false);
    expect(decodes(withUnit({ ...unit, id: 'x1' }))).toBe(false);
    expect(decodes(withUnit({ ...unit, poison: 9 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, cheat: true }))).toBe(false);
    expect(decodes({ ...good, battle: { ...b, round: 0 } })).toBe(false);
    expect(decodes({ ...good, battle: { ...b, units: [] } })).toBe(false);
  });
});

describe('restoreBattle checks the units against the map', () => {
  const { campaign, battle } = setup(0);
  const good = raw(campaign, battle);
  const b = good.battle;
  if (!b) throw new Error('no battle');
  const map = buildMap(campaign);
  const restore = (units: typeof b.units): BattleState | null =>
    restoreBattle(campaign, { ...b, units });
  const marine = b.units.find((u) => u.id.startsWith('m'));
  if (!marine) throw new Error('no marine');
  const swap = (u: typeof marine): typeof b.units => b.units.map((v) => (v.id === u.id ? u : v));

  it('accepts the battle as saved', () => {
    expect(restore(b.units)).not.toBeNull();
  });

  it('rejects a unit inside a tree, off the map, or on top of another', () => {
    let blocked = { x: 0, y: 0 };
    for (let i = 0; i < map.tiles.length; i++) {
      if (!isWalkable(map, i % map.cols, Math.floor(i / map.cols))) {
        blocked = { x: i % map.cols, y: Math.floor(i / map.cols) };
        break;
      }
    }
    expect(restore(swap({ ...marine, ...blocked }))).toBeNull();
    expect(restore(swap({ ...marine, x: map.cols }))).toBeNull();
    const other = b.units.find((u) => u.id !== marine.id) as (typeof b.units)[number];
    expect(restore(swap({ ...marine, x: other.x, y: other.y }))).toBeNull();
  });

  it('rejects more health, grenades or ammo than the unit can have', () => {
    expect(restore(swap({ ...marine, hp: 99 }))).toBeNull();
    expect(restore(swap({ ...marine, grenades: 5 }))).toBeNull();
    expect(restore(swap({ ...marine, ammo: 50 }))).toBeNull();
    expect(restore(swap({ ...marine, ammo: null }))).toBeNull();
  });

  it('rejects missing, unknown or doubled units, and dormant marines', () => {
    expect(restore(b.units.slice(1))).toBeNull();
    expect(restore([...b.units.slice(1), { ...marine, id: 'm9' }])).toBeNull();
    expect(restore([...b.units.slice(1), { ...(b.units[1] as typeof marine) }])).toBeNull();
    expect(restore(swap({ ...marine, dormant: true }))).toBeNull();
  });

  it('rejects a battle that is already over', () => {
    const allDead = b.units.map((u) => (u.id.startsWith('a') ? { ...u, hp: 0 } : u));
    expect(restore(allDead)).toBeNull();
  });
});

describe('restoreBattle uses the mission`s own landscape', () => {
  it('checks a town mission against the town map, not a forest one', () => {
    const townMission = MISSIONS.findIndex((m) => m.landscape === 'town');
    expect(townMission).toBeGreaterThanOrEqual(0);
    const { campaign, battle } = setup(townMission);
    const b = raw(campaign, battle).battle;
    if (!b) throw new Error('no battle');
    const town = buildMap(campaign);
    const forest = generateForest(campaign.mapSeed, MAP_COLS, MAP_ROWS);
    expect(town.landscape).toBe('town');
    // A free tile in the forest of the same seed that a town building blocks.
    let spot: { x: number; y: number } | null = null;
    for (let i = 0; i < town.tiles.length && !spot; i++) {
      const x = i % town.cols;
      const y = Math.floor(i / town.cols);
      if (isWalkable(forest, x, y) && !isWalkable(town, x, y)) spot = { x, y };
    }
    if (!spot) throw new Error('no tile that differs');
    const marine = b.units.find((u) => u.id.startsWith('m'));
    if (!marine) throw new Error('no marine');
    const units = b.units.map((u) => (u.id === marine.id ? { ...u, ...spot } : u));
    expect(restoreBattle(campaign, { ...b, units })).toBeNull();
    expect(restoreBattle(campaign, b)?.map).toEqual(town);
  });
});

describe('save version 2: XP, kills and replays (M5.2)', () => {
  const { campaign, battle } = setup(1);
  const ranked = { ...campaign, xp: [0, 25, 60, 150] };
  const good = raw(ranked, battle);
  const b = good.battle;
  if (!b) throw new Error('no battle');

  it('keeps the squad`s XP and the replay flag', () => {
    const loaded = decodeSave(encodeSave(ranked, battle, true));
    if (!loaded.ok || !loaded.save.battle) throw new Error('did not load');
    expect(loaded.save.campaign.xp).toEqual([0, 25, 60, 150]);
    expect(loaded.save.battle.replay).toBe(true);
    expect(decodeSave(encodeSave(ranked, battle)).ok && good.battle?.replay).toBe(false);
  });

  it('rebuilds the marines with their ranks`s health', () => {
    const back = restoreBattle(ranked, b);
    const marines = back?.units.filter((u) => u.side === 'marine') ?? [];
    expect(marines.map((u) => u.rank)).toEqual([0, 1, 2, 4]);
    expect(marines.map((u) => u.maxHp)).toEqual([4, 4, 5, 6]);
  });

  it('rejects XP that is missing, of the wrong size, type or range', () => {
    const c = good.campaign;
    const noXp = without(c, 'xp');
    expect(decodes({ ...good, campaign: noXp })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, xp: [0, 0, 0] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, xp: [0, 0, 0, -1] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, xp: [0, 0, 0, 1.5] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, xp: [0, 0, 0, '9'] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, xp: [0, 0, 0, XP.max + 1] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, xp: [0, 0, 0, XP.max] } })).toBe(true);
  });

  it('rejects a missing or wrong replay flag, and bad kill counts', () => {
    const noReplay = without(b, 'replay');
    expect(decodes({ ...good, battle: noReplay })).toBe(false);
    expect(decodes({ ...good, battle: { ...b, replay: 'no' } })).toBe(false);
    const unit = b.units[0] as (typeof b.units)[number];
    const withUnit = (u: object): unknown => ({
      ...good,
      battle: { ...b, units: [u, ...b.units.slice(1)] },
    });
    expect(decodes(withUnit({ ...unit, kills: -1 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, kills: 2.5 }))).toBe(false);
    const noKills = without(unit, 'kills');
    expect(decodes(withUnit(noKills))).toBe(false);
  });

  it('rejects bad hit counts: missing, negative, fewer than kills (M5.9)', () => {
    const unit = b.units[0] as (typeof b.units)[number];
    const withUnit = (u: object): unknown => ({
      ...good,
      battle: { ...b, units: [u, ...b.units.slice(1)] },
    });
    expect(decodes(withUnit(without(unit, 'hits')))).toBe(false);
    expect(decodes(withUnit({ ...unit, hits: -1 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, hits: 1.5 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, hits: 1000 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, kills: 1, hits: 0 }))).toBe(false);
    expect(decodes(withUnit({ ...unit, kills: 1, hits: 1 }))).toBe(true);
  });

  it('rejects more hits than health the other side has lost', () => {
    const marine = b.units.find((u) => u.id === 'm1') as (typeof b.units)[number];
    const alien = b.units.find((u) => u.id.startsWith('a')) as (typeof b.units)[number];
    const units = (hits: number, alienHp: number): typeof b.units =>
      b.units.map((u) =>
        u.id === marine.id ? { ...u, hits } : u.id === alien.id ? { ...u, hp: alienHp } : u,
      );
    expect(restoreBattle(ranked, { ...b, units: units(2, alien.hp - 2) })).not.toBeNull();
    expect(restoreBattle(ranked, { ...b, units: units(3, alien.hp - 2) })).toBeNull();
    expect(restoreBattle(ranked, { ...b, units: units(1, alien.hp) })).toBeNull();
  });

  it('keeps death counts, and rejects bad ones (M5.3, version 4)', () => {
    const shamed = { ...ranked, deaths: [2, 0, 1, 0] };
    const loaded = decodeSave(encodeSave(shamed, null));
    expect(loaded.ok && loaded.save.campaign.deaths).toEqual([2, 0, 1, 0]);
    const c = good.campaign;
    expect(decodes({ ...good, campaign: without(c, 'deaths') })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, deaths: [0, 0, 0] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, deaths: [0, 0, 0, -1] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, deaths: [0, 0, 0, 0.5] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, deaths: [0, 0, 0, '1'] } })).toBe(false);
    expect(decodes({ ...good, campaign: { ...c, deaths: [0, 0, 0, 100_001] } })).toBe(false);
  });

  it('checks the boss fields of version 5, and keeps them off everyone but the boss (M5.6)', () => {
    const unit = b.units[0] as (typeof b.units)[number];
    expect(unit).toMatchObject({ front: 0, charging: null, cooldown: 0 });
    const withUnit = (u: object): unknown => ({
      ...good,
      battle: { ...b, units: [u, ...b.units.slice(1)] },
    });
    for (const bad of [
      { front: 2 },
      { front: '1' },
      { cooldown: -1 },
      { cooldown: 99 },
      { cooldown: 0.5 },
      { charging: { x: 1 } },
      { charging: { x: 1, y: 2, z: 3 } },
      { charging: { x: -1, y: 2 } },
      { charging: 'here' },
    ]) {
      expect(decodes(withUnit({ ...unit, ...bad })), JSON.stringify(bad)).toBe(false);
    }
    for (const field of ['front', 'charging', 'cooldown'] as const) {
      expect(decodes(withUnit(without(unit, field))), field).toBe(false);
    }
    // Well-formed, but a marine has no front, charge or rest: the battle won't restore.
    for (const odd of [{ front: 1 }, { charging: { x: 1, y: 1 } }, { cooldown: 1 }]) {
      const units = [{ ...unit, ...odd }, ...b.units.slice(1)];
      expect(restoreBattle(ranked, { ...b, units } as typeof b), JSON.stringify(odd)).toBeNull();
    }
  });

  it('still loads a version 4 save, with no boss fields', () => {
    const v4 = { v: 4, campaign: good.campaign, battle: { ...b, units: b.units.map(preBoss) } };
    const loaded = decodeSave(JSON.stringify(v4));
    if (!loaded.ok || !loaded.save.battle) throw new Error('did not load');
    expect(loaded.save.v).toBe(SAVE_VERSION);
    const back = restoreBattle(loaded.save.campaign, loaded.save.battle);
    expect(back?.units.every((u) => u.front === 0 && u.charging === null && u.cooldown === 0)).toBe(
      true,
    );
    // A version 4 save carrying version 5's fields isn't one.
    expect(decodes({ ...v4, battle: b })).toBe(false);
  });

  it('still loads a version 3 save, with no deaths', () => {
    const v3 = {
      v: 3,
      campaign: without(good.campaign, 'deaths'),
      battle: { ...b, units: b.units.map(preBoss) },
    };
    const loaded = decodeSave(JSON.stringify(v3));
    if (!loaded.ok) throw new Error('did not load');
    expect(loaded.save.v).toBe(SAVE_VERSION);
    expect(loaded.save.campaign.deaths).toEqual([0, 0, 0, 0]);
    expect(decodes({ ...v3, campaign: good.campaign })).toBe(false);
  });

  it('still loads a version 2 save, with no hits', () => {
    const v2 = {
      v: 2,
      campaign: without(good.campaign, 'deaths'),
      battle: { ...b, units: b.units.map((u) => without(preBoss(u), 'hits')) },
    };
    const loaded = decodeSave(JSON.stringify(v2));
    if (!loaded.ok || !loaded.save.battle) throw new Error('did not load');
    expect(loaded.save.v).toBe(SAVE_VERSION);
    expect(loaded.save.battle.units.every((u) => u.hits === 0)).toBe(true);
    expect(loaded.save.battle.units.every((u) => typeof u.kills === 'number')).toBe(true);
    // A version 2 save with version 3's field isn't one.
    expect(decodes({ ...v2, battle: b })).toBe(false);
  });

  it('rejects more kills than the other side has lost', () => {
    const marine = b.units.find((u) => u.id === 'm1') as (typeof b.units)[number];
    const alien = b.units.find((u) => u.id.startsWith('a')) as (typeof b.units)[number];
    const units = (kills: number, alienHp: number): typeof b.units =>
      b.units.map((u) =>
        u.id === marine.id ? { ...u, kills } : u.id === alien.id ? { ...u, hp: alienHp } : u,
      );
    expect(restoreBattle(ranked, { ...b, units: units(1, 0) })).not.toBeNull();
    expect(restoreBattle(ranked, { ...b, units: units(1, alien.hp) })).toBeNull();
    expect(restoreBattle(ranked, { ...b, units: units(2, 0) })).toBeNull();
  });

  it('still loads a version 1 save, with no XP, kills or replay', () => {
    const v1 = {
      v: 1,
      campaign: without(without(good.campaign, 'xp'), 'deaths'),
      battle: {
        round: b.round,
        rng: b.rng,
        units: b.units.map((u) => without(without(preBoss(u), 'kills'), 'hits')),
      },
    };
    const loaded = decodeSave(JSON.stringify(v1));
    if (!loaded.ok || !loaded.save.battle) throw new Error('did not load');
    expect(loaded.save.v).toBe(SAVE_VERSION);
    expect(loaded.save.campaign.xp).toEqual([0, 0, 0, 0]);
    expect(loaded.save.battle.replay).toBe(false);
    expect(loaded.save.battle.units.every((u) => u.kills === 0)).toBe(true);
    // A version 1 save with version 2's fields isn't one.
    expect(decodes({ ...v1, campaign: good.campaign })).toBe(false);
    expect(decodes({ ...v1, battle: { ...v1.battle, replay: false } })).toBe(false);
    expect(decodes({ ...v1, v: 0 })).toBe(false);
    expect(decodes({ ...v1, v: SAVE_VERSION + 1, campaign: good.campaign, battle: b })).toBe(false);
  });
});
