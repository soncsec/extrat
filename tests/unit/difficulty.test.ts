import { describe, expect, it } from 'vitest';
import {
  BOSS,
  DIFFICULTY,
  GRENADE,
  MAP_COLS,
  MAP_ROWS,
  MISSIONS,
  UNITS,
} from '../../src/config/tuning';
import {
  apply,
  createBattle,
  DIFFICULTY_IDS,
  shotOdds,
  type BattleState,
  type DifficultyId,
  type Unit,
} from '../../src/logic/battle';
import { currentMission, missionPods, newCampaign } from '../../src/logic/campaign';
import { decodeSave, encodeSave, restoreBattle } from '../../src/logic/save';
import { generateForest, generateMap, type BattleMap } from '../../src/logic/map';

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

/** A marine and an awake alien in the open, four tiles apart. */
function duel(difficulty: DifficultyId): BattleState {
  const base = createBattle(generateForest(1, MAP_COLS, MAP_ROWS), 1, { difficulty });
  const m = base.units.find((u) => u.side === 'marine') as Unit;
  const a = base.units.find((u) => u.side === 'alien') as Unit;
  return {
    ...base,
    map: openMap(),
    turn: 'alien',
    units: [
      { ...m, id: 'm', x: 2, y: 3 },
      { ...a, id: 'a', x: 6, y: 3, dormant: false, kind: 'flyer' },
    ],
  };
}

describe('difficulty (M6.3, owner 2026-10-19)', () => {
  it('starts campaigns as asked, VETERAN by default', () => {
    expect(newCampaign(3).difficulty).toBe('veteran');
    expect(newCampaign(3, 'recruit').difficulty).toBe('recruit');
    // The difficulty doesn't change the squad or the maps.
    expect({ ...newCampaign(3, 'recruit'), difficulty: 'veteran' }).toEqual(newCampaign(3));
  });

  it('gives RECRUIT marines more health and grenades, and leaves VETERAN as it was', () => {
    const map = generateForest(5, MAP_COLS, MAP_ROWS);
    const marines = (d: DifficultyId): Unit[] =>
      createBattle(map, map.seed, { difficulty: d }).units.filter((u) => u.side === 'marine');
    for (const m of marines('veteran')) {
      expect(m.maxHp).toBe(UNITS.marine.hp);
      expect(m.grenades).toBe(GRENADE.perMarine);
    }
    for (const m of marines('recruit')) {
      expect(m.maxHp).toBe(UNITS.marine.hp + DIFFICULTY.recruit.marineHp);
      expect(m.hp).toBe(m.maxHp);
      expect(m.grenades).toBe(GRENADE.perMarine + DIFFICULTY.recruit.grenades);
    }
    // Same battle otherwise: everyone stands in the same place.
    const where = (d: DifficultyId): unknown =>
      createBattle(map, map.seed, { difficulty: d }).units.map((u) => [u.id, u.x, u.y]);
    expect(where('recruit')).toEqual(where('veteran'));
  });

  it('takes aim off RECRUIT aliens, and gives it to RECRUIT marines', () => {
    const veteran = shotOdds(duel('veteran'), 'a', 'm');
    const recruit = shotOdds(duel('recruit'), 'a', 'm');
    expect(recruit?.aim).toBe((veteran?.aim ?? 0) + DIFFICULTY.recruit.alienAim);
    const marineAim = (d: DifficultyId): number | undefined =>
      shotOdds({ ...duel(d), turn: 'marine' }, 'm', 'a')?.aim;
    expect(marineAim('recruit')).toBe((marineAim('veteran') ?? 0) + DIFFICULTY.recruit.marineAim);
  });

  it('makes the RECRUIT Overseer weaker', () => {
    const map = generateMap(9, MAP_COLS, MAP_ROWS, 'ship');
    const boss = (d: DifficultyId): Unit | undefined =>
      createBattle(map, map.seed, { boss: true, difficulty: d }).units.find(
        (u) => u.kind === 'overseer',
      );
    expect(boss('veteran')?.maxHp).toBe(UNITS.overseer.hp);
    expect(boss('recruit')?.maxHp).toBe(UNITS.overseer.hp + DIFFICULTY.recruit.bossHp);
    expect(boss('recruit')?.hp).toBe(boss('recruit')?.maxHp);
    expect(boss('recruit')?.maxHp ?? 0).toBeGreaterThan(0);
  });

  it('softens the RECRUIT Overseer`s blast', () => {
    const map = generateMap(9, MAP_COLS, MAP_ROWS, 'ship');
    const blastOn = (d: DifficultyId): number => {
      const s = createBattle(map, map.seed, { boss: true, difficulty: d });
      const boss = s.units.find((u) => u.kind === 'overseer') as Unit;
      const marine = s.units.find((u) => u.side === 'marine') as Unit;
      // A marine standing where the charged blast lands, on the boss's turn.
      const at = { x: marine.x, y: marine.y };
      const ready: BattleState = {
        ...s,
        turn: 'alien',
        units: s.units.map((u) =>
          u.id === boss.id ? { ...u, dormant: false, charging: at, ap: 2 } : u,
        ),
      };
      const after = apply(ready, { type: 'blast', unitId: boss.id });
      return after.lastBlast?.hits.find((h) => h.unitId === marine.id)?.damage ?? 0;
    };
    expect(blastOn('veteran')).toBe(BOSS.blast.damage);
    expect(blastOn('recruit')).toBe(BOSS.blast.damage + DIFFICULTY.recruit.blastDamage);
  });

  it('gives RECRUIT aliens (not the boss) a point less health, and weaker hits', () => {
    const map = generateForest(5, MAP_COLS, MAP_ROWS);
    const aliens = (d: DifficultyId): Unit[] =>
      createBattle(map, map.seed, { difficulty: d }).units.filter((u) => u.side === 'alien');
    for (const a of aliens('recruit')) {
      expect(a.maxHp).toBe(Math.max(1, UNITS[a.kind].hp + DIFFICULTY.recruit.alienHp));
    }
    for (const a of aliens('veteran')) expect(a.maxHp).toBe(UNITS[a.kind].hp);
    // A sure hit by the flyer at the marine: on RECRUIT, a point less (never under 1).
    const hitOn = (d: DifficultyId): number => {
      const s = duel(d);
      const sure = {
        ...s,
        units: s.units.map((u) => (u.id === 'a' ? { ...u, kind: 'walker' as const, x: 3 } : u)),
      };
      for (let rng = 1; rng < 200; rng++) {
        const shot = apply(
          { ...sure, rng },
          { type: 'shoot', unitId: 'a', targetId: 'm' },
        ).lastShot;
        if (shot?.hit && !shot.crit) return shot.damage;
      }
      return -1;
    };
    const veteranHit = hitOn('veteran');
    expect(veteranHit).toBeGreaterThan(0);
    expect(hitOn('recruit')).toBeGreaterThanOrEqual(1);
    expect(hitOn('recruit')).toBeLessThanOrEqual(
      Math.max(1, veteranHit + DIFFICULTY.recruit.alienDamage),
    );
  });

  it('fields one alien group in missions 1 and 2 on RECRUIT, the usual on VETERAN', () => {
    for (const [i, mission] of MISSIONS.entries()) {
      const recruit = missionPods(mission, 'recruit');
      const veteran = missionPods(mission, 'veteran');
      expect(veteran).toEqual(mission.pods);
      expect(recruit.count, `mission ${i + 1}`).toBe(i < 2 ? 1 : mission.pods.count);
    }
  });

  it('lists RECRUIT and VETERAN, and VETERAN changes nothing', () => {
    expect(DIFFICULTY_IDS).toEqual(['recruit', 'veteran']);
    const { name, ...changes } = DIFFICULTY.veteran;
    expect(name).toBe('VETERAN');
    expect(Object.values(changes).every((v) => v === 0)).toBe(true);
  });

  it('survives a save: a RECRUIT battle reloads with its tougher marines', () => {
    const c = newCampaign(21, 'recruit');
    const map = generateMap(c.mapSeed, MAP_COLS, MAP_ROWS, currentMission(c).landscape);
    const battle = createBattle(map, map.seed, {
      names: c.squad,
      pods: missionPods(currentMission(c), c.difficulty),
      kinds: currentMission(c).kinds,
      difficulty: c.difficulty,
    });
    const loaded = decodeSave(encodeSave(c, battle));
    if (!loaded.ok || !loaded.save.battle) throw new Error('did not load');
    const back = restoreBattle(loaded.save.campaign, loaded.save.battle);
    expect(back?.difficulty).toBe('recruit');
    expect(back?.units.filter((u) => u.side === 'marine').map((u) => u.maxHp)).toEqual(
      battle.units.filter((u) => u.side === 'marine').map((u) => u.maxHp),
    );
  });
});
