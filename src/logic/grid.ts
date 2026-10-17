/** Grid helpers shared by the map generator, movement and AI (ADR-E5). */

export interface Point {
  x: number;
  y: number;
}

const STEPS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Breadth-first search over passable tiles, moving in four directions.
 * Returns the step count to every tile reached from `start`, keyed by `y * cols + x`.
 * `start` itself is always included at distance 0.
 */
export function reachable(
  cols: number,
  rows: number,
  passable: (x: number, y: number) => boolean,
  start: Point,
  maxSteps = Number.POSITIVE_INFINITY,
): Map<number, number> {
  const dist = new Map<number, number>([[start.y * cols + start.x, 0]]);
  const queue: Point[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head] as Point;
    const d = dist.get(p.y * cols + p.x) as number;
    if (d >= maxSteps) continue;
    for (const s of STEPS) {
      const x = p.x + s.x;
      const y = p.y + s.y;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const key = y * cols + x;
      if (dist.has(key) || !passable(x, y)) continue;
      dist.set(key, d + 1);
      queue.push({ x, y });
    }
  }
  return dist;
}

/**
 * Shortest four-direction path from `start` to `goal`, not counting `start`.
 * Returns null if `goal` can't be reached within `maxSteps`. Ties are broken the
 * same way every time, so a path is repeatable.
 */
export function findPath(
  cols: number,
  rows: number,
  passable: (x: number, y: number) => boolean,
  start: Point,
  goal: Point,
  maxSteps = Number.POSITIVE_INFINITY,
): Point[] | null {
  // Off-map goals would alias onto real tiles through the y * cols + x key.
  if (goal.x < 0 || goal.y < 0 || goal.x >= cols || goal.y >= rows) return null;
  const startKey = start.y * cols + start.x;
  const goalKey = goal.y * cols + goal.x;
  const parent = new Map<number, number>([[startKey, -1]]);
  const dist = new Map<number, number>([[startKey, 0]]);
  const queue: Point[] = [start];
  for (let head = 0; head < queue.length && !parent.has(goalKey); head++) {
    const p = queue[head] as Point;
    const key = p.y * cols + p.x;
    const d = dist.get(key) as number;
    if (d >= maxSteps) continue;
    for (const s of STEPS) {
      const x = p.x + s.x;
      const y = p.y + s.y;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const next = y * cols + x;
      if (parent.has(next) || !passable(x, y)) continue;
      parent.set(next, key);
      dist.set(next, d + 1);
      queue.push({ x, y });
    }
  }
  if (!parent.has(goalKey) || goalKey === startKey) return null;
  const path: Point[] = [];
  for (let k = goalKey; k !== startKey; k = parent.get(k) as number) {
    path.push({ x: k % cols, y: Math.floor(k / cols) });
  }
  return path.reverse();
}

/**
 * The tiles a straight line from the centre of `a` to the centre of `b` passes
 * over, not counting `a` and `b`. The line is sampled with whole-number maths,
 * so the tiles from a to b are the same as from b to a (sight is symmetric).
 */
export function tilesBetween(a: Point, b: Point): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.max(Math.abs(dx), Math.abs(dy)) * 4;
  const seen = new Set<string>();
  const out: Point[] = [];
  // Rounds num / n to the nearest whole number, halves rounding up, for any sign.
  const div = (num: number): number => Math.floor((2 * num + n) / (2 * n));
  for (let k = 1; k < n; k++) {
    const x = div(a.x * (n - k) + b.x * k);
    const y = div(a.y * (n - k) + b.y * k);
    const key = `${x},${y}`;
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y) || seen.has(key)) continue;
    seen.add(key);
    out.push({ x, y });
  }
  return out;
}

/** True if nothing that blocks sight stands between `a` and `b`. */
export function hasLineOfSight(
  a: Point,
  b: Point,
  blocksSight: (x: number, y: number) => boolean,
): boolean {
  return tilesBetween(a, b).every((p) => !blocksSight(p.x, p.y));
}
