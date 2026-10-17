import { describe, expect, it } from 'vitest';
import { UNITS } from '../../src/config/tuning';
import { planAlienAction } from '../../src/logic/ai';
import {
  apply,
  canSee,
  createBattle,
  hitChance,
  type BattleState,
  type Unit,
} from '../../src/logic/battle';
import type { BattleMap } from '../../src/logic/map';

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
    units: [...marines.map((p, i) => ({ ...m, id: `m${i}`, ...p })), { ...a, id: 'a', ...alien }],
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
    // Boxed in by trees: no move gets closer.
    const boxed = scene(['###.........', '#.#.........', '###.........'], [{ x: 11, y: 1 }], {
      x: 1,
      y: 1,
    });
    expect(planAlienAction(boxed, 'a')).toBeNull();
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
