import { describe, expect, it } from 'vitest';
import { findPath, reachable } from '../../src/logic/grid';

/** Builds a passable() check from a picture: '#' blocks, anything else is open. */
function board(rows: string[]): {
  cols: number;
  rows: number;
  open: (x: number, y: number) => boolean;
} {
  return {
    cols: (rows[0] as string).length,
    rows: rows.length,
    open: (x, y) => (rows[y] as string)[x] !== '#',
  };
}

describe('reachable', () => {
  it('counts steps in four directions, not diagonals', () => {
    const b = board(['...', '...', '...']);
    const d = reachable(b.cols, b.rows, b.open, { x: 0, y: 0 });
    expect(d.get(0)).toBe(0);
    expect(d.get(2 * 3 + 2)).toBe(4);
    expect(d.size).toBe(9);
  });

  it('walks around walls', () => {
    const b = board(['.#.', '.#.', '...']);
    const d = reachable(b.cols, b.rows, b.open, { x: 0, y: 0 });
    expect(d.get(2)).toBe(6); // (2,0): down, around the wall, and back up
    expect(d.has(1)).toBe(false);
  });

  it('does not cross a full wall', () => {
    const b = board(['.#.', '.#.', '.#.']);
    const d = reachable(b.cols, b.rows, b.open, { x: 0, y: 0 });
    expect(d.size).toBe(3);
  });

  it('stops at maxSteps', () => {
    const b = board(['.....']);
    const d = reachable(b.cols, b.rows, b.open, { x: 0, y: 0 }, 2);
    expect([...d.keys()].sort()).toEqual([0, 1, 2]);
  });
});

describe('findPath', () => {
  it('returns the steps after the start, ending at the goal', () => {
    const b = board(['...', '...']);
    expect(findPath(b.cols, b.rows, b.open, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('finds a shortest way around walls', () => {
    const b = board(['.#.', '.#.', '...']);
    const path = findPath(b.cols, b.rows, b.open, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).toHaveLength(6);
    expect(path?.at(-1)).toEqual({ x: 2, y: 0 });
    for (const p of path ?? []) expect(b.open(p.x, p.y)).toBe(true);
  });

  it('returns null when the goal is walled off, too far, or the start', () => {
    const b = board(['.#.', '.#.', '.#.']);
    expect(findPath(b.cols, b.rows, b.open, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    const open = board(['.....']);
    expect(findPath(open.cols, open.rows, open.open, { x: 0, y: 0 }, { x: 4, y: 0 }, 3)).toBeNull();
    expect(
      findPath(open.cols, open.rows, open.open, { x: 0, y: 0 }, { x: 3, y: 0 }, 3),
    ).toHaveLength(3);
    expect(findPath(open.cols, open.rows, open.open, { x: 1, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it('gives the same path every time', () => {
    const b = board(['....', '....', '....']);
    const a = findPath(b.cols, b.rows, b.open, { x: 0, y: 0 }, { x: 3, y: 2 });
    expect(findPath(b.cols, b.rows, b.open, { x: 0, y: 0 }, { x: 3, y: 2 })).toEqual(a);
  });
});
