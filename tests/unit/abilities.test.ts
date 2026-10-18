import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  ALIEN_KINDS,
  MAP_COLS,
  MAP_ROWS,
  SHOOTING,
  UNITS,
} from '../../src/config/tuning';
import { planAlienAction } from '../../src/logic/ai';
import {
  apply,
  canOverwatch,
  createBattle,
  hitChance,
  shotBlock,
  shotOdds,
  unitById,
  type BattleState,
  type Unit,
  type UnitKind,
} from '../../src/logic/battle';
import { generateForest, type BattleMap } from '../../src/logic/map';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('missing test fixture');
  return value;
}

/** An open map from a picture: 'b' is a bush (half cover), 'o' a boulder (full). */
function mapOf(rows: string[]): BattleMap {
  const cols = (rows[0] as string).length;
  return {
    cols,
    rows: rows.length,
    seed: 0,
    tiles: rows.flatMap((r) =>
      [...r].map((c) => ({
        prop: c === 'b' ? ('bush' as const) : c === 'o' ? ('oak' as const) : null,
        anchor: c !== '.',
      })),
    ),
    decals: [],
  };
}

/** The fields that come from a unit's kind. */
function kindStats(kind: UnitKind): Partial<Unit> {
  const k = UNITS[kind];
  return { kind, hp: k.hp, maxHp: k.hp, move: k.move, ammo: k.ammo };
}

/**
 * The alien's turn: marine 'm' at `marine`, alien 'a' of `kind` at `alien`, awake.
 * Extra fields override either unit.
 */
function duel(
  kind: UnitKind,
  marine: Partial<Unit>,
  alien: Partial<Unit>,
  rows: string[] = Array(7).fill('.'.repeat(16)),
): BattleState {
  const base = createBattle(mapOf(Array(7).fill('.'.repeat(16))), 1);
  const m = must(base.units.find((u) => u.side === 'marine'));
  const a = must(base.units.find((u) => u.side === 'alien'));
  return {
    ...base,
    map: mapOf(rows),
    turn: 'alien',
    units: [
      { ...m, id: 'm', ...marine },
      { ...a, ...kindStats(kind), id: 'a', dormant: false, ...alien },
    ],
  };
}

/** The alien's attack on the marine, with the first random state that gives `want`. */
function attack(s: BattleState, want: (next: BattleState) => boolean): BattleState {
  for (let rng = 1; rng < 500; rng++) {
    const next = apply({ ...s, rng }, { type: 'shoot', unitId: 'a', targetId: 'm' });
    if (want(next)) return next;
  }
  throw new Error('no random state gives that result');
}
const hit = (next: BattleState): boolean => next.lastShot?.hit === true;
const miss = (next: BattleState): boolean => next.lastShot?.hit === false;

describe('alien kinds in a battle', () => {
  it('draws each alien kind at random, with that kind`s stats', () => {
    const seen = new Set<UnitKind>();
    for (let seed = 1; seed <= 40; seed++) {
      const map = generateForest(seed, MAP_COLS, MAP_ROWS);
      for (const u of createBattle(map, map.seed).units.filter((x) => x.side === 'alien')) {
        expect(ALIEN_KINDS).toContain(u.kind);
        const k = UNITS[u.kind];
        expect(u).toMatchObject({ hp: k.hp, maxHp: k.hp, move: k.move, ammo: k.ammo, poison: 0 });
        seen.add(u.kind);
      }
    }
    expect([...seen].sort()).toEqual([...ALIEN_KINDS].sort());
  });

  it('draws kinds without moving anyone: positions depend only on the seed and map', () => {
    const map = generateForest(23, MAP_COLS, MAP_ROWS);
    const a = createBattle(map, map.seed);
    const b = createBattle(map, map.seed);
    expect(a).toEqual(b);
  });
});

describe('walker: melee', () => {
  it('reaches only the 8 tiles around it', () => {
    expect(shotBlock(duel('walker', { x: 3, y: 3 }, { x: 4, y: 4 }), 'a', 'm')).toBeNull();
    expect(shotBlock(duel('walker', { x: 3, y: 3 }, { x: 5, y: 3 }), 'a', 'm')).toBe('range');
  });

  it('ignores cover and gets no flanking crit bonus', () => {
    // The marine at (3,3) has a bush to its east, facing the walker.
    const rows = Array(7).fill('.'.repeat(16));
    rows[3] = '....b...........';
    const s = duel('walker', { x: 3, y: 3 }, { x: 4, y: 2 }, rows);
    expect(shotOdds(s, 'a', 'm')).toMatchObject({
      hit: UNITS.walker.aim,
      cover: null,
      flanked: false,
      crit: UNITS.walker.crit,
    });
  });

  it('cannot go on overwatch', () => {
    expect(canOverwatch(duel('walker', { x: 1, y: 1 }, { x: 12, y: 5 }), 'a')).toBe(false);
    expect(canOverwatch(duel('snake', { x: 1, y: 1 }, { x: 12, y: 5 }), 'a')).toBe(true);
  });

  it('charges in and claws when it can reach a marine this turn', () => {
    const s = duel('walker', { x: 3, y: 3 }, { x: 8, y: 3 });
    const plan = planAlienAction(s, 'a');
    if (plan?.type !== 'move') throw new Error(`expected a move, got ${JSON.stringify(plan)}`);
    const after = apply(s, plan);
    expect(planAlienAction(after, 'a')).toEqual({ type: 'shoot', unitId: 'a', targetId: 'm' });
  });
});

describe('flyer: shoots from above', () => {
  it('makes full cover count as half, and half cover as none', () => {
    const rows = Array(7).fill('.'.repeat(16));
    rows[3] = '....b...........';
    const half = duel('flyer', { x: 3, y: 3 }, { x: 8, y: 3 }, rows);
    expect(shotOdds(half, 'a', 'm')).toMatchObject({ cover: null, hit: UNITS.flyer.aim });
    rows[3] = '....o...........';
    // From (5,0) the line to the marine passes the oak, which is still on the shooter's side.
    const full = duel('flyer', { x: 3, y: 3 }, { x: 5, y: 0 }, rows);
    expect(shotOdds(full, 'a', 'm')).toMatchObject({
      cover: 'half',
      hit: UNITS.flyer.aim - SHOOTING.cover.half,
    });
    // A snake from the same spot faces the full cover.
    expect(hitChance(duel('snake', { x: 3, y: 3 }, { x: 5, y: 0 }, rows), 'a', 'm')).toBe(
      UNITS.snake.aim - SHOOTING.cover.full,
    );
  });
});

describe('lizard: tongue pull', () => {
  it('drags a marine it hits to the tile next to it nearest the marine', () => {
    const s = duel('lizard', { x: 3, y: 3, overwatch: true }, { x: 7, y: 3 });
    const next = attack(s, hit);
    expect(next.lastShot?.pulledTo).toEqual({ x: 6, y: 3 });
    expect(unitById(next, 'm')).toMatchObject({ x: 6, y: 3, overwatch: false });
  });

  it('leaves the marine where it is on a miss, a kill, or when already adjacent', () => {
    const s = duel('lizard', { x: 3, y: 3 }, { x: 7, y: 3 });
    expect(unitById(attack(s, miss), 'm')).toMatchObject({ x: 3, y: 3 });
    const dying = duel('lizard', { x: 3, y: 3, hp: 1 }, { x: 7, y: 3 });
    const killed = attack(dying, hit);
    expect(killed.lastShot).toMatchObject({ killed: true, pulledTo: null });
    const close = duel('lizard', { x: 6, y: 3 }, { x: 7, y: 3 });
    expect(attack(close, hit).lastShot?.pulledTo).toBeNull();
  });

  it('only pulls with an aimed attack, not an overwatch reaction', () => {
    // The lizard watches; the marine walks into its sight and draws a reaction.
    const s: BattleState = {
      ...duel('lizard', { x: 1, y: 3 }, { x: 7, y: 3, overwatch: true }),
      turn: 'marine',
    };
    for (let rng = 1; rng < 200; rng++) {
      const next = apply({ ...s, rng }, { type: 'move', unitId: 'm', to: { x: 4, y: 3 } });
      for (const r of next.lastMove?.reactions ?? []) expect(r.shot.pulledTo).toBeNull();
    }
  });

  it('prefers a pull to a plain hit', () => {
    // Two marines at the same odds; the one already adjacent can't be pulled.
    const s = duel('lizard', { x: 3, y: 3 }, { x: 7, y: 3 });
    const two: BattleState = {
      ...s,
      units: [...s.units, { ...must(unitById(s, 'm')), id: 'm2', x: 8, y: 3 }],
    };
    expect(planAlienAction(two, 'a')).toEqual({ type: 'shoot', unitId: 'a', targetId: 'm' });
  });
});

describe('snake: poison', () => {
  it('poisons a marine it hits, but not with a miss', () => {
    const s = duel('snake', { x: 3, y: 3 }, { x: 8, y: 3 });
    const poisoned = attack(s, hit);
    expect(poisoned.lastShot?.poisoned).toBe(true);
    expect(unitById(poisoned, 'm')?.poison).toBe(ABILITIES.poison.turns);
    expect(unitById(attack(s, miss), 'm')?.poison).toBe(0);
  });

  it('bites at the start of each of the marine`s turns, then wears off, never killing', () => {
    let s: BattleState = duel('snake', { x: 3, y: 3, hp: 3, poison: 2 }, { x: 12, y: 3 });
    s = apply(s, { type: 'endTurn' }); // the marines' turn begins
    expect(unitById(s, 'm')).toMatchObject({ hp: 2, poison: 1 });
    expect(s.lastPoison).toEqual([{ unitId: 'm', damage: 1, hpAfter: 2 }]);
    s = apply(apply(s, { type: 'endTurn' }), { type: 'endTurn' });
    expect(unitById(s, 'm')).toMatchObject({ hp: 1, poison: 0 });
    s = apply(apply(s, { type: 'endTurn' }), { type: 'endTurn' });
    expect(unitById(s, 'm')).toMatchObject({ hp: 1, poison: 0 });
    expect(s.lastPoison).toEqual([]);
    // At 1 health the poison wears off without harm.
    const last = apply(duel('snake', { x: 3, y: 3, hp: 1, poison: 2 }, { x: 12, y: 3 }), {
      type: 'endTurn',
    });
    expect(unitById(last, 'm')).toMatchObject({ hp: 1, poison: 1 });
    expect(last.lastPoison).toEqual([{ unitId: 'm', damage: 0, hpAfter: 1 }]);
  });

  it('prefers a marine who is not poisoned yet', () => {
    const s = duel('snake', { x: 3, y: 3, poison: 2 }, { x: 8, y: 3 });
    const two: BattleState = {
      ...s,
      units: [...s.units, { ...must(unitById(s, 'm')), id: 'm2', x: 3, y: 4, poison: 0 }],
    };
    expect(planAlienAction(two, 'a')).toEqual({ type: 'shoot', unitId: 'a', targetId: 'm2' });
  });
});
