import { describe, expect, it } from 'vitest';
import { UNITS } from '../../src/config/tuning';
import { planAlienAction } from '../../src/logic/ai';
import {
  apply,
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

  it('moves into range when the squad is far away', () => {
    const s = scene(open, [{ x: 1, y: 2 }], { x: 14, y: 2 });
    const plan = planAlienAction(s, 'a');
    if (plan?.type !== 'move') throw new Error(`expected a move, got ${JSON.stringify(plan)}`);
    expect(plan.to.x).toBeLessThan(14);
    const after = apply(s, plan);
    expect(hitChance(after, 'a', 'm0')).toBeNull(); // 4 tiles closer is still 9 away
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
