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
