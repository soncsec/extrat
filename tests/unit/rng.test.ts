import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/logic/rng';

describe('createRng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it('keeps next() within [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() covers the whole inclusive range and nothing outside it', () => {
    const rng = createRng(123);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) seen.add(rng.int(-2, 3));
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it('range() stays within [min, max)', () => {
    const rng = createRng(9);
    for (let i = 0; i < 1_000; i++) {
      const v = rng.range(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('pick() only returns items from the array', () => {
    const rng = createRng(5);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });

  it('rejects invalid arguments', () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    expect(() => rng.range(2, 1)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
