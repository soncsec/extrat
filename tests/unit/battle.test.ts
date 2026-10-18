import { describe, expect, it } from 'vitest';
import {
  ACTION_POINTS,
  GRENADE,
  MAP_COLS,
  MAP_ROWS,
  OVERWATCH,
  SHOOTING,
  SKIRMISH,
  UNITS,
} from '../../src/config/tuning';
import {
  apply,
  blastTargets,
  canAct,
  canOverwatch,
  canReload,
  canSee,
  canThrow,
  clipSize,
  coverAgainst,
  createBattle,
  hitChance,
  inThrowRange,
  livingUnits,
  moveCost,
  moveRange,
  pathFor,
  reactionOdds,
  shotBlock,
  shotOdds,
  unitAt,
  unitById,
  type BattleState,
  type Unit,
} from '../../src/logic/battle';
import type { Point } from '../../src/logic/grid';
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
    // With one action point left, one tile past the move range is too far (no dash).
    const tired = { ...s, units: s.units.map((u) => (u.id === m ? { ...u, ap: 1 } : u)) };
    const tooFar = { x: 2 + UNITS.marine.move + 1, y: 1 };
    expect(apply(tired, { type: 'move', unitId: m, to: tooFar })).toBe(tired);
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
        // A critical hit adds SHOOTING.critDamage on top of the normal range.
        const bonus = shot.crit ? SHOOTING.critDamage : 0;
        expect(shot.damage).toBeGreaterThanOrEqual(UNITS.marine.damage.min + bonus);
        expect(shot.damage).toBeLessThanOrEqual(UNITS.marine.damage.max + bonus);
        expect(hp).toBe(Math.max(0, UNITS.walker.hp - shot.damage));
        expect(shot.killed).toBe(hp === 0);
      } else {
        misses++;
        expect(shot.crit).toBe(false);
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

describe('cover and line of sight', () => {
  /** Marine 'm' and alien 'a' on a map drawn as a picture ('#' pine, 'b' bush). */
  function field(rows: string[], m: Point, a: Point): BattleState {
    const s = createBattle(openMap(Array(rows.length).fill('.'.repeat(rows[0]?.length ?? 0))), 1);
    const marine = must(s.units.find((u) => u.side === 'marine'));
    const alien = must(s.units.find((u) => u.side === 'alien'));
    return {
      ...s,
      map: openMap(rows),
      units: [
        { ...marine, id: 'm', ...m },
        { ...alien, id: 'a', ...a },
      ],
    };
  }

  it('gives cover only against shots from the side the prop is on', () => {
    const map = openMap(['.....', '..#b.', '.....']);
    // The unit at (1,1) has a pine to its east.
    expect(coverAgainst(map, { x: 1, y: 1 }, { x: 4, y: 0 })).toBe('full');
    expect(coverAgainst(map, { x: 1, y: 1 }, { x: 0, y: 2 })).toBeNull();
    expect(coverAgainst(map, { x: 1, y: 1 }, { x: 1, y: 2 })).toBeNull(); // straight below
    // The unit at (4,1) has a bush to its west.
    expect(coverAgainst(map, { x: 4, y: 1 }, { x: 0, y: 1 })).toBe('half');
  });

  it('takes the best cover when there is more than one', () => {
    const map = openMap(['..b..', '.#.b.', '.....']);
    // (2,1): pine to the west, bush to the east, bush to the north.
    expect(coverAgainst(map, { x: 2, y: 1 }, { x: 0, y: 0 })).toBe('full');
    expect(coverAgainst(map, { x: 2, y: 1 }, { x: 4, y: 0 })).toBe('half');
  });

  it('lets bushes and rocks be shot over, but not trees', () => {
    const s = field(['.........', '....b....', '.........'], { x: 1, y: 1 }, { x: 7, y: 1 });
    expect(canSee(s.map, s.units[0] as Unit, s.units[1] as Unit)).toBe(true);
    const t = field(['.........', '....#....', '.........'], { x: 1, y: 1 }, { x: 7, y: 1 });
    expect(canSee(t.map, t.units[0] as Unit, t.units[1] as Unit)).toBe(false);
    expect(shotBlock(t, 'm', 'a')).toBe('sight');
    expect(hitChance(t, 'm', 'a')).toBeNull();
  });

  it('says why a shot is not possible', () => {
    const far = field(['.'.repeat(24)], { x: 0, y: 0 }, { x: 23, y: 0 });
    expect(shotBlock(far, 'm', 'a')).toBe('range');
    const ok = field(['.'.repeat(24)], { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(shotBlock(ok, 'm', 'a')).toBeNull();
    expect(shotBlock(ok, 'm', 'nobody')).toBe('other');
  });

  it('lowers the hit chance by the cover the target has toward the shooter', () => {
    const open = field(['..........'], { x: 1, y: 0 }, { x: 6, y: 0 });
    const half = field(['.....b....'], { x: 1, y: 0 }, { x: 6, y: 0 });
    const flanked = field(['.......b..'], { x: 1, y: 0 }, { x: 6, y: 0 }); // bush behind the alien
    const base = must(hitChance(open, 'm', 'a') ?? undefined);
    expect(hitChance(half, 'm', 'a')).toBe(base - SHOOTING.cover.half);
    expect(hitChance(flanked, 'm', 'a')).toBe(base);
  });

  it('gives full cover against shots from an angle that miss the tree itself', () => {
    // Pine at (5,2) west of the alien at (6,2); the marine at (3,6) shoots from the
    // south-west, 5 tiles away, so the line passes beside the pine.
    const rows = ['.......', '.......', '.....#.', '.......', '.......', '.......', '.......'];
    const s = field(rows, { x: 3, y: 6 }, { x: 6, y: 2 });
    expect(shotBlock(s, 'm', 'a')).toBeNull();
    expect(hitChance(s, 'm', 'a')).toBe(UNITS.marine.aim - SHOOTING.cover.full);
  });
});

describe('shot odds, flanking and crits', () => {
  /** Marine 'm' and alien 'a' on a one-row map drawn as a picture. */
  function row(picture: string, mx: number, ax: number, rng = 1): BattleState {
    const s = createBattle(openMap(['.'.repeat(picture.length)]), 1);
    const marine = must(s.units.find((u) => u.side === 'marine'));
    const alien = must(s.units.find((u) => u.side === 'alien'));
    return {
      ...s,
      rng,
      map: openMap([picture]),
      units: [
        { ...marine, id: 'm', x: mx, y: 0 },
        { ...alien, id: 'a', x: ax, y: 0 },
      ],
    };
  }

  it('breaks the hit chance into aim, range and cover', () => {
    // 9 tiles apart (4 beyond close range), bush in front of the alien.
    const odds = shotOdds(row('........b..', 0, 9), 'm', 'a');
    expect(odds).toEqual({
      aim: UNITS.marine.aim,
      range: -4 * SHOOTING.penaltyPerTile,
      cover: 'half',
      coverPenalty: SHOOTING.cover.half,
      flanked: false,
      reactionPenalty: 0,
      exposed: false,
      hit: UNITS.marine.aim - 4 * SHOOTING.penaltyPerTile - SHOOTING.cover.half,
      crit: UNITS.marine.crit,
    });
  });

  it('counts a target with no cover facing the shooter as flanked, with extra crit chance', () => {
    // The bush is behind the alien, so it doesn't count.
    const odds = must(shotOdds(row('......b', 0, 5), 'm', 'a') ?? undefined);
    expect(odds.flanked).toBe(true);
    expect(odds.cover).toBeNull();
    expect(odds.crit).toBe(UNITS.marine.crit + SHOOTING.flankCrit);
    expect(shotOdds(row('......#', 0, 20), 'm', 'a')).toBeNull(); // out of range
  });

  it('crits about as often as the odds say, and only on hits', () => {
    let flankedCrits = 0;
    let coveredCrits = 0;
    let flankedHits = 0;
    let coveredHits = 0;
    for (let rng = 1; rng <= 400; rng++) {
      const open = apply(row('.......', 0, 4, rng), { type: 'shoot', unitId: 'm', targetId: 'a' });
      const cover = apply(row('...b...', 0, 4, rng), { type: 'shoot', unitId: 'm', targetId: 'a' });
      if (open.lastShot?.hit) flankedHits++;
      if (open.lastShot?.crit) flankedCrits++;
      if (cover.lastShot?.hit) coveredHits++;
      if (cover.lastShot?.crit) coveredCrits++;
    }
    // Flanked: 50% of hits should crit; in cover: 10%.
    expect(flankedCrits / flankedHits).toBeGreaterThan(0.38);
    expect(flankedCrits / flankedHits).toBeLessThan(0.62);
    expect(coveredCrits / coveredHits).toBeLessThan(0.2);
  });
});

describe('dashing', () => {
  /** A 24 x 1 corridor with the marine at x = 0. */
  function corridor(ap = ACTION_POINTS): BattleState {
    const s = createBattle(openMap(['.'.repeat(24)]), 1);
    const marine = must(s.units.find((u) => u.side === 'marine'));
    return { ...s, units: [{ ...marine, id: 'm', x: 0, y: 0, ap }] };
  }
  const move = UNITS.marine.move;

  it('costs one action point within the move range and two beyond it', () => {
    const s = corridor();
    expect(unitById(apply(s, { type: 'move', unitId: 'm', to: { x: move, y: 0 } }), 'm')?.ap).toBe(
      ACTION_POINTS - 1,
    );
    expect(
      unitById(apply(s, { type: 'move', unitId: 'm', to: { x: move + 1, y: 0 } }), 'm')?.ap,
    ).toBe(0);
    expect(moveCost(must(s.units[0]), move)).toBe(1);
    expect(moveCost(must(s.units[0]), move + 1)).toBe(2);
  });

  it('reaches up to twice the move range with both points, no further', () => {
    const s = corridor();
    const far = apply(s, { type: 'move', unitId: 'm', to: { x: move * 2, y: 0 } });
    expect(unitById(far, 'm')).toMatchObject({ x: move * 2, ap: 0 });
    expect(apply(s, { type: 'move', unitId: 'm', to: { x: move * 2 + 1, y: 0 } })).toBe(s);
    expect(moveRange(s, 'm').size).toBe(move * 2);
  });

  it('cannot dash after moving once', () => {
    const once = apply(corridor(), { type: 'move', unitId: 'm', to: { x: 1, y: 0 } });
    expect(moveRange(once, 'm').size).toBe(move + 1); // x = 0, and x = 2 to 6
    expect(apply(once, { type: 'move', unitId: 'm', to: { x: 1 + move + 1, y: 0 } })).toBe(once);
    expect(pathFor(corridor(1), 'm', { x: move + 1, y: 0 })).toBeNull();
  });
});

describe('ammo and reloading', () => {
  /** A marine 'm' at (0,0) and a walker 'a' at (4,0) on an open row. */
  function range(marine: Partial<Unit> = {}, turn: 'marine' | 'alien' = 'marine'): BattleState {
    const s = createBattle(openMap(['.'.repeat(12)]), 1);
    const m = must(s.units.find((u) => u.side === 'marine'));
    const a = must(s.units.find((u) => u.side === 'alien'));
    return {
      ...s,
      turn,
      units: [
        { ...m, id: 'm', x: 0, y: 0, ...marine },
        { ...a, id: 'a', x: 4, y: 0 },
      ],
    };
  }

  it('starts marines with a full clip and walkers with a weapon that never runs dry', () => {
    const s = battle(2);
    for (const u of s.units) {
      expect(u.ammo).toBe(u.side === 'marine' ? UNITS.marine.ammo : null);
    }
  });

  it('uses one shot per shot fired, but none for walkers', () => {
    const shot = apply(range(), { type: 'shoot', unitId: 'm', targetId: 'a' });
    expect(unitById(shot, 'm')?.ammo).toBe(UNITS.marine.ammo - 1);
    const s = range({}, 'alien');
    const alienShot = apply(s, { type: 'shoot', unitId: 'a', targetId: 'm' });
    expect(alienShot.lastShot).not.toBeNull();
    expect(unitById(alienShot, 'a')?.ammo).toBeNull();
  });

  it('cannot shoot with an empty clip', () => {
    const s = range({ ammo: 0 });
    expect(shotBlock(s, 'm', 'a')).toBe('ammo');
    expect(hitChance(s, 'm', 'a')).toBeNull();
    expect(apply(s, { type: 'shoot', unitId: 'm', targetId: 'a' })).toBe(s);
  });

  it('reloads to a full clip for one action point', () => {
    const s = range({ ammo: 0 });
    expect(canReload(s, 'm')).toBe(true);
    const next = apply(s, { type: 'reload', unitId: 'm' });
    expect(unitById(next, 'm')).toMatchObject({ ammo: UNITS.marine.ammo, ap: ACTION_POINTS - 1 });
    expect(clipSize(must(unitById(next, 'm')))).toBe(UNITS.marine.ammo);
  });

  it('refuses to reload a full clip, a walker, with no action points, dead, or out of turn', () => {
    const full = range();
    expect(apply(full, { type: 'reload', unitId: 'm' })).toBe(full);
    const empty = range({ ammo: 1 });
    expect(apply({ ...empty, turn: 'alien' }, { type: 'reload', unitId: 'm' }).units).toBe(
      empty.units,
    );
    const tired = range({ ammo: 1, ap: 0 });
    expect(apply(tired, { type: 'reload', unitId: 'm' })).toBe(tired);
    const dead = range({ ammo: 1, hp: 0 });
    expect(apply(dead, { type: 'reload', unitId: 'm' })).toBe(dead);
    const walkers = range({}, 'alien');
    expect(canReload(walkers, 'a')).toBe(false);
    expect(apply(walkers, { type: 'reload', unitId: 'nobody' })).toBe(walkers);
  });
});

describe('overwatch', () => {
  /**
   * A 20 x 5 field: marine 'm' at (2,2) on overwatch, alien 'a' at (17,2), 15 tiles away
   * (just inside the marine's range of 16). It's the aliens' turn.
   */
  function watch(rows?: string[], rng = 1): BattleState {
    const pic = rows ?? Array(5).fill('.'.repeat(20));
    const s = createBattle(openMap(pic), 1);
    const m = must(s.units.find((u) => u.side === 'marine'));
    const a = must(s.units.find((u) => u.side === 'alien'));
    return {
      ...s,
      rng,
      turn: 'alien',
      units: [
        { ...m, id: 'm', x: 2, y: 2, ap: 0, overwatch: true },
        { ...a, id: 'a', x: 17, y: 2, ap: ACTION_POINTS },
      ],
    };
  }

  it('costs the rest of the turn and needs a point and ammo', () => {
    const s = { ...watch(), turn: 'marine' as const };
    const fresh = {
      ...s,
      units: s.units.map((u) => (u.id === 'm' ? { ...u, ap: 2, overwatch: false } : u)),
    };
    expect(canOverwatch(fresh, 'm')).toBe(true);
    const on = apply(fresh, { type: 'overwatch', unitId: 'm' });
    expect(unitById(on, 'm')).toMatchObject({ overwatch: true, ap: 0 });
    expect(apply(on, { type: 'overwatch', unitId: 'm' })).toBe(on); // already on, no points
    const dry = { ...fresh, units: fresh.units.map((u) => (u.id === 'm' ? { ...u, ammo: 0 } : u)) };
    expect(apply(dry, { type: 'overwatch', unitId: 'm' })).toBe(dry);
    expect(apply(fresh, { type: 'overwatch', unitId: 'a' })).toBe(fresh); // not the aliens' turn
  });

  it('fires once when an enemy moves within sight, then stops watching', () => {
    const s = watch();
    const next = apply(s, { type: 'move', unitId: 'a', to: { x: 14, y: 2 } });
    const moved = must(next.lastMove ?? undefined);
    expect(moved.reactions).toHaveLength(1);
    const { step, shot } = must(moved.reactions[0]);
    expect(step).toBe(0); // the first tile it stepped onto was already in sight
    expect(shot).toMatchObject({ shooterId: 'm', targetId: 'a', reaction: true, crit: false });
    expect(unitById(next, 'm')).toMatchObject({ overwatch: false, ammo: UNITS.marine.ammo - 1 });
    expect(unitById(next, 'a')?.hp).toBe(shot.hpAfter);
  });

  it('takes the snap-shot penalty and never crits', () => {
    const s = watch();
    const moved = { ...s, units: s.units.map((u) => (u.id === 'a' ? { ...u, x: 7 } : u)) };
    const odds = must(reactionOdds(moved, 'm', 'a') ?? undefined);
    expect(odds.reactionPenalty).toBe(OVERWATCH.aimPenalty);
    expect(odds.hit).toBe(UNITS.marine.aim - OVERWATCH.aimPenalty);
    expect(odds.crit).toBe(0);
    for (let rng = 1; rng <= 100; rng++) {
      const next = apply(watch(undefined, rng), { type: 'move', unitId: 'a', to: { x: 14, y: 2 } });
      for (const r of next.lastMove?.reactions ?? []) expect(r.shot.crit).toBe(false);
    }
  });

  it('stops the move where a reaction shot kills the mover', () => {
    for (let rng = 1; rng <= 300; rng++) {
      const s = watch(undefined, rng);
      const weak = { ...s, units: s.units.map((u) => (u.id === 'a' ? { ...u, hp: 1 } : u)) };
      const next = apply(weak, { type: 'move', unitId: 'a', to: { x: 14, y: 2 } });
      if (!next.lastMove?.reactions[0]?.shot.killed) continue;
      expect(next.lastMove.path).toEqual([{ x: 16, y: 2 }]);
      expect(unitById(next, 'a')).toMatchObject({ x: 16, y: 2, hp: 0 });
      return;
    }
    throw new Error('no killing reaction shot in 300 random states');
  });

  it('does not fire at moves it cannot see, or out of range', () => {
    // A wall of pines between them.
    const rows = Array(5).fill('..........#.........');
    const blind = apply(watch(rows), { type: 'move', unitId: 'a', to: { x: 14, y: 2 } });
    expect(blind.lastMove?.reactions).toEqual([]);
    expect(unitById(blind, 'm')?.overwatch).toBe(true);
    // Moving away, staying beyond 16 tiles.
    const s = watch();
    const far = { ...s, units: s.units.map((u) => (u.id === 'a' ? { ...u, x: 19 } : u)) };
    const away = apply(far, { type: 'move', unitId: 'a', to: { x: 19, y: 4 } });
    expect(away.lastMove?.reactions).toEqual([]);
  });

  it("ends when the watcher's side gets the turn back", () => {
    const next = apply(watch(), { type: 'endTurn' });
    expect(next.turn).toBe('marine');
    expect(unitById(next, 'm')?.overwatch).toBe(false);
  });
});

describe('grenades', () => {
  /**
   * A 20 x 7 field: marine 'm' at (2,3); aliens 'a1' at (8,3) and 'a2' at (9,4), next to
   * each other; marine 'm2' at (3,3), right beside 'm'. Bush at (7,3) covers a1 from the west.
   */
  function field(): BattleState {
    const rows = Array(7).fill('.'.repeat(20));
    rows[3] = '.......b............';
    const s = createBattle(openMap(rows), 1);
    const m = must(s.units.find((u) => u.side === 'marine'));
    const a = must(s.units.find((u) => u.side === 'alien'));
    return {
      ...s,
      map: openMap(rows),
      units: [
        { ...m, id: 'm', x: 2, y: 3 },
        { ...m, id: 'm2', x: 3, y: 3 },
        { ...a, id: 'a1', x: 8, y: 3 },
        { ...a, id: 'a2', x: 9, y: 4 },
      ],
    };
  }

  it('starts marines with grenades and aliens without', () => {
    for (const u of battle(5).units) {
      expect(u.grenades).toBe(u.side === 'marine' ? GRENADE.perMarine : 0);
      expect(u.exposed).toBe(false);
    }
  });

  it('damages everyone in the 3 x 3 blast and nobody outside it', () => {
    const s = field();
    const next = apply(s, { type: 'throw', unitId: 'm', at: { x: 8, y: 4 } });
    const thrown = must(next.lastThrow ?? undefined);
    expect(thrown.hits.map((h) => h.unitId).sort()).toEqual(['a1', 'a2']);
    for (const id of ['a1', 'a2']) {
      expect(unitById(next, id)).toMatchObject({
        hp: UNITS.walker.hp - GRENADE.damage,
        exposed: true,
      });
    }
    expect(unitById(next, 'm')).toMatchObject({
      grenades: GRENADE.perMarine - 1,
      ap: 0,
      facing: 1,
    });
    expect(unitById(next, 'm2')?.hp).toBe(UNITS.marine.hp);
  });

  it('hurts friends too', () => {
    const next = apply(field(), { type: 'throw', unitId: 'm', at: { x: 4, y: 3 } });
    expect(next.lastThrow?.hits.map((h) => h.unitId)).toEqual(['m2']);
    expect(unitById(next, 'm2')?.hp).toBe(UNITS.marine.hp - GRENADE.damage);
  });

  it('kills what it brings to zero, and dead units are not exposed', () => {
    const s = field();
    const weak = { ...s, units: s.units.map((u) => (u.id === 'a1' ? { ...u, hp: 2 } : u)) };
    const next = apply(weak, { type: 'throw', unitId: 'm', at: { x: 8, y: 3 } });
    expect(next.lastThrow?.hits.find((h) => h.unitId === 'a1')).toMatchObject({
      killed: true,
      hpAfter: 0,
    });
    expect(unitById(next, 'a1')).toMatchObject({ hp: 0, exposed: false });
  });

  it("strips cover from the survivors until the thrower's side starts its next turn", () => {
    const s = field();
    const covered = must(hitChance(s, 'm2', 'a1') ?? undefined);
    const next = apply(s, { type: 'throw', unitId: 'm', at: { x: 9, y: 3 } });
    const odds = must(shotOdds(next, 'm2', 'a1') ?? undefined);
    expect(odds.cover).toBeNull();
    expect(odds.exposed).toBe(true);
    expect(odds.hit).toBe(covered + SHOOTING.cover.half);
    const alienTurn = apply(next, { type: 'endTurn' });
    expect(unitById(alienTurn, 'a1')?.exposed).toBe(true); // still exposed in their turn
    const back = apply(alienTurn, { type: 'endTurn' });
    expect(unitById(back, 'a1')?.exposed).toBe(false);
  });

  it('refuses throws out of range, off the map, without grenades or points, or out of turn', () => {
    const s = field();
    expect(apply(s, { type: 'throw', unitId: 'm', at: { x: 2 + GRENADE.range + 1, y: 3 } })).toBe(
      s,
    );
    expect(apply(s, { type: 'throw', unitId: 'm', at: { x: -1, y: 3 } })).toBe(s);
    const none = { ...s, units: s.units.map((u) => (u.id === 'm' ? { ...u, grenades: 0 } : u)) };
    expect(apply(none, { type: 'throw', unitId: 'm', at: { x: 8, y: 3 } })).toBe(none);
    const tired = { ...s, units: s.units.map((u) => (u.id === 'm' ? { ...u, ap: 0 } : u)) };
    expect(apply(tired, { type: 'throw', unitId: 'm', at: { x: 8, y: 3 } })).toBe(tired);
    const theirs = { ...s, turn: 'alien' as const };
    expect(apply(theirs, { type: 'throw', unitId: 'm', at: { x: 8, y: 3 } })).toBe(theirs);
    expect(canThrow(s, 'a1')).toBe(false);
    expect(inThrowRange(s, 'nobody', { x: 1, y: 1 })).toBe(false);
  });

  it('lands over trees: no line of sight needed', () => {
    const s = field();
    const walled = { ...s, map: openMap(Array(7).fill('.....#..............')) };
    const next = apply(walled, { type: 'throw', unitId: 'm', at: { x: 8, y: 3 } });
    expect(next.lastThrow?.hits.length).toBeGreaterThan(0);
    expect(blastTargets(walled, { x: 0, y: 0 })).toEqual([]);
  });
});
