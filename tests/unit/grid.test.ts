import { describe, expect, it } from 'vitest';
import { reachable } from '../../src/logic/grid';

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
