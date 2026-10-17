/** Engine-free movement rules (ADR-006): plain TypeScript, unit tested. */

export interface Axis {
  /** -1 left, 0 none, 1 right */
  x: -1 | 0 | 1;
  /** -1 up, 0 none, 1 down */
  y: -1 | 0 | 1;
}

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Bounds that keep an object of the given size fully on screen. */
export function screenBounds(width: number, height: number, size: number): Bounds {
  const half = size / 2;
  return { minX: half, maxX: width - half, minY: half, maxY: height - half };
}

/**
 * Moves `p` along `axis` for `dt` seconds at `speed` pixels per second,
 * clamped to `bounds`. Diagonal movement is normalised so it isn't faster.
 */
export function step(p: Point, axis: Axis, dt: number, speed: number, bounds: Bounds): Point {
  if (dt < 0) throw new RangeError('dt must not be negative');
  const len = Math.hypot(axis.x, axis.y) || 1;
  const x = p.x + (axis.x / len) * speed * dt;
  const y = p.y + (axis.y / len) * speed * dt;
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
  };
}
