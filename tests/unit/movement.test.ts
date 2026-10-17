import { describe, expect, it } from 'vitest';
import { screenBounds, step } from '../../src/logic/movement';

const bounds = screenBounds(256, 320, 16);

describe('screenBounds', () => {
  it('keeps the whole object on screen', () => {
    expect(bounds).toEqual({ minX: 8, maxX: 248, minY: 8, maxY: 312 });
  });
});

describe('step', () => {
  it('moves at the given speed', () => {
    expect(step({ x: 100, y: 100 }, { x: 1, y: 0 }, 0.5, 120, bounds)).toEqual({ x: 160, y: 100 });
  });

  it('does not move without input', () => {
    expect(step({ x: 100, y: 100 }, { x: 0, y: 0 }, 1, 120, bounds)).toEqual({ x: 100, y: 100 });
  });

  it('is no faster diagonally', () => {
    const p = step({ x: 100, y: 100 }, { x: 1, y: 1 }, 1, 100, bounds);
    expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(100);
  });

  it('stops at the screen edges', () => {
    expect(step({ x: 10, y: 10 }, { x: -1, y: -1 }, 5, 120, bounds)).toEqual({ x: 8, y: 8 });
    expect(step({ x: 240, y: 300 }, { x: 1, y: 1 }, 5, 120, bounds)).toEqual({ x: 248, y: 312 });
  });

  it('rejects negative time', () => {
    expect(() => step({ x: 0, y: 0 }, { x: 1, y: 0 }, -1, 1, bounds)).toThrow(RangeError);
  });
});
