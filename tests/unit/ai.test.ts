import { describe, expect, it } from 'vitest';
import { ACTION_POINTS, AI, MAP_COLS, MAP_ROWS, UNITS } from '../../src/config/tuning';
import { planAlienAction, scoreTile } from '../../src/logic/ai';
import {
  apply,
  canSee,
  coverAgainst,
  createBattle,
  livingUnits,
  hitChance,
  type BattleState,
  type Unit,
} from '../../src/logic/battle';
import { generateForest, type BattleMap } from '../../src/logic/map';

/** A map from a picture: '#' is a pine, 'b' a bush, anything else is free. */
function mapOf(rows: string[]): BattleMap {
  return {
    cols: (rows[0] as string).length,
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

/** The alien's turn with the given marines and one alien, on a map. */
function scene(rows: string[], marines: Partial<Unit>[], alien: Partial<Unit>): BattleState {
  const base = createBattle(mapOf(Array(6).fill('.'.repeat(24))), 1);
  const m = base.units.find((u) => u.side === 'marine') as Unit;
  const a = base.units.find((u) => u.side === 'alien') as Unit;
  return {
    ...base,
    map: mapOf(rows),
    turn: 'alien',
    // These tests are about an alien that has been spotted (awake), unless they say otherwise.
    units: [
      ...marines.map((p, i) => ({ ...m, id: `m${i}`, ...p })),
      { ...a, id: 'a', dormant: false, ...alien },
    ],
  };
}

const open = Array(6).fill('.'.repeat(24));

describe('planAlienAction', () => {
  it('shoots when a marine is in range, picking the best chance', () => {
    const s = scene(
      open,
      [
        { x: 7, y: 2 }, // 6 tiles away, one past close range
        { x: 15, y: 2 },
      ],
      { x: 13, y: 2 },
    );
    const plan = planAlienAction(s, 'a');
    expect(plan).toEqual({ type: 'shoot', unitId: 'a', targetId: 'm1' });
    expect(hitChance(s, 'a', 'm1')).toBeGreaterThan(hitChance(s, 'a', 'm0') ?? 100);
  });

  it('prefers the more wounded marine when the chances are equal', () => {
    const s = scene(
      open,
      [
        { x: 10, y: 2, hp: 4 },
        { x: 16, y: 2, hp: 1 },
      ],
      { x: 13, y: 2 },
    );
    expect(planAlienAction(s, 'a')).toMatchObject({ type: 'shoot', targetId: 'm1' });
  });

  it('dashes into range when only a dash gets there', () => {
    // 13 tiles away: a normal move (4) can't reach range 6, a dash (8) can.
    const s = scene(open, [{ x: 1, y: 2 }], { x: 14, y: 2 });
    const plan = planAlienAction(s, 'a');
    if (plan?.type !== 'move') throw new Error(`expected a move, got ${JSON.stringify(plan)}`);
    const after = apply(s, plan);
    expect(Math.hypot(plan.to.x - 1, plan.to.y - 2)).toBeLessThanOrEqual(UNITS.walker.range);
    expect(after.units.find((u) => u.id === 'a')?.ap).toBe(0); // the dash used both points
    expect(hitChance(after, 'a', 'm0')).toBeNull(); // so no shot until next turn
  });

  it('prefers a normal move into range over a dash, keeping a point to shoot', () => {
    // 9 tiles away: 3 steps west is enough for range 6.
    const s = scene(open, [{ x: 1, y: 2 }], { x: 10, y: 2 });
    const plan = planAlienAction(s, 'a');
    if (plan?.type !== 'move') throw new Error(`expected a move, got ${JSON.stringify(plan)}`);
    const after = apply(s, plan);
    expect(after.units.find((u) => u.id === 'a')?.ap).toBe(1);
    expect(hitChance(after, 'a', 'm0')).not.toBeNull();
  });

  it('ends up in range and in cover when it can', () => {
    // A bush at (8,2): standing at (9,2) is in range of the marine at (3,2) and next to cover.
    const rows = [...open];
    rows[2] = '........b...............';
    const s = scene(rows, [{ x: 3, y: 2 }], { x: 12, y: 2 });
    const plan = planAlienAction(s, 'a');
    expect(plan).toEqual({ type: 'move', unitId: 'a', to: { x: 9, y: 2 } });
    expect(Math.hypot(9 - 3, 0)).toBeLessThanOrEqual(UNITS.walker.range);
  });

  it('does nothing when it cannot act or nothing helps', () => {
    const s = scene(open, [{ x: 1, y: 2 }], { x: 14, y: 2 });
    expect(planAlienAction({ ...s, turn: 'marine' }, 'a')).toBeNull();
    expect(planAlienAction(s, 'm0')).toBeNull();
    expect(planAlienAction(s, 'nobody')).toBeNull();
    const tired = { ...s, units: s.units.map((u) => (u.id === 'a' ? { ...u, ap: 0 } : u)) };
    expect(planAlienAction(tired, 'a')).toBeNull();
    const won = { ...s, units: s.units.map((u) => (u.id === 'm0' ? { ...u, hp: 0 } : u)) };
    expect(planAlienAction(won, 'a')).toBeNull();
  });

  it('goes on overwatch when boxed in with nowhere better to go', () => {
    // Boxed in by trees: no move gets closer, so it watches instead of idling.
    const boxed = scene(['###.........', '#.#.........', '###.........'], [{ x: 11, y: 1 }], {
      x: 1,
      y: 1,
    });
    expect(planAlienAction(boxed, 'a')).toEqual({ type: 'overwatch', unitId: 'a' });
  });

  it('spends a last point on overwatch when it has no shot', () => {
    const s = scene(open, [{ x: 1, y: 2 }], { x: 20, y: 2, ap: 1 });
    expect(planAlienAction(s, 'a')).toEqual({ type: 'overwatch', unitId: 'a' });
    // Already watching: nothing more to do.
    const watching = {
      ...s,
      units: s.units.map((u) => (u.id === 'a' ? { ...u, overwatch: true } : u)),
    };
    expect(planAlienAction(watching, 'a')).toMatchObject({ type: 'move' });
  });
});

describe('planAlienAction with sight and cover', () => {
  it('moves to a tile with a clear shot rather than one behind a tree', () => {
    // A pine wall at x = 8 except a gap on row 0; the marine is at (3,2).
    // From the far side only tiles by the gap can see the marine.
    const rows = ['........#...........', '........#...........', '........#...........'];
    rows[0] = '....................';
    // From (11,1) the alien can reach (8,0) by the gap (4 steps) or hide at (9,2) (3 steps).
    const s = scene(rows, [{ x: 3, y: 2 }], { x: 11, y: 1 });
    const plan = planAlienAction(s, 'a');
    if (plan?.type !== 'move') throw new Error(`expected a move, got ${JSON.stringify(plan)}`);
    const after = apply(s, plan);
    expect(canSee(after.map, plan.to, { x: 3, y: 2 })).toBe(true);
  });
});

describe('planAlienAction and flanking', () => {
  it('walks a little further to flank a marine in cover', () => {
    // The marine at (3,2) has a bush to its south. From the south-east the alien could
    // stop at (8,5) after 1 step, but the bush would protect the marine there. Tiles
    // level with the marine (y <= 2) flank it.
    const rows = Array(8).fill('.'.repeat(12)) as string[];
    rows[3] = '...b........';
    const s = scene(rows, [{ x: 3, y: 2 }], { x: 9, y: 5 });
    expect(hitChance(s, 'a', 'm0')).toBeNull(); // out of range to start with
    const plan = planAlienAction(s, 'a');
    if (plan?.type !== 'move') throw new Error(`expected a move, got ${JSON.stringify(plan)}`);
    expect(plan.to.y).toBeLessThanOrEqual(2);
  });
});

describe('planAlienAction and dormant pods', () => {
  it('does nothing while its pod is dormant, even with a marine in range', () => {
    const s = scene(open, [{ x: 10, y: 2 }], { x: 13, y: 2, dormant: true });
    expect(planAlienAction(s, 'a')).toBeNull();
    const awake = scene(open, [{ x: 10, y: 2 }], { x: 13, y: 2 });
    expect(planAlienAction(awake, 'a')).toMatchObject({ type: 'shoot' });
  });
});

describe('utility scoring (ADR-E4)', () => {
  const unit = (s: BattleState, id: string): Unit => s.units.find((u) => u.id === id) as Unit;
  const marinesOf = (s: BattleState): Unit[] => s.units.filter((u) => u.side === 'marine');

  it('steps into cover before shooting rather than shooting from the open', () => {
    // It can already shoot the marine at (3,2) from (7,0), in the open. The bush at
    // (8,2) gives cover facing the marine from tiles next to it that are still in range.
    const rows = [...open];
    rows[2] = '........b...............';
    const s = scene(rows, [{ x: 3, y: 2 }], { x: 7, y: 0 });
    expect(coverAgainst(s.map, { x: 7, y: 0 }, { x: 3, y: 2 })).toBeNull();
    expect(hitChance(s, 'a', 'm0')).not.toBeNull();
    const plan = planAlienAction(s, 'a');
    if (plan?.type !== 'move') throw new Error(`expected a move, got ${JSON.stringify(plan)}`);
    expect(coverAgainst(s.map, plan.to, { x: 3, y: 2 })).not.toBeNull();
    const after = apply(s, plan);
    expect(planAlienAction(after, 'a')).toEqual({ type: 'shoot', unitId: 'a', targetId: 'm0' });
  });

  it('scores a tile lower when a marine on overwatch would fire on the way', () => {
    const quiet = scene(open, [{ x: 3, y: 2 }], { x: 14, y: 2 });
    const watched = scene(open, [{ x: 3, y: 2, overwatch: true }], { x: 14, y: 2 });
    const to = { x: 10, y: 2 };
    const a = unit(quiet, 'a');
    const drop =
      scoreTile(quiet, a, marinesOf(quiet), to, 4) -
      scoreTile(watched, a, marinesOf(watched), to, 4);
    // The first tile of the run, (13,2), is 10 tiles from the watcher: 70 aim, -15 for
    // distance, -15 for a reaction shot.
    expect(drop).toBeCloseTo(AI.overwatchCost * 40, 5);
    // Staying put draws no fire.
    expect(scoreTile(watched, a, marinesOf(watched), a, 0)).toBeCloseTo(
      scoreTile(quiet, a, marinesOf(quiet), a, 0),
      5,
    );
  });

  it('prefers a tile the squad cannot see when it has no shot anyway', () => {
    // A pine at (10,2) hides (11,2) from the marine at (3,2); (11,4) is in the open.
    const rows = [...open];
    rows[2] = '..........#.............';
    const s = scene(rows, [{ x: 3, y: 2 }], { x: 12, y: 3 });
    const a = unit(s, 'a');
    const hidden = scoreTile(s, a, marinesOf(s), { x: 11, y: 2 }, 2);
    const exposed = scoreTile(s, a, marinesOf(s), { x: 11, y: 4 }, 2);
    expect(hidden).toBeGreaterThan(exposed + 10);
  });

  it('keeps pod mates together', () => {
    const near = scene(open, [{ x: 1, y: 2 }], { x: 14, y: 2, pod: 0 });
    const mate = { ...unit(near, 'a'), id: 'a2', x: 16, y: 2 };
    const withMate = (x: number, dormant = false): BattleState => ({
      ...near,
      units: [...near.units, { ...mate, x, dormant }],
    });
    const score = (s: BattleState): number =>
      scoreTile(s, unit(s, 'a'), marinesOf(s), { x: 14, y: 2 }, 0);
    // 9 tiles apart is 4 beyond the group range.
    expect(score(withMate(16)) - score(withMate(23))).toBeCloseTo(AI.groupCost * 4, 5);
    // A dormant mate doesn't pull: it isn't part of the fight yet.
    expect(score(withMate(23, true))).toBeCloseTo(score(withMate(16)), 5);
  });

  it('plans the same way every time without using up random rolls', () => {
    const s = scene(open, [{ x: 1, y: 2 }], { x: 14, y: 2 });
    const before = structuredClone(s);
    expect(planAlienAction(s, 'a')).toEqual(planAlienAction(s, 'a'));
    expect(s).toEqual(before);
  });

  it('lets the random nudge break only near-ties', () => {
    // A clear choice holds whatever the random state is: already in cover behind the
    // bush (the marine is a little south of it), with a shot, it stays and shoots.
    const rows = [...open];
    rows[2] = '........b...............';
    const base = scene(rows, [{ x: 3, y: 2 }], { x: 8, y: 1 });
    for (let rng = 0; rng < 200; rng++) {
      expect(planAlienAction({ ...base, rng: rng * 0x3c6ef35f }, 'a')).toEqual({
        type: 'shoot',
        unitId: 'a',
        targetId: 'm0',
      });
    }
    expect(AI.noise).toBeLessThan(AI.stepCost);
  });

  it('only ever plans legal actions on generated maps', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const start = createBattle(generateForest(seed, MAP_COLS, MAP_ROWS), seed);
      let s: BattleState = {
        ...start,
        turn: 'alien',
        units: start.units.map((u) => ({ ...u, dormant: false })),
      };
      for (const alien of s.units.filter((u) => u.side === 'alien')) {
        for (let i = 0; i < ACTION_POINTS; i++) {
          const plan = planAlienAction(s, alien.id);
          if (!plan) break;
          const next = apply(s, plan);
          expect(next, `seed ${seed}: ${JSON.stringify(plan)}`).not.toBe(s);
          s = next;
        }
      }
    }
  });

  it('attacks a squad that waits, on every map, within three rounds', () => {
    // Awake aliens against marines who only end their turn (and are healed after each
    // alien turn, so the fight lasts): cautious scoring must not leave them lurking.
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateForest(seed, MAP_COLS, MAP_ROWS);
      const start = createBattle(map, map.seed);
      let s: BattleState = { ...start, units: start.units.map((u) => ({ ...u, dormant: false })) };
      let firstShot = 0;
      for (let round = 1; round <= 3 && !firstShot; round++) {
        s = apply(s, { type: 'endTurn' });
        for (const alien of livingUnits(s, 'alien')) {
          for (let i = 0; i < ACTION_POINTS; i++) {
            const plan = planAlienAction(s, alien.id);
            if (!plan) break;
            if (plan.type === 'shoot') firstShot = round;
            s = apply(s, plan);
          }
        }
        s = apply(s, { type: 'endTurn' });
        s = { ...s, units: s.units.map((u) => (u.side === 'marine' ? { ...u, hp: u.maxHp } : u)) };
      }
      expect(firstShot, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});
