import { describe, expect, it } from 'vitest';
import {
  ACTION_POINTS,
  MAP_COLS,
  MAP_ROWS,
  SHOOTING,
  SKIRMISH,
  UNITS,
} from '../../src/config/tuning';
import {
  apply,
  canAct,
  createBattle,
  hitChance,
  livingUnits,
  moveRange,
  pathFor,
  unitAt,
  unitById,
  type BattleState,
} from '../../src/logic/battle';
import { generateForest, isWalkable, spawnZone, type BattleMap } from '../../src/logic/map';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test fixture');
  return value;
}

const battle = (seed: number): BattleState =>
  createBattle(generateForest(seed, MAP_COLS, MAP_ROWS), seed);

/** An open map with optional props: '#' is a pine, 'b' a bush, anything else is free. */
function openMap(rows: string[]): BattleMap {
  const cols = (rows[0] as string).length;
  return {
    cols,
    rows: rows.length,
    seed: 0,
    tiles: rows.flatMap((r) =>
      [...r].map((c) => ({
        prop: c === '#' ? ('pine' as const) : c === 'b' ? ('bush' as const) : null,
        anchor: c !== '.',
      })),
    ),
    decals: [],
  };
}

describe('createBattle', () => {
  it('deploys the squad in the west and the aliens in the east', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = battle(seed);
      const marines = s.units.filter((u) => u.side === 'marine');
      const aliens = s.units.filter((u) => u.side === 'alien');
      expect(marines).toHaveLength(SKIRMISH.marines);
      expect(aliens).toHaveLength(SKIRMISH.aliens);
      const [wMin, wMax] = spawnZone(MAP_COLS, 'west');
      const [eMin, eMax] = spawnZone(MAP_COLS, 'east');
      for (const m of marines) expect(m.x >= wMin && m.x <= wMax, `seed ${seed}`).toBe(true);
      for (const a of aliens) expect(a.x >= eMin && a.x <= eMax, `seed ${seed}`).toBe(true);
    }
  });

  it('puts every unit on its own walkable tile', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = battle(seed);
      const tiles = new Set(s.units.map((u) => `${u.x},${u.y}`));
      expect(tiles.size).toBe(s.units.length);
      for (const u of s.units) expect(isWalkable(s.map, u.x, u.y)).toBe(true);
    }
  });

  it('keeps squadmates apart on the forest maps', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const marines = battle(seed).units.filter((u) => u.side === 'marine');
      for (const a of marines) {
        for (const b of marines) {
          if (a === b) continue;
          const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(SKIRMISH.minSpacing);
        }
      }
    }
  });

  it('starts the marines turn with full health, facing the enemy, nothing selected', () => {
    const s = battle(3);
    expect(s.turn).toBe('marine');
    expect(s.selected).toBeNull();
    for (const u of s.units) {
      const hp = u.side === 'marine' ? UNITS.marine.hp : UNITS.walker.hp;
      expect(u).toMatchObject({ hp, maxHp: hp, facing: u.side === 'marine' ? 1 : -1 });
    }
  });

  it('gives each marine a different name', () => {
    const names = battle(8)
      .units.filter((u) => u.side === 'marine')
      .map((u) => u.name);
    expect(new Set(names).size).toBe(SKIRMISH.marines);
  });

  it('is the same for the same seed', () => {
    expect(battle(55)).toEqual(battle(55));
  });

  it('prefers tiles with cover facing the enemy', () => {
    // Only (2,1) has a bush to its east inside the west zone (columns 1-4).
    const map = openMap([
      '..........',
      '..b.......',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
    ]);
    map.tiles[1 * 10 + 2] = { prop: null, anchor: false };
    map.tiles[1 * 10 + 3] = { prop: 'bush', anchor: true };
    for (let seed = 1; seed <= 20; seed++) {
      const s = createBattle(map, seed);
      expect(s.units.some((u) => u.side === 'marine' && u.x === 2 && u.y === 1)).toBe(true);
    }
  });

  it('packs units closer when the zone is too small to keep them apart', () => {
    // A narrow map: each zone has only one column of free tiles.
    const map = openMap(['......', '......', '......', '......']);
    const s = createBattle(map, 1);
    expect(s.units.filter((u) => u.side === 'marine')).toHaveLength(SKIRMISH.marines);
  });

  it('throws if a spawn zone cannot hold everyone', () => {
    // One row: the west zone (columns 1-4) has only two free tiles.
    const map = openMap(['.##...']);
    expect(() => createBattle(map, 1)).toThrow(/spawn tiles/);
  });
});

describe('apply select and deselect', () => {
  const s = battle(12);
  const marine = must(s.units.find((u) => u.side === 'marine'));
  const alien = must(s.units.find((u) => u.side === 'alien'));

  it('selects a living marine on the marines turn', () => {
    const next = apply(s, { type: 'select', unitId: marine.id });
    expect(next.selected).toBe(marine.id);
    expect(s.selected).toBeNull(); // the old state is unchanged
  });

  it('ignores aliens, unknown ids, dead marines and the alien turn', () => {
    expect(apply(s, { type: 'select', unitId: alien.id })).toBe(s);
    expect(apply(s, { type: 'select', unitId: 'nobody' })).toBe(s);
    const dead = { ...s, units: s.units.map((u) => (u.id === marine.id ? { ...u, hp: 0 } : u)) };
    expect(apply(dead, { type: 'select', unitId: marine.id })).toBe(dead);
    const alienTurn: BattleState = { ...s, turn: 'alien' };
    expect(apply(alienTurn, { type: 'select', unitId: marine.id })).toBe(alienTurn);
  });

  it('returns the same state when selecting the selected marine again', () => {
    const once = apply(s, { type: 'select', unitId: marine.id });
    expect(apply(once, { type: 'select', unitId: marine.id })).toBe(once);
  });

  it('deselects, and does nothing when nothing is selected', () => {
    const once = apply(s, { type: 'select', unitId: marine.id });
    expect(apply(once, { type: 'deselect' }).selected).toBeNull();
    expect(apply(s, { type: 'deselect' })).toBe(s);
  });
});

describe('unit lookups', () => {
  const s = battle(4);
  const u = must(s.units[0]);

  it('finds units by id and by tile', () => {
    expect(unitById(s, u.id)).toBe(u);
    expect(unitAt(s, u.x, u.y)).toBe(u);
    expect(unitAt(s, -1, -1)).toBeUndefined();
  });

  it('ignores dead units on a tile', () => {
    const dead = { ...s, units: s.units.map((x) => (x.id === u.id ? { ...x, hp: 0 } : x)) };
    expect(unitAt(dead, u.x, u.y)).toBeUndefined();
  });
});

describe('moving', () => {
  /** A 10 x 3 open field with one marine at (2,1) and one alien at (8,1). */
  function field(): BattleState {
    const s = createBattle(openMap(['..........', '..........', '..........']), 1);
    const marine = must(s.units.find((u) => u.side === 'marine'));
    const alien = must(s.units.find((u) => u.side === 'alien'));
    return {
      ...s,
      units: [
        { ...marine, x: 2, y: 1, facing: 1 },
        { ...alien, x: 8, y: 1, facing: -1 },
      ],
    };
  }
  const id = (s: BattleState, side: 'marine' | 'alien'): string =>
    must(s.units.find((u) => u.side === side)).id;

  it('moves a marine, spends an action point, and leaves the old state alone', () => {
    const s = field();
    const m = id(s, 'marine');
    const next = apply(s, { type: 'move', unitId: m, to: { x: 5, y: 1 } });
    expect(unitById(next, m)).toMatchObject({ x: 5, y: 1, ap: ACTION_POINTS - 1 });
    expect(unitById(s, m)).toMatchObject({ x: 2, y: 1, ap: ACTION_POINTS });
  });

  it('turns the unit toward its last sideways step', () => {
    const s = field();
    const m = id(s, 'marine');
    const left = apply(s, { type: 'move', unitId: m, to: { x: 0, y: 2 } });
    expect(unitById(left, m)?.facing).toBe(-1);
    const down = apply(s, { type: 'move', unitId: m, to: { x: 2, y: 2 } });
    expect(unitById(down, m)?.facing).toBe(1);
  });

  it('refuses tiles out of range, blocked, occupied or off the map', () => {
    const s = field();
    const m = id(s, 'marine');
    const tooFar = { x: 2 + UNITS.marine.move + 1, y: 1 };
    expect(apply(s, { type: 'move', unitId: m, to: tooFar })).toBe(s);
    expect(apply(s, { type: 'move', unitId: m, to: { x: 8, y: 1 } })).toBe(s);
    expect(apply(s, { type: 'move', unitId: m, to: { x: -1, y: 1 } })).toBe(s);
    const blocked = { ...s, map: openMap(['..........', '...#......', '..........']) };
    expect(apply(blocked, { type: 'move', unitId: m, to: { x: 3, y: 1 } })).toBe(blocked);
  });

  it('refuses to move with no action points, when dead, or out of turn', () => {
    const s = field();
    const m = id(s, 'marine');
    const once = apply(s, { type: 'move', unitId: m, to: { x: 3, y: 1 } });
    const twice = apply(once, { type: 'move', unitId: m, to: { x: 4, y: 1 } });
    expect(unitById(twice, m)).toMatchObject({ x: 4, ap: 0 });
    expect(apply(twice, { type: 'move', unitId: m, to: { x: 5, y: 1 } })).toBe(twice);
    const dead = { ...s, units: s.units.map((u) => (u.id === m ? { ...u, hp: 0 } : u)) };
    expect(apply(dead, { type: 'move', unitId: m, to: { x: 3, y: 1 } })).toBe(dead);
    expect(apply(s, { type: 'move', unitId: id(s, 'alien'), to: { x: 7, y: 1 } })).toBe(s);
    expect(apply(s, { type: 'move', unitId: 'nobody', to: { x: 3, y: 1 } })).toBe(s);
  });

  it('walks around other units', () => {
    const s = field();
    const m = id(s, 'marine');
    const walled = {
      ...s,
      units: [...s.units, { ...must(s.units[1]), id: 'a9', x: 3, y: 1 }],
    };
    expect(pathFor(walled, m, { x: 4, y: 1 })).toHaveLength(4);
  });

  it('lists the reachable tiles, not including the unit itself', () => {
    const s = field();
    const m = id(s, 'marine');
    const range = moveRange(s, m);
    const cols = s.map.cols;
    expect(range.has(1 * cols + 2)).toBe(false);
    expect(range.get(1 * cols + 7)).toBe(5);
    expect(range.has(1 * cols + 8)).toBe(false); // the alien's tile
    expect(moveRange(s, 'nobody').size).toBe(0);
    const tired = { ...s, units: s.units.map((u) => (u.id === m ? { ...u, ap: 0 } : u)) };
    expect(moveRange(tired, m).size).toBe(0);
    expect(pathFor(tired, m, { x: 3, y: 1 })).toBeNull();
  });
});

describe('shooting', () => {
  /** A 24 x 3 open field: marine at (2,1) facing west, alien at `alienX`. */
  function range(alienX: number, overrides: Partial<BattleState> = {}): BattleState {
    const s = createBattle(openMap(Array(3).fill('.'.repeat(24))), 1);
    const marine = must(s.units.find((u) => u.side === 'marine'));
    const alien = must(s.units.find((u) => u.side === 'alien'));
    return {
      ...s,
      units: [
        { ...marine, id: 'm', x: 2, y: 1, facing: -1 },
        { ...alien, id: 'a', x: alienX, y: 1 },
      ],
      ...overrides,
    };
  }

  it('gives full aim at close range and loses some per tile beyond it', () => {
    expect(hitChance(range(2 + SHOOTING.closeRange), 'm', 'a')).toBe(UNITS.marine.aim);
    const far = 2 + SHOOTING.closeRange + 4;
    expect(hitChance(range(far), 'm', 'a')).toBe(UNITS.marine.aim - 4 * SHOOTING.penaltyPerTile);
  });

  it('refuses shots out of range, at allies, at or by the dead, or with no action points', () => {
    expect(hitChance(range(2 + UNITS.marine.range + 1), 'm', 'a')).toBeNull();
    const s = range(6);
    const ally = { ...s, units: [...s.units, { ...must(s.units[0]), id: 'm2', x: 3 }] };
    expect(hitChance(ally, 'm', 'm2')).toBeNull();
    const deadTarget = { ...s, units: s.units.map((u) => (u.id === 'a' ? { ...u, hp: 0 } : u)) };
    expect(hitChance(deadTarget, 'm', 'a')).toBeNull();
    const tired = { ...s, units: s.units.map((u) => (u.id === 'm' ? { ...u, ap: 0 } : u)) };
    expect(hitChance(tired, 'm', 'a')).toBeNull();
    expect(hitChance(s, 'm', 'nobody')).toBeNull();
  });

  it('keeps the hit chance between the minimum and maximum', () => {
    const s = range(6);
    const sharp = {
      ...s,
      units: s.units.map((u) => (u.id === 'm' ? { ...u, kind: 'walker' as const } : u)),
    };
    // A walker shooting at a marine from the edge of its range still has at least minChance.
    expect(hitChance(sharp, 'm', 'a')).toBeGreaterThanOrEqual(SHOOTING.minChance);
    expect(hitChance(range(3), 'm', 'a')).toBeLessThanOrEqual(SHOOTING.maxChance);
  });

  it('uses all action points, turns toward the target and records the shot', () => {
    const s = range(2 + SHOOTING.closeRange);
    const next = apply(s, { type: 'shoot', unitId: 'm', targetId: 'a' });
    expect(unitById(next, 'm')).toMatchObject({ ap: 0, facing: 1 });
    expect(next.lastShot).toMatchObject({
      shooterId: 'm',
      targetId: 'a',
      chance: UNITS.marine.aim,
    });
    expect(next.rng).not.toBe(s.rng);
  });

  it('deals damage in range on a hit and none on a miss', () => {
    let hits = 0;
    let misses = 0;
    for (let rng = 1; rng <= 200; rng++) {
      const next = apply(range(8, { rng }), { type: 'shoot', unitId: 'm', targetId: 'a' });
      const shot = must(next.lastShot ?? undefined);
      const hp = must(unitById(next, 'a')).hp;
      if (shot.hit) {
        hits++;
        expect(shot.damage).toBeGreaterThanOrEqual(UNITS.marine.damage.min);
        expect(shot.damage).toBeLessThanOrEqual(UNITS.marine.damage.max);
        expect(hp).toBe(Math.max(0, UNITS.walker.hp - shot.damage));
        expect(shot.killed).toBe(hp === 0);
      } else {
        misses++;
        expect(shot.damage).toBe(0);
        expect(hp).toBe(UNITS.walker.hp);
      }
    }
    // About 70% should hit at this range.
    expect(hits).toBeGreaterThan(120);
    expect(misses).toBeGreaterThan(30);
  });

  it('gives the same result for the same random state', () => {
    const a = apply(range(9, { rng: 77 }), { type: 'shoot', unitId: 'm', targetId: 'a' });
    const b = apply(range(9, { rng: 77 }), { type: 'shoot', unitId: 'm', targetId: 'a' });
    expect(a).toEqual(b);
  });

  it('leaves a killed alien out of the fight', () => {
    // Find a random state that kills: a hit for the walker's full health.
    for (let rng = 1; rng <= 500; rng++) {
      const next = apply(range(4, { rng }), { type: 'shoot', unitId: 'm', targetId: 'a' });
      if (!next.lastShot?.killed) continue;
      expect(unitById(next, 'a')?.hp).toBe(0);
      expect(unitAt(next, 4, 1)).toBeUndefined();
      return;
    }
    throw new Error('no killing shot in 500 random states');
  });

  it('refuses to shoot out of turn', () => {
    const s = range(8, { turn: 'alien' });
    expect(apply(s, { type: 'shoot', unitId: 'm', targetId: 'a' })).toBe(s);
  });
});

describe('ending the turn', () => {
  it('hands over to the aliens with full action points and clears the selection', () => {
    const s = battle(6);
    const marine = must(s.units.find((u) => u.side === 'marine'));
    const selected = apply(s, { type: 'select', unitId: marine.id });
    const tiredAliens = {
      ...selected,
      units: selected.units.map((u) => (u.side === 'alien' ? { ...u, ap: 0 } : u)),
    };
    const next = apply(tiredAliens, { type: 'endTurn' });
    expect(next.turn).toBe('alien');
    expect(next.round).toBe(1);
    expect(next.selected).toBeNull();
    for (const a of livingUnits(next, 'alien')) expect(a.ap).toBe(ACTION_POINTS);
  });

  it('starts a new round when the marines get the turn back, skipping the dead', () => {
    const s = battle(6);
    const dead = must(s.units.find((u) => u.side === 'marine'));
    const spent = {
      ...s,
      turn: 'alien' as const,
      units: s.units.map((u) => ({ ...u, ap: 0, hp: u.id === dead.id ? 0 : u.hp })),
    };
    const next = apply(spent, { type: 'endTurn' });
    expect(next.turn).toBe('marine');
    expect(next.round).toBe(2);
    expect(unitById(next, dead.id)?.ap).toBe(0);
    for (const m of livingUnits(next, 'marine')) expect(m.ap).toBe(ACTION_POINTS);
  });

  it('knows when a side can still act', () => {
    const s = battle(6);
    expect(canAct(s, 'marine')).toBe(true);
    const spent = { ...s, units: s.units.map((u) => (u.side === 'marine' ? { ...u, ap: 0 } : u)) };
    expect(canAct(spent, 'marine')).toBe(false);
    expect(livingUnits(spent, 'marine')).toHaveLength(SKIRMISH.marines);
  });
});
