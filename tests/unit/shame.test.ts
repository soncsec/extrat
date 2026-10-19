import { describe, expect, it } from 'vitest';
import { MAP_COLS, MAP_ROWS, SHAME, SKIRMISH } from '../../src/config/tuning';
import { createBattle } from '../../src/logic/battle';
import { newCampaign, recordDeaths } from '../../src/logic/campaign';
import { generateForest } from '../../src/logic/map';
import {
  JOKES,
  MAX_JOKES,
  NICKNAMES,
  NO_SHAME,
  VETERAN_NICKNAMES,
  WIPE_JOKE,
  debriefJokes,
  nicknameFor,
} from '../../src/logic/shame';

describe('nicknames', () => {
  it('come only with a death, stay the same, and differ across the squad', () => {
    const c = newCampaign(5);
    expect(c.squad.map((_, i) => nicknameFor(c, i))).toEqual([null, null, null, null]);
    const shamed = { ...c, deaths: [1, 1, 1, 1] };
    const names = shamed.squad.map((_, i) => nicknameFor(shamed, i));
    expect(new Set(names).size).toBe(SKIRMISH.marines);
    for (const n of names) expect(NICKNAMES).toContain(n);
    expect(shamed.squad.map((_, i) => nicknameFor(shamed, i))).toEqual(names);
    // Another campaign draws differently (over many seeds, at least once).
    const others = Array.from({ length: 20 }, (_, s) =>
      nicknameFor({ ...newCampaign(s + 100), deaths: [1, 0, 0, 0] }, 0),
    );
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('get worse after enough deaths', () => {
    const c = { ...newCampaign(5), deaths: [SHAME.veteranDeaths, SHAME.veteranDeaths - 1, 0, 0] };
    expect(VETERAN_NICKNAMES).toContain(nicknameFor(c, 0));
    expect(NICKNAMES).toContain(nicknameFor(c, 1));
  });

  it('fit the squad table (at most 17 characters)', () => {
    for (const n of [...NICKNAMES, ...VETERAN_NICKNAMES])
      expect(n.length, n).toBeLessThanOrEqual(17);
    expect(VETERAN_NICKNAMES.length).toBeGreaterThanOrEqual(SKIRMISH.marines);
    expect(NICKNAMES.length).toBeGreaterThanOrEqual(SKIRMISH.marines);
  });
});

describe('debrief jokes', () => {
  it('name each lost marine, up to the limit, the same for the same map', () => {
    expect(debriefJokes([], 4, 1)).toEqual([]);
    const one = debriefJokes(['Okafor'], 4, 7);
    expect(one).toHaveLength(1);
    expect(one[0]).toContain('Okafor');
    expect(one[0]).not.toContain('{name}');
    expect(debriefJokes(['Okafor'], 4, 7)).toEqual(one);
    const three = debriefJokes(['Okafor', 'Tanaka', 'Reyes'], 4, 7);
    expect(three).toHaveLength(MAX_JOKES);
    expect(three[0]).not.toBe(three[1]);
  });

  it('have one line for a wiped-out squad, and keep every line short', () => {
    expect(debriefJokes(['a', 'b', 'c', 'd'], 4, 3)).toEqual([WIPE_JOKE]);
    const longest = 'Lindqvist';
    for (const j of JOKES) expect(j.replace('{name}', longest).length, j).toBeLessThanOrEqual(50);
    expect(WIPE_JOKE.length).toBeLessThanOrEqual(50);
    expect(NO_SHAME.length).toBeLessThanOrEqual(50);
  });
});

describe('deaths', () => {
  it('are counted for the marines lying dead when a battle ends', () => {
    const c = newCampaign(3);
    const map = generateForest(c.mapSeed, MAP_COLS, MAP_ROWS);
    const b = createBattle(map, map.seed, { names: c.squad });
    const after = {
      ...b,
      units: b.units.map((u) => (u.id === 'm2' || u.id === 'm4' ? { ...u, hp: 0 } : u)),
    };
    const once = recordDeaths(c, after);
    expect(once.deaths).toEqual([0, 1, 0, 1]);
    expect(recordDeaths(once, after).deaths).toEqual([0, 2, 0, 2]);
    expect(c.deaths).toEqual([0, 0, 0, 0]);
  });
});
