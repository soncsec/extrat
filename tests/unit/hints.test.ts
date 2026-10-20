import { describe, expect, it } from 'vitest';
import { MAP_COLS, MAP_ROWS } from '../../src/config/tuning';
import { createBattle, type BattleState, type Unit } from '../../src/logic/battle';
import {
  HINT_ORDER,
  HINT_TEXT,
  HINT_WRAP,
  hintFor,
  hintsDone,
  type HintId,
} from '../../src/logic/hints';
import { generateForest, type BattleMap } from '../../src/logic/map';
import { wrapLines } from '../../src/logic/text';

/** An open map with no props, wide enough to put aliens out of sight (12 tiles). */
function openMap(cols = 30, rows = 7): BattleMap {
  return {
    cols,
    rows,
    seed: 0,
    tiles: Array.from({ length: cols * rows }, () => ({ prop: null, anchor: false })),
    decals: [],
  } as BattleMap;
}

/** Two marines on the left, two aliens far off on the right, out of sight. */
function battle(change: (units: Unit[]) => Unit[] = (u) => u): BattleState {
  const base = createBattle(generateForest(1, MAP_COLS, MAP_ROWS), 1);
  const m = base.units.find((u) => u.side === 'marine') as Unit;
  const a = base.units.find((u) => u.side === 'alien') as Unit;
  const units = [
    { ...m, id: 'm1', x: 2, y: 2 },
    { ...m, id: 'm2', x: 2, y: 4 },
    { ...a, id: 'a1', x: 28, y: 2, dormant: false },
    { ...a, id: 'a2', x: 28, y: 5, dormant: false },
  ];
  return { ...base, map: openMap(), turn: 'marine', selected: null, units: change(units) };
}

const moved = new Set<HintId>(['move']);
const at = (id: string, x: number, y: number) => (units: Unit[]) =>
  units.map((u) => (u.id === id ? { ...u, x, y } : u));

describe('first-mission hints (M6.2)', () => {
  it('starts with how to move, and shows nothing on the aliens` turn', () => {
    expect(hintFor(battle(), new Set())).toBe('move');
    expect(hintFor({ ...battle(), turn: 'alien' }, new Set())).toBeNull();
  });

  it('after the first move, asks for cover until a marine stands by a prop', () => {
    const open = battle();
    expect(hintFor(open, moved)).toBe('cover');
    const rock = { ...open.map, tiles: [...open.map.tiles] };
    rock.tiles[2 * rock.cols + 3] = { prop: 'rocks', anchor: true } as (typeof rock.tiles)[number];
    const covered = { ...open, map: rock };
    expect(hintsDone(covered, { type: 'move', unitId: 'm1', to: { x: 2, y: 2 } })).toEqual([
      'move',
      'cover',
    ]);
    expect(hintFor(covered, moved)).toBeNull();
  });

  it('says how to shoot once an alien is in sight, before anything but the urgent ones', () => {
    const seen = battle(at('a1', 8, 2));
    expect(hintFor(seen, new Set())).toBe('shoot');
    expect(hintFor(seen, new Set<HintId>(['shoot']))).toBe('move');
  });

  it('suggests a grenade when two aliens in sight stand close together', () => {
    const pair = battle((u) => at('a2', 9, 3)(at('a1', 8, 2)(u)));
    expect(hintFor({ ...pair, selected: 'm1' }, new Set())).toBe('grenade');
    // Not without a marine picked to throw it, nor when they stand apart.
    expect(hintFor(pair, new Set())).toBe('shoot');
    const apart = battle((u) => at('a2', 8, 6)(at('a1', 8, 2)(u)));
    expect(hintFor({ ...apart, selected: 'm1' }, new Set())).toBe('shoot');
  });

  it('says how to reload when the picked marine is out of ammo', () => {
    const empty = battle((u) => u.map((x) => (x.id === 'm1' ? { ...x, ammo: 0 } : x)));
    expect(hintFor({ ...empty, selected: 'm1' }, moved)).toBe('reload');
    expect(hintFor({ ...empty, selected: 'm2' }, moved)).toBe('cover');
  });

  it('says how to end the turn once every marine has acted', () => {
    const spent = battle((u) => u.map((x) => (x.side === 'marine' ? { ...x, ap: 0 } : x)));
    expect(hintFor(spent, moved)).toBe('endTurn');
    expect(hintFor(spent, new Set<HintId>(['move', 'endTurn', 'cover']))).toBeNull();
  });

  it('from turn 2, with no aliens in sight, suggests watch', () => {
    const quiet = { ...battle(), round: 2 };
    expect(hintFor(quiet, new Set<HintId>(['move', 'cover']))).toBe('watch');
    expect(hintFor({ ...battle(), round: 1 }, new Set<HintId>(['move', 'cover']))).toBeNull();
    expect(hintFor(quiet, new Set<HintId>(['move', 'cover', 'watch']))).toBeNull();
  });

  it('is done by doing what it teaches; picking a marine does none', () => {
    const b = battle();
    expect(hintsDone(b, { type: 'shoot', unitId: 'm1', targetId: 'a1' })).toEqual(['shoot']);
    expect(hintsDone(b, { type: 'reload', unitId: 'm1' })).toEqual(['reload']);
    expect(hintsDone(b, { type: 'throw', unitId: 'm1', at: { x: 5, y: 5 } })).toEqual(['grenade']);
    expect(hintsDone(b, { type: 'overwatch', unitId: 'm1' })).toEqual(['watch']);
    expect(hintsDone(b, { type: 'endTurn' })).toEqual(['endTurn']);
    expect(hintsDone(b, { type: 'select', unitId: 'm1' })).toEqual([]);
  });

  it('fits the hint box: at most 3 lines each, mouse and touch', () => {
    expect([...HINT_ORDER].sort()).toEqual(Object.keys(HINT_TEXT).sort());
    for (const id of HINT_ORDER) {
      for (const text of Object.values(HINT_TEXT[id])) {
        expect(wrapLines(text, HINT_WRAP).split('\n').length, text).toBeLessThanOrEqual(3);
      }
    }
  });
});
